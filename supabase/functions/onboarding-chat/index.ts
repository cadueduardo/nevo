// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import {
  extractBusinessModelWithAI,
  extractServicesFromText,
  identifyMissingFields,
  parseServicesList,
  extractQuoteVariables,
  classifyNeedsIntroTutorial,
  answerDoubtWithAI,
  suggestServicesWithAI,
  BusinessModelExtraction,
} from './extractors.ts'

import {
  determineNextStep,
  generateSummary,
  buildServiceExamples,
  buildServiceSelectableOptions,
  BusinessModelData,
  FlowState,
} from './flow-manager.ts'
import { migrateOnboardingToTenant } from './migrate.ts'

interface OnboardingRequest {
  session_id: string
  message: string
  current_step?: string
  edits?: Array<{ id: string; value: string }>
  address?: {
    cep: string
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    localidade: string
    uf: string
  }
}

interface OnboardingResponse {
  assistant_message: string
  next_step: string
  extracted_data?: Record<string, any>
  requires_action?: string | null
  action_options?: string[]
  editable_items?: Array<{
    id: string
    label: string
    value: string
    type: string
  }>
  selectable_options?: Array<{
    id: string
    label: string
    value: string
    selected?: boolean
  }>
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const INTRO_DISCOVERY_OPTIONS = [
  'Sim, já conheço, vamos iniciar',
  'Não, pode me explicar o que você faz?',
]

const INTRO_TUTORIAL_CTA_OPTIONS = [
  'Entendi, quero fazer meu assistente agora',
  'Vou configurar depois',
]

function buildGreetingDiscoveryMessage(): string {
  return 'Oi! Que bom ter você aqui.\n\nVocê já conhece o Nevo e quer começar a configurar seu assistente agora?'
}

function isLikelyBusinessInfoFirstMessage(message: string): boolean {
  const text = (message || '').toLowerCase().trim()
  if (!text) return false

  // Cumprimentos curtos / mensagens vazias → não tratar como descrição do negócio
  if (text.length < 8) return false
  const hasBusinessKeyword = /(manicure|barbearia|barbeiro|salão|salao|clínica|clinica|loja|restaurante|pizzaria|lanchonete|oficina|delivery|chef|personal chef)\b/.test(
    text
  )
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|e aí|e ai|fala|hello)\b/.test(text) && text.length < 30) {
    if (!hasBusinessKeyword) return false
  }

  // Sinais de descrição de negócio / atendimento / horários / nome
  const patterns = [
    /\b(sou|tenho|trabalho|atuo|atendo|faço|faco|vendo|presto)\b/,
    /\b(barbearia|barbeiro|salão|salao|clínica|clinica|loja|restaurante|pizzaria|lanchonete|oficina|delivery|manicure|chef|personal chef)\b/,
    /\b(chama|se chama|nome)\b/,
    /\b(seg|segunda|ter|terça|quarta|quinta|sexta|sáb|sábado|domingo)\b/,
    /\b(das|de)\s*\d{1,2}\b.*\b(as|às|até|ate)\b.*\d{1,2}\b/,
  ]
  return patterns.some((p) => p.test(text))
}

function looksLikeBusinessSeedInput(message: string): boolean {
  const text = (message || '').toLowerCase().trim()
  if (!text || text.length < 2) return false
  if (/\?/.test(text)) return false
  if (/\b(posso|como|duvida|dúvida|ajuda|explica|nao entendi|não entendi)\b/.test(text)) return false

  const hasBusinessHint = /(chef|personal chef|barbearia|barbeiro|salao|salão|manicure|clinica|clínica|loja|restaurante|oficina|studio|estudio|estúdio)\b/.test(
    text
  )
  const hasSelfDescription = /\b(sou|tenho|trabalho|atuo|atendo|faco|faço|vendo|presto)\b/.test(text)

  return hasBusinessHint || hasSelfDescription || isLikelyBusinessInfoFirstMessage(text)
}

function normalizeForComparison(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isGreetingOnlyMessage(message: string): boolean {
  const normalized = normalizeForComparison(message)
  if (!normalized) return true

  const greetingPatterns = [
    /^(oi|ola|alo|opa|hey|hi|hello)$/,
    /^(bom dia|boa tarde|boa noite)$/,
    /^(e ai|fala|blz|beleza|tudo bem|td bem)$/,
  ]

  return greetingPatterns.some((pattern) => pattern.test(normalized))
}

function sanitizeBusinessType(value: string): string {
  const cleaned = (value || '')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned
}

function isValidBusinessTypeCandidate(value: string): boolean {
  const normalized = normalizeForComparison(value)
  if (!normalized) return false
  if (isGreetingOnlyMessage(normalized)) return false
  if (isGenericOnboardingIntent(normalized)) return false
  if (/^(quero|preciso|gostaria|comecar|iniciar|cadastro|negocio)$/.test(normalized)) return false
  return normalized.length >= 2
}

function isGenericOnboardingIntent(value: string): boolean {
  const normalized = normalizeForComparison(value)
  if (!normalized) return true
  return /(quero|gostaria|preciso|cadastrar|criar|montar)\s+(meu|minha)?\s*(negocio|empresa|conta|cadastro)/.test(
    normalized
  )
}

function extractBusinessTypeDeterministic(message: string): string {
  const normalized = normalizeForComparison(message)
  if (!normalized) return ''

  const withoutGreeting = normalized.replace(/^(oi|ola|bom dia|boa tarde|boa noite|e ai|fala)(\s+|$)/, '').trim()
  const patterns = [
    /\b(?:sou|trabalho como|atuo como|trabalho com|atuo com)\s+(.+?)(?:\b(?:e|para|quero|gostaria|preciso|estou|to)\b|$)/,
    /\b(?:ramo|tipo de negocio|tipo do negocio|negocio)\s*(?:e|eh|:)?\s*(.+)$/,
  ]

  for (const pattern of patterns) {
    const match = withoutGreeting.match(pattern)
    if (!match?.[1]) continue
    const candidate = sanitizeBusinessType(match[1])
    if (isValidBusinessTypeCandidate(candidate)) return candidate
  }

  const fallback = sanitizeBusinessType(withoutGreeting)
  if (!isValidBusinessTypeCandidate(fallback)) return ''
  return fallback
}

function resolveBusinessTypeCandidate(aiBusinessType: string | undefined, message: string): string {
  const aiCandidate = sanitizeBusinessType(aiBusinessType || '')
  if (isValidBusinessTypeCandidate(aiCandidate)) return aiCandidate
  return extractBusinessTypeDeterministic(message)
}

function hasOnboardingSeedExtraction(extracted: Record<string, any> | null | undefined): boolean {
  if (!extracted) return false
  if (typeof extracted.business_type === 'string' && isValidBusinessTypeCandidate(extracted.business_type)) return true
  if (typeof extracted.business_name === 'string' && extracted.business_name.trim()) return true
  if (typeof extracted.context === 'string' && extracted.context.trim()) return true
  if (Array.isArray(extracted.services) && extracted.services.length > 0) return true
  if (Array.isArray(extracted.staff) && extracted.staff.length > 0) return true
  if (Array.isArray(extracted.dynamic_variables) && extracted.dynamic_variables.length > 0) return true
  if (typeof extracted.tone_of_voice === 'string' && extracted.tone_of_voice.trim()) return true
  if (typeof extracted.interaction_style === 'string' && extracted.interaction_style.trim()) return true
  if (typeof extracted.handoff_mode === 'string' && extracted.handoff_mode.trim()) return true
  if (typeof extracted.location_mode === 'string' && extracted.location_mode.trim()) return true
  if (extracted.target_audience?.mode || (Array.isArray(extracted.target_audience?.modes) && extracted.target_audience.modes.length > 0)) return true
  if (extracted.service_area?.region || extracted.service_area?.coverage) return true
  if (extracted.schedule?.start_time || extracted.schedule?.end_time) return true
  if (Array.isArray(extracted.schedule?.days_of_week) && extracted.schedule.days_of_week.length > 0) return true
  return false
}

const ALL_DAYS = [
  { id: 'monday', label: 'Segunda-feira', value: 'monday' },
  { id: 'tuesday', label: 'Terça-feira', value: 'tuesday' },
  { id: 'wednesday', label: 'Quarta-feira', value: 'wednesday' },
  { id: 'thursday', label: 'Quinta-feira', value: 'thursday' },
  { id: 'friday', label: 'Sexta-feira', value: 'friday' },
  { id: 'saturday', label: 'Sábado', value: 'saturday' },
  { id: 'sunday', label: 'Domingo', value: 'sunday' },
]

function buildDaysSelectableOptions(selectedDays: string[] = []) {
  return ALL_DAYS.map((d) => ({ ...d, selected: selectedDays.includes(d.value) }))
}

const HOLIDAYS_CACHE: Record<number, Array<{ date: string; name: string }>> = {}

async function fetchNationalHolidays(year: number): Promise<Array<{ date: string; name: string }>> {
  if (HOLIDAYS_CACHE[year]) return HOLIDAYS_CACHE[year]
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`)
    if (!res.ok) return []
    const data = (await res.json()) as Array<{ date: string; name: string; type?: string }>
    const national = data.filter((h) => h.type === 'national' || !h.type)
    HOLIDAYS_CACHE[year] = national
    return national
  } catch {
    return []
  }
}

function buildHolidaysSelectableOptions(
  holidays: Array<{ date: string; name: string }>,
  selectedDates: string[] = []
) {
  return holidays.map((h) => ({
    id: h.date,
    label: `${h.name} (${h.date.split('-').reverse().join('/')})`,
    value: h.date,
    selected: selectedDates.includes(h.date),
  }))
}

function parseClosurePeriod(text: string): { start: string; end: string } | null {
  const msg = (text || '').trim()
  const match = msg.match(
    /(\d{1,2})[\/\-](\d{1,2})[\/\-]?(\d{2,4})?\s*(?:a|ate|até|-)\s*(\d{1,2})[\/\-](\d{1,2})[\/\-]?(\d{2,4})?/
  )
  if (!match) return null
  const year = (y: string) => {
    const n = parseInt(y || '', 10)
    if (!y || y.length === 2) return n >= 0 && n < 100 ? 2000 + n : new Date().getFullYear()
    return n
  }
  const d1 = parseInt(match[1], 10)
  const m1 = parseInt(match[2], 10) - 1
  const y1 = year(match[3])
  const d2 = parseInt(match[4], 10)
  const m2 = parseInt(match[5], 10) - 1
  const y2 = year(match[6]) || y1
  const start = `${y1}-${String(m1 + 1).padStart(2, '0')}-${String(d1).padStart(2, '0')}`
  const end = `${y2}-${String(m2 + 1).padStart(2, '0')}-${String(d2).padStart(2, '0')}`
  return { start, end }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function parseBody(req: Request): Promise<OnboardingRequest | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return { supabaseAdmin: null, envError: 'Configuração do servidor incompleta' }
  }

  return { supabaseAdmin: createClient(supabaseUrl, serviceRoleKey), envError: null }
}

async function getOrCreateSession(
  supabaseAdmin: any,
  sessionId: string
): Promise<{ session: any; isNew: boolean }> {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('onboarding_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (session) return { session, isNew: false }
  if (sessionError && sessionError.code !== 'PGRST116') throw sessionError

  const { data: newSession, error: createError } = await supabaseAdmin
    .from('onboarding_sessions')
    .insert({ session_id: sessionId, current_step_key: null, collected_data: {} })
    .select()
    .single()

  if (createError) throw createError
  return { session: newSession, isNew: true }
}

function ensureNextStep(resp: Partial<OnboardingResponse>, fallback: string): OnboardingResponse {
  const next = typeof resp.next_step === 'string' && resp.next_step.trim() ? resp.next_step.trim() : fallback
  return {
    assistant_message: resp.assistant_message || 'Ops, aconteceu um problema aqui. Pode repetir sua última mensagem?',
    next_step: next,
    extracted_data: resp.extracted_data || {},
    requires_action: resp.requires_action ?? null,
    action_options: resp.action_options,
    editable_items: resp.editable_items,
    selectable_options: resp.selectable_options,
  }
}

/** Detecta pedidos de ver resumo, alterar ou editar dados. Resumo pode ser chamado a qualquer momento. */
function isShowSummaryOrEditRequest(text: string): boolean {
  const t = (text || '').toLowerCase().trim()
  return (
    /^resumo\s*\.?$/i.test(t) ||
    /(quero ver o resumo|mostrar resumo|mostrar estrutura|ver estrutura|ver configura[çc][ãa]o|mostrar configura[çc][ãa]o)/i.test(t) ||
    /(me mostre o que j[aá] foi cadastrado|o que j[aá] foi cadastrado at[eé] agora)/i.test(t) ||
    /(quero alterar alguma informa[çc][ãa]o|quero editar meus dados|quero editar)/i.test(t) ||
    /(alterar informa[çc][õo]es|editar dados)/i.test(t)
  )
}

/** Classifica intenção global: comandos que podem ser usados em qualquer etapa do onboarding. */
function classifyGlobalIntent(text: string): 'help' | 'summary' | 'restart' | 'repeat' | 'what_can_i_do' | null {
  const t = (text || '').toLowerCase().trim()
  if (!t) return null
  // Ajuda / tutorial
  if (
    /\b(preciso\s+de\s+ajuda|preciso\s+ajuda|como\s+funciona|me\s+explica|n[aã]o\s+entendi|o\s+que\s+(e|eh)\s+isso|me\s+orienta|t[oô]\s+perdido|por\s+onde\s+come[cç]o)\b/i.test(t) ||
    /\b(tenho\s+duvidas?|tenho\s+d[uú]vidas?)\b/i.test(t) ||
    /^(ajuda|help)\s*\.?$/i.test(t) ||
    /\b(pode\s+explicar|explica\s+pra\s+mim)\b/i.test(t)
  )
    return 'help'
  // Ver resumo (só visualização; edição cai em isShowSummaryOrEditRequest)
  if (
    /\b(ver\s+resumo|mostrar\s+resumo|o\s+que\s+j[aá]\s+cadastrei|o\s+que\s+configurei|resumo\s+do\s+que\s+preenchi)\b/i.test(t) ||
    /^resumo\s*\.?$/i.test(t)
  )
    return 'summary'
  // Recomeçar
  if (
    /\b(recome[cç]ar|come[cç]ar\s+de\s+novo|zerar|recome[cç]ar\s+configura[çc][ãa]o|apagar\s+tudo\s+e\s+come[cç]ar)\b/i.test(t) ||
    /^(recome[cç]ar|zerar)\s*\.?$/i.test(t)
  )
    return 'restart'
  // Repetir / reformular
  if (
    /\b(n[aã]o\s+entendi\s+a\s+pergunta|pode\s+repetir|repetir\s+por\s+favor|reformula|explica\s+de\s+outro\s+jeito|repete)\b/i.test(t) ||
    /^(repetir|reformula)\s*\.?$/i.test(t)
  )
    return 'repeat'
  // O que posso fazer aqui
  if (
    /\b(o\s+que\s+(eu\s+)?fa[cç]o\s+agora|quais\s+op[cç][oõ]es\s+tenho|o\s+que\s+posso\s+responder|o\s+que\s+posso\s+fazer\s+aqui)\b/i.test(t) ||
    /^(e\s+agora\?|o\s+que\s+fa[cç]o\?)\s*\.?$/i.test(t)
  )
    return 'what_can_i_do'
  return null
}

/** Dica contextual curta por etapa (para resposta global de ajuda / "o que faço agora"). */
function getStepContextualHint(step: string): string {
  const hints: Record<string, string> = {
    welcome: 'Você está no início. Pode me contar o tipo do seu negócio ou pedir para eu explicar o passo a passo.',
    welcome_intro_choice: 'Escolha uma das opções abaixo para continuar.',
    welcome_tutorial_cta: 'Quando estiver pronto, escolha uma das opções abaixo.',
    collect_free_text: 'Aqui você pode descrever seu negócio com suas palavras (ramo, nome, o que faz).',
    business_type: 'Informe o ramo ou tipo do seu negócio (ex.: barbearia, clínica, consultoria).',
    business_name: 'Informe o nome do seu negócio ou empresa.',
    context: 'Escolha se quer configurar agendamento, orçamento ou ambos.',
    services_list: 'Selecione os serviços que você oferece ou digite outros no campo. Depois pode clicar em Continuar.',
    services_edit: 'Revise a lista de serviços, adicione ou remova itens e clique em Continuar quando terminar.',
    sequence_booking_offer: 'Escolha se o cliente pode agendar vários serviços na mesma visita ou só um por vez.',
    sequence_services_select: 'Selecione quais serviços podem ser combinados em sequência (ex.: banho + tosa).',
    schedule_days: 'Marque os dias da semana em que você atende.',
    staff_mode: 'Informe se você atende sozinho ou tem colaboradores.',
    summary: 'Revise o resumo e confirme se está correto ou se quer ajustar algo.',
    summary_edit: 'Edite os campos que quiser e clique em Salvar ajustes para continuar.',
    signup_request: 'Escolha criar conta, entrar na sua conta ou continuar depois.',
  }
  return hints[step] || 'Responda à pergunta acima ou use uma das opções disponíveis.'
}

/** Retorna conteúdo legível para exibição quando a mensagem do usuário é um comando de ação (select_*). */
function userMessageDisplayContent(message: string): string {
  const m = (message || '').trim()
  const seqMatch = m.match(/^select_sequence_services:(.+)$/i)
  if (seqMatch) return `Serviços em sequência: ${seqMatch[1].trim()}`
  const svcMatch = m.match(/^select_services:(.+)$/i)
  if (svcMatch) return `Serviços selecionados: ${svcMatch[1].trim()}`
  const daysMatch = m.match(/^select_days:(.+)$/i)
  if (daysMatch) return `Dias selecionados: ${daysMatch[1].trim()}`
  const holMatch = m.match(/^select_holidays:(.*)$/i)
  if (holMatch) return holMatch[1].trim() ? `Feriados selecionados: ${holMatch[1].trim()}` : 'Feriados selecionados'
  return m
}

/** Usuário ainda no começo: falta business_type, business_name ou context. */
function hasMinimalData(data: any): boolean {
  return !data?.business_type || !data?.business_name || !data?.context
}

/** Mensagem do tutorial introdutório quando o usuário não sabe o que fazer. */
function buildIntroTutorialMessage(): string {
  return `Fique à vontade, vou te guiar. 😊

O Nevo te ajuda a configurar um **assistente virtual** para o seu negócio, que responde clientes, agenda horários e pode até dar orçamentos.

**O que vou precisar (principais):**
• Tipo do seu negócio (o que você faz/vende)
• Nome da empresa
• Se quer usar para agendamento, orçamento ou ambos
• Serviços que você oferece
• Dias e horários de funcionamento
• Se atende sozinho ou tem colaboradores

**Opcionais (pode configurar depois):**
• Valores dos serviços
• Endereço ou região de atendimento
• Políticas de cancelamento
• Tom de voz
• Feriados em que atende
• FAQ

Pode começar me contando **o tipo do seu negócio** ou **o que você faz/vende**.`
}

/** Retorna todos os campos do formulário (incluindo vazios) para usuário avançado preencher direto. */
function buildAllEditableItems(data: any) {
  const items: Array<{ id: string; label: string; value: string; type: string }> = []

  items.push({ id: 'business_type', label: 'Tipo de negócio (ramo)', value: data.business_type || '', type: 'business_type' })
  items.push({ id: 'business_name', label: 'Nome do negócio', value: data.business_name || '', type: 'business_name' })

  const contextLabel = data.context === 'booking' ? 'Agendamento' : data.context === 'quote' ? 'Orçamento' : data.context === 'both' ? 'Agendamento + Orçamento' : ''
  items.push({ id: 'context', label: 'Contexto', value: contextLabel, type: 'context' })

  const locLabel = data.location_mode === 'fixed' ? 'Ponto fixo' : data.location_mode === 'mobile' ? 'Atende no local do cliente' : ''
  items.push({ id: 'location_mode', label: 'Localização', value: locLabel, type: 'service_area' })

  if (data.location_mode === 'fixed') {
    const a = data.establishment_address
    const val = a?.logradouro
      ? `${a.logradouro}, ${a.numero}${a.complemento ? ` ${a.complemento}` : ''} - ${a.bairro}, ${a.localidade}/${a.uf}`
      : ''
    items.push({ id: 'establishment_address', label: 'Endereço', value: val, type: 'establishment_address' })
  }
  if (data.location_mode === 'mobile' || !data.location_mode) {
    const cov = data.service_area?.coverage ? ` (${data.service_area.coverage})` : ''
    const val = `${data.service_area?.region || ''}${cov}`.trim()
    items.push({ id: 'service_area', label: 'Região de atendimento', value: val, type: 'service_area' })
  }

  const toneLabel =
    data.tone_of_voice === 'formal'
      ? 'Formal'
      : data.tone_of_voice === 'friendly'
        ? 'Amigável'
        : data.tone_of_voice === 'professional'
          ? 'Profissional'
          : data.tone_of_voice === 'funny'
            ? 'Engraçado'
            : ''
  items.push({ id: 'tone_of_voice', label: 'Tom de voz', value: toneLabel, type: 'tone_of_voice' })

  const daysLabels: Record<string, string> = {
    monday: 'Segunda',
    tuesday: 'Terça',
    wednesday: 'Quarta',
    thursday: 'Quinta',
    friday: 'Sexta',
    saturday: 'Sábado',
    sunday: 'Domingo',
  }
  if (data.schedule?.days_of_week?.length && data.schedule?.start_time && data.schedule?.end_time) {
    const daysPt = data.schedule.days_of_week.map((d: string) => daysLabels[d] || d).join(', ')
    const breaks =
      Array.isArray(data.schedule.breaks) && data.schedule.breaks.length > 0
        ? ` (pausa ${data.schedule.breaks.map((b: any) => `${b.start} às ${b.end}`).join(', ')})`
        : ''
    items.push({
      id: 'schedule',
      label: 'Horário de funcionamento',
      value: `${daysPt} - ${data.schedule.start_time} às ${data.schedule.end_time}${breaks}`,
      type: 'schedule',
    })
  } else {
    items.push({ id: 'schedule', label: 'Horário de funcionamento', value: '', type: 'schedule' })
  }

  if (data.schedule?.interval_minutes) {
    items.push({
      id: 'schedule_interval',
      label: 'Intervalo entre atendimentos',
      value: `${data.schedule.interval_minutes} min`,
      type: 'schedule_interval',
    })
  } else {
    items.push({ id: 'schedule_interval', label: 'Intervalo entre atendimentos', value: '', type: 'schedule_interval' })
  }

  if (data.schedule?.min_booking_lead_minutes != null) {
    items.push({
      id: 'min_booking_lead',
      label: 'Antecedência mínima para agendamento',
      value: `${data.schedule.min_booking_lead_minutes} min`,
      type: 'min_booking_lead',
    })
  } else {
    items.push({ id: 'min_booking_lead', label: 'Antecedência mínima para agendamento', value: '', type: 'min_booking_lead' })
  }

  const policiesNote = typeof data.policies?.note === 'string' ? data.policies.note.trim() : ''
  items.push({
    id: 'policies',
    label: 'Políticas',
    value: policiesNote || '',
    type: 'policies',
  })

  const handoffLabel =
    data.handoff_mode === 'always' ? 'Sempre humano' : data.handoff_mode === 'conditional' ? 'Condicional' : data.handoff_mode === 'never' ? 'Automático' : ''
  items.push({ id: 'handoff_mode', label: 'Passar para humano', value: handoffLabel, type: 'tone_of_voice' })

  const targetAudienceLabel = buildTargetAudienceLabel(data.target_audience)
  items.push({ id: 'target_audience', label: 'Público-alvo', value: targetAudienceLabel, type: 'target_audience' })

  const interactionStyleLabel =
    data.interaction_style === 'numbered_options'
      ? 'Opções numeradas'
      : data.interaction_style === 'conversational'
        ? 'Conversa natural'
        : data.interaction_style === 'hybrid'
          ? 'Misto'
          : ''
  items.push({ id: 'interaction_style', label: 'Estilo de respostas', value: interactionStyleLabel, type: 'interaction_style' })

  if (Array.isArray(data.services) && data.services.length > 0) {
    const defaultMins = data.schedule?.interval_minutes
    data.services.forEach((s: any, i: number) => {
      items.push({ id: `service_${i}`, label: `Serviço ${i + 1}`, value: s.name || '', type: 'service' })
      items.push({
        id: `service_duration_${i}`,
        label: `${s.name || 'Serviço'} (duração)`,
        value: s.duration_minutes != null ? `${s.duration_minutes} min` : defaultMins ? `${defaultMins} min` : '',
        type: 'service_duration',
      })
      items.push({
        id: `service_price_${i}`,
        label: `${s.name || 'Serviço'} (valor)`,
        value: s.base_price != null ? `R$ ${s.base_price}` : '',
        type: 'service_price',
      })
    })
  } else {
    items.push({ id: 'service_0', label: 'Serviço', value: '', type: 'service' })
  }

  if ((data.context === 'booking' || data.context === 'both') && Array.isArray(data.holidays_attend)) {
    const val = data.holidays_attend.length > 0
      ? `${data.holidays_attend.length} feriado(s)`
      : 'Não configurado'
    items.push({ id: 'holidays', label: 'Feriados em que atende', value: val, type: 'holidays' })
  } else if (data.context === 'booking' || data.context === 'both') {
    items.push({ id: 'holidays', label: 'Feriados em que atende', value: 'Não configurado', type: 'holidays' })
  }

  if ((data.context === 'booking' || data.context === 'both') && Array.isArray(data.closure_periods)) {
    const val = data.closure_periods.length > 0
      ? data.closure_periods.map((p: { start: string; end: string }) => `${p.start} a ${p.end}`).join('; ')
      : 'Não configurado'
    items.push({ id: 'closure_periods', label: 'Períodos de fechamento', value: val, type: 'closure_periods' })
  } else if (data.context === 'booking' || data.context === 'both') {
    items.push({ id: 'closure_periods', label: 'Períodos de fechamento', value: 'Não configurado', type: 'closure_periods' })
  }

  if ((data.context === 'booking' || data.context === 'both') && data.allow_sequence_booking) {
    const seq = data.sequence_eligible_services || []
    items.push({ id: 'sequence_eligible_services', label: 'Serviços que podem ser combinados', value: seq.length ? seq.join(', ') : 'Nenhum selecionado', type: 'sequence_eligible_services' })
  }

  if (Array.isArray(data.staff) && data.staff.length > 0) {
    data.staff.forEach((m: any, i: number) => {
      if (m?.name) items.push({ id: `staff_${i}`, label: 'Colaborador', value: m.name, type: 'business_name' })
    })
  }

  if (Array.isArray(data.dynamic_variables) && data.dynamic_variables.length > 0) {
    data.dynamic_variables.forEach((v: any, i: number) => {
      const label = v.label || v.key || `Variável ${i + 1}`
      items.push({ id: `variable_${i}`, label, value: label, type: 'variable' })
    })
  }

  if (Array.isArray(data.faq) && data.faq.length > 0) {
    data.faq.forEach((f: any, i: number) => {
      const val = `${(f.question || '').slice(0, 50)}${(f.question || '').length > 50 ? '...' : ''} → ${(f.answer || '').slice(0, 30)}...`
      items.push({ id: `faq_${i}`, label: 'FAQ', value: val, type: 'faq' })
    })
  }

  return items
}

function buildEditableItems(data: any) {
  const items: Array<{ id: string; label: string; value: string; type: string }> = []
  if (data.business_name) items.push({ id: 'business_name', label: 'Nome do negócio', value: data.business_name, type: 'business_name' })
  if (data.business_type) items.push({ id: 'business_type', label: 'Tipo de negócio', value: data.business_type, type: 'business_type' })

  if (data.context) {
    const label = data.context === 'booking' ? 'Agendamento' : data.context === 'quote' ? 'Orçamento' : 'Agendamento + Orçamento'
    items.push({ id: 'context', label: 'Contexto', value: label, type: 'context' })
  }

  // Serviços logo após contexto (booking/both) — todos visíveis e editáveis (nome, duração e preço sempre)
  if (Array.isArray(data.services) && data.services.length > 0) {
    const defaultMins = data.schedule?.interval_minutes
    data.services.forEach((s: any, i: number) => {
      items.push({ id: `service_${i}`, label: `Serviço ${i + 1}`, value: s.name, type: 'service' })
      items.push({
        id: `service_duration_${i}`,
        label: `${s.name} (duração)`,
        value: s.duration_minutes != null ? `${s.duration_minutes} min` : defaultMins ? `${defaultMins} min` : '',
        type: 'service_duration',
      })
      items.push({
        id: `service_price_${i}`,
        label: `${s.name} (valor)`,
        value: s.base_price != null ? `R$ ${s.base_price}` : '',
        type: 'service_price',
      })
    })
  }

  if (data.location_mode) {
    const locLabel = data.location_mode === 'fixed' ? 'Ponto fixo' : 'Atende no local do cliente'
    items.push({ id: 'location_mode', label: 'Localização', value: locLabel, type: 'service_area' })
  }
  if (data.location_mode === 'fixed' && data.establishment_address?.logradouro) {
    const a = data.establishment_address
    const val = `${a.logradouro}, ${a.numero}${a.complemento ? ` ${a.complemento}` : ''} - ${a.bairro}, ${a.localidade}/${a.uf}`
    items.push({ id: 'establishment_address', label: 'Endereço', value: val, type: 'establishment_address' })
  }
  if (data.service_area?.region || data.service_area?.coverage) {
    const cov = data.service_area?.coverage ? ` (${data.service_area.coverage})` : ''
    const val = `${data.service_area?.region || ''}${cov}`.trim()
    if (val) items.push({ id: 'service_area', label: 'Região de atendimento', value: val, type: 'service_area' })
  }

  if (data.tone_of_voice) {
    const toneLabel =
      data.tone_of_voice === 'formal'
        ? 'Formal'
        : data.tone_of_voice === 'friendly'
          ? 'Amigável'
          : data.tone_of_voice === 'professional'
            ? 'Profissional'
            : 'Engraçado'
    items.push({ id: 'tone_of_voice', label: 'Tom', value: toneLabel, type: 'tone_of_voice' })
  }

  if (
    data.schedule &&
    Array.isArray(data.schedule.days_of_week) &&
    data.schedule.days_of_week.length > 0 &&
    data.schedule.start_time &&
    data.schedule.end_time
  ) {
    const daysLabels: Record<string, string> = {
      monday: 'Segunda',
      tuesday: 'Terça',
      wednesday: 'Quarta',
      thursday: 'Quinta',
      friday: 'Sexta',
      saturday: 'Sábado',
      sunday: 'Domingo',
    }
    const daysPt = data.schedule.days_of_week.map((d: string) => daysLabels[d] || d).join(', ')
    const breaks =
      Array.isArray(data.schedule.breaks) && data.schedule.breaks.length > 0
        ? ` (pausa ${data.schedule.breaks.map((b: any) => `${b.start} às ${b.end}`).join(', ')})`
        : ''
    items.push({
      id: 'schedule',
      label: 'Horário de funcionamento',
      value: `${daysPt} - ${data.schedule.start_time} às ${data.schedule.end_time}${breaks}`,
      type: 'schedule',
    })
  }

  if (data.schedule?.interval_minutes) {
    items.push({
      id: 'schedule_interval',
      label: 'Intervalo entre atendimentos',
      value: `${data.schedule.interval_minutes} min`,
      type: 'schedule_interval',
    })
  }

  if (data.schedule?.min_booking_lead_minutes != null) {
    items.push({
      id: 'min_booking_lead',
      label: 'Antecedência mínima para agendamento',
      value: `${data.schedule.min_booking_lead_minutes} min`,
      type: 'min_booking_lead',
    })
  }

  if (data.policies) {
    const note = typeof data.policies?.note === 'string' ? data.policies.note.trim() : ''
    items.push({
      id: 'policies',
      label: 'Políticas',
      value: note ? note : 'Sem políticas por enquanto',
      type: 'policies',
    })
  }

  if (data.handoff_mode) {
    const handoffLabel =
      data.handoff_mode === 'always' ? 'Sempre humano' : data.handoff_mode === 'conditional' ? 'Condicional (alguns casos)' : 'Automático'
    items.push({ id: 'handoff_mode', label: 'Passar para humano', value: handoffLabel, type: 'tone_of_voice' })
  }

  if (data.target_audience) {
    items.push({ id: 'target_audience', label: 'Público-alvo', value: buildTargetAudienceLabel(data.target_audience), type: 'target_audience' })
  }

  if (data.interaction_style) {
    const interactionStyleLabel =
      data.interaction_style === 'numbered_options'
        ? 'Opções numeradas'
        : data.interaction_style === 'conversational'
          ? 'Conversa natural'
          : 'Misto'
    items.push({ id: 'interaction_style', label: 'Estilo de respostas', value: interactionStyleLabel, type: 'interaction_style' })
  }

  // Feriados (booking/both) — sempre mostrar para poder editar/adicionar
  if (data.context === 'booking' || data.context === 'both') {
    const holidays = data.holidays_attend
    const val = Array.isArray(holidays) && holidays.length > 0
      ? `${holidays.length} feriado(s): ${holidays.slice(0, 3).map((d: string) => d.split('-').reverse().join('/')).join(', ')}${holidays.length > 3 ? '...' : ''}`
      : 'Não configurado'
    items.push({ id: 'holidays', label: 'Feriados em que atende', value: val, type: 'holidays' })
  }

  // Períodos de fechamento (booking/both) — sempre mostrar para poder editar/adicionar
  if (data.context === 'booking' || data.context === 'both') {
    const periods = data.closure_periods
    const val = Array.isArray(periods) && periods.length > 0
      ? periods.map((p: { start: string; end: string }) => `${p.start} a ${p.end}`).join('; ')
      : 'Não configurado'
    items.push({ id: 'closure_periods', label: 'Períodos de fechamento', value: val, type: 'closure_periods' })
  }

  // Sequência de serviços (booking/both, quando permitido)
  if ((data.context === 'booking' || data.context === 'both') && data.allow_sequence_booking) {
    const seq = data.sequence_eligible_services
    const val = Array.isArray(seq) && seq.length > 0 ? seq.join(', ') : 'Nenhum selecionado'
    items.push({ id: 'sequence_eligible_services', label: 'Serviços que podem ser combinados', value: val, type: 'sequence_eligible_services' })
  }

  if (Array.isArray(data.staff) && data.staff.length > 0) {
    data.staff.forEach((m: any, i: number) => {
      if (m?.name) items.push({ id: `staff_${i}`, label: 'Colaborador', value: m.name, type: 'business_name' })
    })
  }

  if (Array.isArray(data.dynamic_variables) && data.dynamic_variables.length > 0) {
    data.dynamic_variables.forEach((v: any, i: number) => {
      const label = v.label || v.key || `Variável ${i + 1}`
      items.push({ id: `variable_${i}`, label, value: label, type: 'variable' })
    })
  }

  if (Array.isArray(data.faq) && data.faq.length > 0) {
    data.faq.forEach((f: any, i: number) => {
      const val = `${(f.question || '').slice(0, 50)}${(f.question || '').length > 50 ? '...' : ''} → ${(f.answer || '').slice(0, 30)}...`
      items.push({ id: `faq_${i}`, label: 'FAQ', value: val, type: 'faq' })
    })
  }

  return items
}

function buildServiceItems(services: Array<{ name: string }> = []) {
  return services.map((s, i) => ({
    id: `service_${i}`,
    label: 'Serviço',
    value: s.name,
    type: 'service',
  }))
}

function buildServicesReviewMessage(services: Array<{ name: string }> = []): string {
  const names = services.map((s) => s?.name).filter(Boolean)
  const listed = names.length > 0 ? names.join(', ') : 'nenhum serviço informado'
  return (
    `Certo, entendi que os serviços que você oferece são: ${listed}.\n\n` +
    'Tem mais algum serviço além desses? Se quiser, selecione sugestões abaixo ou adicione mais serviços separados por vírgula.'
  )
}

function buildServiceDurationItems(services: Array<{ name: string; duration_minutes?: number }> = [], defaultMinutes?: number) {
  return services.map((s, i) => {
    const minutes = s.duration_minutes ?? defaultMinutes
    const value = minutes ? `${minutes} min` : ''
    return {
      id: `service_duration_${i}`,
      label: s.name,
      value,
      type: 'service_duration',
    }
  })
}

function buildServicePriceItems(services: Array<{ name: string; base_price?: number }> = []) {
  return services.map((s, i) => ({
    id: `service_price_${i}`,
    label: s.name,
    value: s.base_price != null ? `R$ ${s.base_price}` : '',
    type: 'service_price',
  }))
}

function parsePrice(value: string): number | null {
  const cleaned = (value || '').replace(/\D/g, '')
  if (!cleaned) return null
  const n = parseInt(cleaned, 10)
  return Number.isNaN(n) || n < 0 ? null : n
}

function parseIntervalMinutes(message: string): number | null {
  const match = message.match(/(\d{1,3})/)
  if (!match) return null
  const value = parseInt(match[1], 10)
  if (Number.isNaN(value) || value < 5 || value > 240) return null
  return value
}

function parseDurationMinutes(message: string): number | null {
  const match = message.match(/(\d{1,3})/)
  if (!match) return null
  const value = parseInt(match[1], 10)
  if (Number.isNaN(value) || value < 5 || value > 600) return null
  return value
}

function findServiceIndexByText(services: Array<{ name: string }>, text: string): number {
  const lower = (text || '').toLowerCase()
  if (!lower) return -1
  for (let i = 0; i < services.length; i += 1) {
    const name = (services[i]?.name || '').toLowerCase()
    if (name && lower.includes(name)) return i
  }
  return -1
}

function shouldReplaceServices(text: string): boolean {
  const lower = (text || '').toLowerCase()
  return (
    lower.includes('meus serviços são') ||
    lower.includes('meus servicos sao') ||
    lower.includes('serviços:') ||
    lower.includes('servicos:')
  )
}

function attachSummaryPayload(resp: OnboardingResponse, data: any): OnboardingResponse {
  if (resp.next_step !== 'summary') return resp
  if (!(data?.business_name && data?.business_type && data?.context)) return resp
  return {
    ...resp,
    assistant_message: 'Edite os campos abaixo se quiser alterar algo.',
    editable_items: buildEditableItems(data),
    action_options: ['Está correto', 'Quero ajustar'],
    requires_action: 'summary_confirmation',
  }
}

function parseEditCommand(message: string): { id: string; value: string } | null {
  const m = message.match(/^edit_([^:]+):(.+)$/)
  if (!m) return null
  return { id: m[1].trim(), value: m[2].trim() }
}

function parseDeleteCommand(message: string): { id: string } | null {
  const m = message.match(/^delete_([^:]+)$/)
  if (!m) return null
  return { id: m[1].trim() }
}

function parseTone(value: string): 'formal' | 'friendly' | 'professional' | 'funny' | null {
  const v = (value || '').toLowerCase()
  if (v.includes('formal') || v.includes('sério') || v.includes('serio')) return 'formal'
  if (v.includes('amig') || v.includes('friendly')) return 'friendly'
  if (v.includes('prof')) return 'professional'
  if (v.includes('engra') || v.includes('funny')) return 'funny'
  return null
}

type TargetAudienceResult =
  | { mode: 'all' }
  | { mode: 'women_only' | 'men_only' | 'kids_only' }
  | { mode: 'custom'; note?: string }
  | { modes: ('women_only' | 'men_only' | 'kids_only' | 'custom')[]; note?: string }

function buildTargetAudienceLabel(ta: { mode?: string; modes?: string[]; note?: string } | null | undefined): string {
  if (!ta) return ''
  const labels: Record<string, string> = {
    all: 'Todos os públicos',
    women_only: 'Somente mulheres',
    men_only: 'Somente homens',
    kids_only: 'Infantil',
    custom: ta.note ? `Personalizado (${ta.note})` : 'Personalizado',
  }
  if (Array.isArray(ta.modes) && ta.modes.length > 0) {
    return ta.modes.map((m) => labels[m] || m).filter(Boolean).join(' e ')
  }
  if (ta.mode) return labels[ta.mode] || ta.mode
  return 'Todos os públicos'
}

function parseTargetAudience(value: string): TargetAudienceResult | null {
  const v = (value || '').toLowerCase().trim()
  if (!v) return null
  if (v.includes('todos') || v.includes('todas') || v.includes('geral')) return { mode: 'all' }
  const modes: ('women_only' | 'men_only' | 'kids_only' | 'custom')[] = []
  if (v.includes('somente mulheres') || v.includes('so mulheres') || v.includes('feminino')) modes.push('women_only')
  if (v.includes('somente homens') || v.includes('so homens') || v.includes('masculino')) modes.push('men_only')
  if (v.includes('infantil') || v.includes('crianca') || v.includes('crianÃ§a')) modes.push('kids_only')
  if (v.includes('outro') || v.includes('especifico') || v.includes('especÃ­fico')) {
    const note = value.replace(/^(outro[s]?|publico especifico|publico especifico:)\s*[:\-]?\s*/i, '').trim()
    modes.push('custom')
    if (modes.length === 1) return { mode: 'custom', note: note || undefined }
    return { modes, note: note || undefined }
  }
  if (modes.length > 1) return { modes }
  if (modes.length === 1) return { mode: modes[0] as 'women_only' | 'men_only' | 'kids_only' }
  return { mode: 'custom', note: value.trim() }
}

function parseInteractionStyle(value: string): 'numbered_options' | 'conversational' | 'hybrid' | null {
  const v = (value || '').toLowerCase()
  if (v.includes('misto') || v.includes('hibrido') || v.includes('hÃ­brido')) return 'hybrid'
  if (v.includes('numerad') || v.includes('numero') || v.includes('nÃºmero')) return 'numbered_options'
  if (v.includes('conversa') || v.includes('natural') || v.includes('humana')) return 'conversational'
  return null
}

function applyInlineEdit(updated: Record<string, any>, id: string, value: string): Record<string, any> {
  if (id === 'business_name') updated.business_name = value
  else if (id === 'business_type') updated.business_type = value
  else if (id === 'service_area') updated.service_area = { ...(updated.service_area || {}), region: value }
  else if (id === 'tone_of_voice') {
    const t = parseTone(value)
    if (t) updated.tone_of_voice = t
  } else if (id === 'context') {
    const c = parseContext(value)
    if (c) updated.context = c
  } else if (id === 'schedule_interval') {
    const mins = parseIntervalMinutes(value)
    if (mins != null) updated.schedule = { ...(updated.schedule || {}), interval_minutes: mins }
  } else if (id === 'min_booking_lead') {
    const mins = parseIntervalMinutes(value)
    if (mins != null && [5, 10, 15, 20, 30].includes(mins)) {
      updated.schedule = { ...(updated.schedule || {}), min_booking_lead_minutes: mins }
    }
  } else if (id === 'schedule') {
    const partial = parseScheduleNarrative(value)
    const days = parseDaysFromText(value)
    updated.schedule = {
      ...(updated.schedule || {}),
      ...(days.length > 0 ? { days_of_week: days } : {}),
      ...(partial.start_time ? { start_time: partial.start_time } : {}),
      ...(partial.end_time ? { end_time: partial.end_time } : {}),
      ...(partial.breaks && partial.breaks.length > 0 ? { breaks: partial.breaks } : {}),
    }
    if (partial.breaks && partial.breaks.length > 0) {
      updated.schedule_breaks_configured = true
    }
  } else if (id.startsWith('service_duration_')) {
    const idx = parseInt(id.replace('service_duration_', ''), 10)
    const services = Array.isArray(updated.services) ? [...updated.services] : []
    const mins = parseDurationMinutes(value)
    if (!Number.isNaN(idx) && idx >= 0 && idx < services.length && mins != null) {
      services[idx] = { ...(services[idx] || {}), duration_minutes: mins }
      updated.services = services
    }
  } else if (id.startsWith('service_price_')) {
    const idx = parseInt(id.replace('service_price_', ''), 10)
    const services = Array.isArray(updated.services) ? [...updated.services] : []
    const price = parsePrice(value)
    if (!Number.isNaN(idx) && idx >= 0 && idx < services.length) {
      services[idx] = { ...(services[idx] || {}), base_price: price ?? undefined }
      updated.services = services
    }
  } else if (id.startsWith('service_') && !id.startsWith('service_price_') && !id.startsWith('service_duration_')) {
    const idx = parseInt(id.replace('service_', ''), 10)
    const services = Array.isArray(updated.services) ? [...updated.services] : []
    if (!Number.isNaN(idx) && idx >= 0 && idx < services.length) {
      services[idx] = { ...(services[idx] || {}), name: value }
      updated.services = services
      updated.services_confirmed = false
    }
  } else if (id === 'policies') {
    updated.policies = { note: value }
  } else if (id === 'handoff_mode') {
    const h = value.toLowerCase()
    if (h.includes('sempre') || h.includes('always')) updated.handoff_mode = 'always'
    else if (h.includes('condicional') || h.includes('alguns')) updated.handoff_mode = 'conditional'
    else if (h.includes('automÃ¡tico') || h.includes('automatic')) updated.handoff_mode = 'never'
  } else if (id === 'target_audience') {
    const audience = parseTargetAudience(value)
    if (audience) updated.target_audience = audience
  } else if (id === 'interaction_style') {
    const style = parseInteractionStyle(value)
    if (style) updated.interaction_style = style
  } else if (id.startsWith('staff_')) {
    const idx = parseInt(id.replace('staff_', ''), 10)
    const staff = Array.isArray(updated.staff) ? [...updated.staff] : []
    if (!Number.isNaN(idx) && idx >= 0 && idx < staff.length) {
      staff[idx] = { ...(staff[idx] || {}), name: value.trim() }
      updated.staff = staff
    }
  } else if (id === 'closure_periods') {
    const parts = value.split(/[;ï¼Œ]/).map((p) => p.trim()).filter(Boolean)
    const periods: Array<{ start: string; end: string }> = []
    for (const part of parts) {
      const p = parseClosurePeriod(part)
      if (p) periods.push(p)
    }
    if (periods.length > 0) {
      updated.closure_periods = periods
      updated.closure_skipped = true
    }
  } else if (id === 'sequence_eligible_services') {
    const names = value.split(',').map((s) => s.trim()).filter(Boolean)
    const validNames = (updated.services || []).map((s: any) => s?.name).filter(Boolean)
    updated.sequence_eligible_services = names.filter((n) => validNames.includes(n))
  }

  return updated
}

function computeMissing(data: Partial<BusinessModelExtraction>) {
  return identifyMissingFields(data, (data as any).context)
}

function makeFlowState(step: string, data: any): FlowState {
  return {
    step,
    collected_data: data,
    missing_fields: computeMissing(data),
    context: data?.context,
  }
}

function isExplicitServicesList(message: string) {
  const words = message.trim().split(/\s+/).filter(Boolean).length
  const hasCommas = message.includes(',')
  const parts = message.split(',').map((p) => p.trim()).filter(Boolean)
  return hasCommas && words < 15 && parts.length > 0 && parts.every((p) => p.split(/\s+/).length < 6)
}

function parseContext(message: string): 'booking' | 'quote' | 'both' | null {
  const m = (message || '').toLowerCase()
  if (m.includes('ambos')) return 'both'
  const booking =
    m.includes('agendamento') ||
    m.includes('agendar') ||
    m.includes('marcar horario') ||
    m.includes('marcar horário') ||
    m.includes('marcação') ||
    m.includes('marcacao')
  const quote =
    m.includes('orçamento') ||
    m.includes('orcamento') ||
    m.includes('orcar') ||
    m.includes('cotação') ||
    m.includes('cotacao')
  if (booking && quote) return 'both'
  if (booking) return 'booking'
  if (quote) return 'quote'
  return null
}

function normalizeContextValue(value: unknown): 'booking' | 'quote' | 'both' | null {
  if (value === 'booking' || value === 'quote' || value === 'both') return value
  if (typeof value !== 'string') return null
  return parseContext(value)
}

function combineContext(
  base: 'booking' | 'quote' | 'both' | null,
  incoming: 'booking' | 'quote' | 'both' | null
): 'booking' | 'quote' | 'both' | null {
  if (!base) return incoming
  if (!incoming) return base
  if (base === 'both' || incoming === 'both') return 'both'
  return base === incoming ? base : 'both'
}

function parseIntroDiscoveryChoice(message: string): 'start' | 'tutorial' | null {
  const m = normalizeForComparison(message)
  if (!m) return null
  if (/nao.*(explicar|o que voce faz|o que vc faz)/.test(m)) return 'tutorial'
  if (/explicar|o que voce faz|como funciona/.test(m)) return 'tutorial'
  if (/(sim|ja conheco|vamos iniciar|iniciar|comecar)/.test(m)) return 'start'
  return null
}

function parsePostTutorialChoice(message: string): 'start' | 'later' | null {
  const m = normalizeForComparison(message)
  if (!m) return null
  if (/configurar depois|depois|agora nao|outro dia/.test(m)) return 'later'
  if (/(entendi|quero|vamos|iniciar|comecar).*(assistente|agora|configurar)/.test(m)) return 'start'
  if (/sim/.test(m)) return 'start'
  return null
}

function isPlatformAssistantIntentService(value: string): boolean {
  const normalized = normalizeForComparison(value)
  if (!normalized) return false

  const hasAssistantTerm = /\b(assistente|bot|robo|robot|ia|sistema|plataforma)\b/.test(normalized)
  const hasProductTerm = /\b(agendamento|agendar|orcamento|orcar|atendimento)\b/.test(normalized)
  const hasConfigVerb = /\b(quero|preciso|gostaria|montar|criar|configurar|ter)\b/.test(normalized)

  if (hasAssistantTerm && hasProductTerm) return true
  if (hasAssistantTerm && hasConfigVerb) return true
  if (/^(assistente|bot)\s+de\s+(agendamento|orcamento|atendimento)$/.test(normalized)) return true
  return false
}

function sanitizeExtractedServices(
  services: any[] | undefined,
  message: string
): { services: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>; contextHint: 'booking' | 'quote' | 'both' | null } {
  if (!Array.isArray(services)) {
    return { services: [], contextHint: parseContext(message) }
  }

  let contextHint: 'booking' | 'quote' | 'both' | null = parseContext(message)
  const cleaned: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }> = []

  for (const item of services) {
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    if (!name) continue

    if (isPlatformAssistantIntentService(name)) {
      contextHint = combineContext(contextHint, parseContext(name))
      continue
    }

    cleaned.push({
      ...item,
      name,
    })
  }

  const unique = cleaned.filter((s, i, self) => {
    const key = normalizeForComparison(s.name)
    return key && i === self.findIndex((x) => normalizeForComparison(x.name) === key)
  })

  return { services: unique, contextHint }
}

function sanitizeExtractionResult(
  extractedRaw: Partial<BusinessModelExtraction> | null | undefined,
  message: string
): Partial<BusinessModelExtraction> {
  const extracted = { ...(extractedRaw || {}) } as Partial<BusinessModelExtraction>
  const aiContext = normalizeContextValue((extracted as any).context)
  const { services, contextHint } = sanitizeExtractedServices(extracted.services as any, message)

  if (services.length > 0) extracted.services = services
  else delete (extracted as any).services

  const mergedContext = combineContext(aiContext, contextHint)
  if (mergedContext) extracted.context = mergedContext
  else delete (extracted as any).context

  return extracted
}

function parseDaysFromText(message: string): string[] {
  const lower = (message || '').toLowerCase()

  if (lower.includes('segunda a sexta') || lower.includes('segunda-feira a sexta-feira')) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
  }
  if (lower.includes('segunda a sábado') || lower.includes('segunda-feira a sábado')) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  }
  if (lower.includes('todos os dias')) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }

  const dayMap: Record<string, string> = {
    segunda: 'monday',
    terça: 'tuesday',
    terca: 'tuesday',
    quarta: 'wednesday',
    quinta: 'thursday',
    sexta: 'friday',
    sábado: 'saturday',
    sabado: 'saturday',
    domingo: 'sunday',
  }

  const days: string[] = []
  for (const [pt, en] of Object.entries(dayMap)) {
    if (lower.includes(pt) && !days.includes(en)) days.push(en)
  }
  return days
}

function parseStaffNames(message: string): string[] {
  const text = (message || '')
    .replace(/\r?\n/g, ',')
    .replace(/;/g, ',')
    .replace(/^(colaboradores?|funcion[aá]rios?|equipe|atendentes?)\s*:\s*/i, '')
    .trim()
  if (!text) return []

  const parts = text
    .split(',')
    .flatMap((p) => p.split(/\s+e\s+/i))
    .map((p) => p.trim())
    .filter(Boolean)

  const blacklist = ['eu', 'só eu', 'so eu', 'sozinho', 'sozinha', 'apenas eu', 'somente eu']
  return parts.filter((name) => !blacklist.includes(name.toLowerCase()))
}

function getStaffSetupIndex(data: any): number {
  const idx = Number(data?.staff_setup_index)
  return Number.isFinite(idx) && idx >= 0 ? idx : 0
}

function updateStaffAtIndex(staff: any[], idx: number, patch: any) {
  const next = Array.isArray(staff) ? [...staff] : []
  if (!next[idx]) next[idx] = { name: '' }
  next[idx] = { ...next[idx], ...patch }
  return next
}

function parseTimeRange(message: string): { start: string; end: string } | null {
  const msg = (message || '').toLowerCase()

  // Aceitar formatos comuns:
  // - "das 8 as 18"
  // - "das 9h até as 18h"
  // - "08:00 as 18:00"
  // - "8-18"
  const patterns = [
    /(?:das|de)\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\s*(?:às|as|a|até|ate|-)\s*(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?/i,
    /(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\s*(?:às|as|a|até|ate|-)\s*(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?/i,
  ]

  let m: RegExpMatchArray | null = null
  for (const p of patterns) {
    m = msg.match(p)
    if (m) break
  }
  if (!m) return null

  const sh = String(parseInt(m[1])).padStart(2, '0')
  const sm = m[2] ? String(parseInt(m[2])).padStart(2, '0') : '00'
  const eh = String(parseInt(m[3])).padStart(2, '0')
  const em = m[4] ? String(parseInt(m[4])).padStart(2, '0') : '00'
  return { start: `${sh}:${sm}`, end: `${eh}:${em}` }
}

function parseSingleTime(message: string): string | null {
  const m = (message || '').toLowerCase().match(/(?:às|as|a)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\b/)
  if (!m) return null
  const hh = String(parseInt(m[1])).padStart(2, '0')
  const mm = m[2] ? String(parseInt(m[2])).padStart(2, '0') : '00'
  return `${hh}:${mm}`
}

function parseBreaksFromText(message: string): Array<{ start: string; end: string }> {
  const text = (message || '').toLowerCase()
  const breaks: Array<{ start: string; end: string }> = []

  // Caso: "pausa ... 12:00 as 13:00" / "intervalo ... 12 às 13"
  const explicit = text.match(
    /(?:pausa|intervalo|almo[cç]o|folga|descanso).*?(?:das|de)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\s*(?:às|as|a|até|ate|-)\s*(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?/i
  )
  if (explicit) {
    const sh = String(parseInt(explicit[1])).padStart(2, '0')
    const sm = explicit[2] ? String(parseInt(explicit[2])).padStart(2, '0') : '00'
    const eh = String(parseInt(explicit[3])).padStart(2, '0')
    const em = explicit[4] ? String(parseInt(explicit[4])).padStart(2, '0') : '00'
    breaks.push({ start: `${sh}:${sm}`, end: `${eh}:${em}` })
    return breaks
  }

  // Caso: "pausa ... de meio dia até as 13"
  const midday = text.match(
    /(?:pausa|intervalo|almo[cç]o|folga|descanso).*?(meio\s*dia|12h|12:00|12)\s*(?:até|ate)\s*(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?/i
  )
  if (midday) {
    const eh = String(parseInt(midday[2])).padStart(2, '0')
    const em = midday[3] ? String(parseInt(midday[3])).padStart(2, '0') : '00'
    breaks.push({ start: '12:00', end: `${eh}:${em}` })
    return breaks
  }

  return breaks
}

function parseScheduleNarrative(message: string): {
  start_time?: string
  end_time?: string
  breaks?: Array<{ start: string; end: string }>
} {
  const text = (message || '').toLowerCase()
  const out: { start_time?: string; end_time?: string; breaks?: Array<{ start: string; end: string }> } = {}

  const explicitBreaks = parseBreaksFromText(text)
  if (explicitBreaks.length > 0) out.breaks = explicitBreaks

  const breakKeywordIndex = text.search(/\b(?:pausa|intervalo|almo[cç]o|folga|descanso)\b/)
  const textBeforeBreak = breakKeywordIndex >= 0 ? text.slice(0, breakKeywordIndex) : text

  // Tentativa 1: range completo em uma tacada
  const range = parseTimeRange(textBeforeBreak) || parseTimeRange(text)
  if (range) {
    out.start_time = range.start
    out.end_time = range.end
  }

  // Tentativa 2: “até meio dia … volto às 13 … até às 17”
  const hasMidday = /meio\s*dia/.test(text)
  const returnMatch = text.match(/(?:volto|retorno)\s*(?:às|as)?\s*(\d{1,2})(?::(\d{2}))?/i)
  const endMatch = text.match(/(?:vou\s*)?(?:até|ate)\s*(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?/i)

  if (hasMidday && returnMatch) {
    const rh = String(parseInt(returnMatch[1])).padStart(2, '0')
    const rm = returnMatch[2] ? String(parseInt(returnMatch[2])).padStart(2, '0') : '00'
    out.breaks = [{ start: '12:00', end: `${rh}:${rm}` }]
  }

  if (!out.end_time && endMatch) {
    const eh = String(parseInt(endMatch[1])).padStart(2, '0')
    const em = endMatch[2] ? String(parseInt(endMatch[2])).padStart(2, '0') : '00'
    out.end_time = `${eh}:${em}`
  }

  // Start explícito (sem inferir): “começo às 8”, “a partir das 8”, “abro às 8”
  const startMatch = text.match(/(?:começo|comeco|inicio|a partir|abro|atendo\s+a\s+partir)\s*(?:às|as|de|das)?\s*(\d{1,2})(?::(\d{2}))?/i)
  if (!out.start_time && startMatch) {
    const sh = String(parseInt(startMatch[1])).padStart(2, '0')
    const sm = startMatch[2] ? String(parseInt(startMatch[2])).padStart(2, '0') : '00'
    out.start_time = `${sh}:${sm}`
  }

  // Se o range encontrado for exatamente a pausa, ignore para evitar confusão.
  if (
    out.start_time &&
    out.end_time &&
    Array.isArray(out.breaks) &&
    out.breaks.length > 0 &&
    out.breaks.some((b) => b.start === out.start_time && b.end === out.end_time)
  ) {
    out.start_time = undefined
    out.end_time = undefined
  }

  return out
}

function parseFaqPairs(message: string): Array<{ question: string; answer: string }> {
  const text = (message || '').trim()
  if (!text) return []

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const pairs: Array<{ question: string; answer: string }> = []

  // Estratégia 1: padrões “Pergunta? Resposta” no mesmo trecho
  // Ex.: “Faz pintura? Não”
  const inlineRegex = /([^?\n]{3,}?)\?\s*([^\n]{1,200})/g
  const inlineMatches = [...text.matchAll(inlineRegex)]
  for (const m of inlineMatches) {
    const q = (m[1] || '').trim()
    const a = (m[2] || '').trim()
    if (q && a) pairs.push({ question: q, answer: a.replace(/\.$/, '') })
  }
  if (pairs.length > 0) return pairs

  // Estratégia 2: linhas alternadas (pergunta termina com ?; resposta na próxima linha)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('?')) continue
    const [qPart, aSameLine] = line.split('?')
    const question = (qPart || '').trim()
    const sameLineAnswer = (aSameLine || '').trim()
    let answer = sameLineAnswer
    if (!answer) {
      // resposta na próxima linha útil
      const next = lines[i + 1]
      if (next && !next.includes('?')) {
        answer = next.trim()
        i += 1
      }
    }
    if (question && answer) pairs.push({ question, answer: answer.replace(/\.$/, '') })
  }

  return pairs
}

async function processMessage(
  message: string,
  currentStep: string,
  collectedData: Record<string, any>,
  session: any,
  supabaseAdmin: any
): Promise<OnboardingResponse> {
  const text = (message || '').trim()
  const lower = text.toLowerCase()
  const sessionId = session?.session_id

  // ——— Handler global: confirmação de recomeçar ———
  if (currentStep === 'restart_confirm') {
    const confirmRestart = /^(sim|quero\s+recome[cç]ar|recome[cç]ar|confirmo|pode\s+apagar)/i.test(lower)
    const cancelRestart = /^(n[aã]o|cancelar|deixa|continuar|n[aã]o\s+quero)/i.test(lower)
    if (confirmRestart) {
      await supabaseAdmin
        .from('onboarding_sessions')
        .update({
          current_step_key: 'welcome',
          collected_data: {},
          updated_at: new Date().toISOString(),
        })
        .eq('session_id', sessionId)
      return {
        assistant_message: `${buildGreetingDiscoveryMessage()}\n\nEscolha uma opção abaixo:`,
        next_step: 'welcome_intro_choice',
        extracted_data: {},
        action_options: INTRO_DISCOVERY_OPTIONS,
        requires_action: 'welcome_intro_choice',
      }
    }
    if (cancelRestart) {
      const previousStep = (collectedData?.__restart_previous_step as string) || 'welcome'
      return {
        assistant_message: 'Ok, continuamos de onde paramos.',
        next_step: previousStep,
        extracted_data: { __restart_previous_step: undefined },
      }
    }
  }

  // ——— Handlers globais: ajuda, resumo, recomeçar, repetir, o que faço agora ———
  const globalIntent = classifyGlobalIntent(text)
  if (globalIntent === 'restart') {
    return {
      assistant_message:
        'Recomeçar vai apagar o que você preencheu até aqui. Tem certeza?',
      next_step: 'restart_confirm',
      extracted_data: { __restart_previous_step: currentStep },
      action_options: ['Sim, recomeçar', 'Não'],
      requires_action: 'restart_confirm',
    }
  }
  if (globalIntent === 'summary') {
    const summaryText = generateSummary(collectedData)
    return {
      assistant_message: `Aqui está o resumo do que você já preencheu:\n\n${summaryText}\n\nPode continuar respondendo normalmente ou pedir para **editar** algo.`,
      next_step: currentStep,
    }
  }
  if (globalIntent === 'help' || globalIntent === 'what_can_i_do') {
    const hint = getStepContextualHint(currentStep)
    const intro = globalIntent === 'help'
      ? `${hint}\n\n${buildIntroTutorialMessage()}`
      : `Sem problemas! ${hint}`
    const { data: lastMsg } = await supabaseAdmin
      .from('onboarding_messages')
      .select('content, metadata')
      .eq('session_id', sessionId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const meta = (lastMsg?.metadata as Record<string, unknown>) || {}
    return {
      assistant_message: intro,
      next_step: currentStep,
      action_options: (meta.action_options as string[]) ?? undefined,
      requires_action: (meta.requires_action as string) ?? undefined,
      selectable_options: (meta.selectable_options as Array<{ id: string; label: string; value: string }>) ?? undefined,
      editable_items: (meta.editable_items as Array<{ id: string; label: string; value: string; type: string }>) ?? undefined,
    }
  }
  if (globalIntent === 'repeat') {
    const { data: lastMsg } = await supabaseAdmin
      .from('onboarding_messages')
      .select('content, metadata')
      .eq('session_id', sessionId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const content = lastMsg?.content ?? 'Não tenho a última pergunta aqui. Pode continuar respondendo ou pedir **ajuda** se quiser.'
    const meta = (lastMsg?.metadata as Record<string, unknown>) || {}
    return {
      assistant_message: content,
      next_step: currentStep,
      action_options: (meta.action_options as string[]) ?? undefined,
      requires_action: (meta.requires_action as string) ?? undefined,
      selectable_options: (meta.selectable_options as Array<{ id: string; label: string; value: string }>) ?? undefined,
      editable_items: (meta.editable_items as Array<{ id: string; label: string; value: string; type: string }>) ?? undefined,
    }
  }

  if (currentStep === 'welcome_intro_choice') {
    const choice = parseIntroDiscoveryChoice(text)
    if (!choice) {
      return {
        assistant_message: buildGreetingDiscoveryMessage(),
        next_step: 'welcome_intro_choice',
        action_options: INTRO_DISCOVERY_OPTIONS,
        requires_action: 'welcome_intro_choice',
      }
    }

    if (choice === 'start') {
      return {
        assistant_message:
          'Perfeito. Vamos começar a configuração.\n\nMe conta: qual é o seu ramo de atividade e o que você faz?',
        next_step: 'collect_free_text',
        extracted_data: {},
      }
    }

    return {
      assistant_message: `${buildIntroTutorialMessage()}\n\nQuando quiser, escolha uma opção abaixo:`,
      next_step: 'welcome_tutorial_cta',
      action_options: INTRO_TUTORIAL_CTA_OPTIONS,
      requires_action: 'welcome_tutorial_cta',
    }
  }

  if (currentStep === 'welcome_tutorial_cta') {
    const choice = parsePostTutorialChoice(text)
    if (!choice) {
      return {
        assistant_message: 'Quando quiser, escolha uma opção abaixo:',
        next_step: 'welcome_tutorial_cta',
        action_options: INTRO_TUTORIAL_CTA_OPTIONS,
        requires_action: 'welcome_tutorial_cta',
      }
    }

    if (choice === 'start') {
      return {
        assistant_message:
          'Ótimo. Vamos configurar seu assistente agora.\n\nMe conta: qual é o seu ramo de atividade e o que você faz?',
        next_step: 'collect_free_text',
        extracted_data: {},
      }
    }

    return {
      assistant_message: 'Sem problema. Quando quiser retomar, é só me chamar que eu continuo de onde paramos.',
      next_step: 'welcome_paused',
      extracted_data: {},
    }
  }

  if (currentStep === 'welcome_paused') {
    const choice = parsePostTutorialChoice(text)
    if (choice === 'start' || looksLikeBusinessSeedInput(text)) {
      return {
        assistant_message: 'Perfeito, vamos retomar.\n\nQual é o seu ramo de atividade e o que você faz?',
        next_step: 'collect_free_text',
        extracted_data: {},
      }
    }

    return {
      assistant_message:
        'Tudo certo. Quando quiser começar, responda "quero iniciar" que seguimos para a configuração.',
      next_step: 'welcome_paused',
      extracted_data: {},
    }
  }

  if (currentStep === 'welcome' && isGreetingOnlyMessage(text)) {
    return {
      assistant_message: buildGreetingDiscoveryMessage(),
      next_step: 'welcome_intro_choice',
      action_options: INTRO_DISCOVERY_OPTIONS,
      requires_action: 'welcome_intro_choice',
    }
  }

  // Edição/remoção inline via comandos (enviado pelo frontend ao clicar nos ícones).
  const editCmd = parseEditCommand(text)
  const delCmd = parseDeleteCommand(text)
  if (editCmd || delCmd) {
    let updated = { ...collectedData }

    if (editCmd) {
      const { id, value } = editCmd
      if (id === 'business_name') updated.business_name = value
      else if (id === 'business_type') updated.business_type = value
      else if (id === 'service_area') updated.service_area = { ...(updated.service_area || {}), region: value }
      else if (id === 'tone_of_voice') {
        const t = parseTone(value)
        if (t) updated.tone_of_voice = t
      } else if (id === 'context') {
        const c = parseContext(value)
        if (c) updated.context = c
      } else if (id === 'schedule_interval') {
        const mins = parseIntervalMinutes(value)
        if (mins != null) updated.schedule = { ...(updated.schedule || {}), interval_minutes: mins }
      } else if (id === 'min_booking_lead') {
        const mins = parseIntervalMinutes(value)
        if (mins != null && [5, 10, 15, 20, 30].includes(mins)) {
          updated.schedule = { ...(updated.schedule || {}), min_booking_lead_minutes: mins }
        }
      } else if (id === 'schedule') {
        const partial = parseScheduleNarrative(value)
        const days = parseDaysFromText(value)
        const nextSchedule = {
          ...(updated.schedule || {}),
          ...(days.length > 0 ? { days_of_week: days } : {}),
          ...(partial.start_time ? { start_time: partial.start_time } : {}),
          ...(partial.end_time ? { end_time: partial.end_time } : {}),
          ...(partial.breaks && partial.breaks.length > 0 ? { breaks: partial.breaks } : {}),
        }
        updated.schedule = nextSchedule
        if (partial.breaks && partial.breaks.length > 0) {
          updated.schedule_breaks_configured = true
        }
      } else if (id.startsWith('service_duration_')) {
        const idx = parseInt(id.replace('service_duration_', ''), 10)
        const services = Array.isArray(updated.services) ? [...updated.services] : []
        const mins = parseDurationMinutes(value)
        if (!Number.isNaN(idx) && idx >= 0 && idx < services.length && mins != null) {
          services[idx] = { ...(services[idx] || {}), duration_minutes: mins }
          updated.services = services
        }
      } else if (id.startsWith('service_price_')) {
        const idx = parseInt(id.replace('service_price_', ''), 10)
        const services = Array.isArray(updated.services) ? [...updated.services] : []
        const price = parsePrice(value)
        if (!Number.isNaN(idx) && idx >= 0 && idx < services.length) {
          services[idx] = { ...(services[idx] || {}), base_price: price ?? undefined }
          updated.services = services
        }
        if (currentStep === 'services_pricing') {
          return {
            assistant_message: 'Pode ajustar os valores abaixo ou clicar em Continuar quando terminar.',
            next_step: 'services_pricing',
            extracted_data: updated,
            editable_items: buildServicePriceItems(updated.services || []),
            action_options: ['Continuar'],
            requires_action: 'services_pricing',
          }
        }
      } else if (id.startsWith('service_') && !id.startsWith('service_price_') && !id.startsWith('service_duration_')) {
        const idx = parseInt(id.replace('service_', ''), 10)
        const services = Array.isArray(updated.services) ? [...updated.services] : []
        if (!Number.isNaN(idx) && idx >= 0 && idx < services.length) {
          services[idx] = { ...(services[idx] || {}), name: value }
          updated.services = services
          updated.services_confirmed = false
        }
      } else if (id === 'policies') {
        updated.policies = { note: value }
      } else if (id === 'handoff_mode') {
        const h = value.toLowerCase()
        if (h.includes('sempre') || h.includes('always')) updated.handoff_mode = 'always'
        else if (h.includes('condicional') || h.includes('alguns')) updated.handoff_mode = 'conditional'
        else if (h.includes('automático') || h.includes('automatic')) updated.handoff_mode = 'never'
      } else if (id === 'target_audience') {
        const audience = parseTargetAudience(value)
        if (audience) updated.target_audience = audience
      } else if (id === 'interaction_style') {
        const style = parseInteractionStyle(value)
        if (style) updated.interaction_style = style
      } else if (id.startsWith('staff_')) {
        const idx = parseInt(id.replace('staff_', ''), 10)
        const staff = Array.isArray(updated.staff) ? [...updated.staff] : []
        if (!Number.isNaN(idx) && idx >= 0 && idx < staff.length) {
          staff[idx] = { ...(staff[idx] || {}), name: value.trim() }
          updated.staff = staff
        }
      } else if (id === 'holidays') {
        if (value.startsWith('select_holidays:')) {
          const dates = value.replace('select_holidays:', '').split(',').map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
          updated.holidays_attend = dates
          updated.holidays_skipped = true
        } else if (/configurar|ver op[cç][oõ]es|marcar feriados/i.test(value)) {
          const year = new Date().getFullYear()
          const allHolidays = await fetchNationalHolidays(year)
          const selected = updated.holidays_attend || []
          return {
            assistant_message: 'Marque os feriados em que você atende e clique em Continuar.',
            next_step: 'holidays_select',
            extracted_data: { ...updated, holidays_entered: true },
            selectable_options: buildHolidaysSelectableOptions(allHolidays, selected),
            action_options: ['Atendo todos os feriados', 'Continuar', 'Não atendo em nenhum'],
            requires_action: 'holidays_select',
          }
        }
      } else if (id === 'closure_periods') {
        const parts = value.split(/[;，]/).map((p) => p.trim()).filter(Boolean)
        const periods: Array<{ start: string; end: string }> = []
        for (const part of parts) {
          const p = parseClosurePeriod(part)
          if (p) periods.push(p)
        }
        if (periods.length > 0) {
          updated.closure_periods = periods
          updated.closure_skipped = true
        }
      } else if (id === 'sequence_eligible_services') {
        const names = value.split(',').map((s) => s.trim()).filter(Boolean)
        const validNames = (updated.services || []).map((s: any) => s?.name).filter(Boolean)
        updated.sequence_eligible_services = names.filter((n) => validNames.includes(n))
      }
    }

    if (delCmd) {
      const { id } = delCmd
      if (id === 'service_area') delete updated.service_area
      else if (id === 'tone_of_voice') delete updated.tone_of_voice
      else if (id === 'target_audience') delete updated.target_audience
      else if (id === 'interaction_style') delete updated.interaction_style
      else if (id === 'schedule') updated.schedule = {}
      else if (id === 'policies') delete updated.policies
      else if (id.startsWith('service_')) {
        const idx = parseInt(id.replace('service_', ''))
        const services = Array.isArray(updated.services) ? [...updated.services] : []
        if (!Number.isNaN(idx) && idx >= 0 && idx < services.length) {
          updated.services = services.filter((_, i) => i !== idx)
          updated.services_confirmed = false
        }
      }
    }

    const next = determineNextStep(updated as BusinessModelData, '', makeFlowState('summary_edit', updated))
    let resp: OnboardingResponse = {
      assistant_message: next.message,
      next_step: next.step,
      extracted_data: updated, // envia estado completo para persistir determinístico
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.step === 'schedule_days'
        ? { selectable_options: buildDaysSelectableOptions(updated.schedule?.days_of_week || []) }
        : {}),
    }
    resp = attachSummaryPayload(resp, updated)
    return resp
  }

  // Alteração de duração em qualquer etapa (exceto services_duration, que tem handler próprio): "duração de X é 40 min"
  const servicesForDuration = Array.isArray(collectedData.services) ? collectedData.services : []
  if (servicesForDuration.length > 0 && currentStep !== 'services_duration') {
    const isDurationIntent = /\b(dura[çc][ãa]o|min(?:uto)?s?)\b/i.test(text) || /\d+\s*min(?:uto)?s?\b/i.test(text)
    if (isDurationIntent) {
      const minutes = parseDurationMinutes(text)
      const idx = findServiceIndexByText(servicesForDuration, text)
      if (minutes != null && idx >= 0) {
        const updated = servicesForDuration.map((s, i) =>
          i === idx ? { ...s, duration_minutes: minutes } : s
        )
        const merged = { ...collectedData, services: updated }
        const next = determineNextStep(merged as BusinessModelData, '', makeFlowState(currentStep, merged))
        let resp: OnboardingResponse = {
          assistant_message: `✅ Duração de ${updated[idx].name}: ${minutes} min.\n\n${next.message}`,
          next_step: next.step,
          extracted_data: merged,
          requires_action: next.requires_action,
          action_options: next.action_options,
        }
        if (next.step === 'schedule_days') {
          resp.selectable_options = buildDaysSelectableOptions(merged.schedule?.days_of_week || [])
        }
        resp = attachSummaryPayload(resp, merged)
        return resp
      }
    }
  }

  // Comando explícito: mostrar resumo / editar / ver o que já foi cadastrado
  if (isShowSummaryOrEditRequest(text)) {
    const merged = { ...collectedData }
    // Usuário avançado no início: mostrar todos os campos (incluindo vazios) para preencher direto
    const items = hasMinimalData(merged)
      ? buildAllEditableItems(merged)
      : buildEditableItems(merged)
    const introMsg = hasMinimalData(merged)
      ? 'Preencha os campos abaixo diretamente, se preferir:'
      : 'Edite os campos abaixo se quiser alterar algo.'
    return {
      assistant_message: introMsg,
      next_step: 'summary_edit',
      editable_items: items,
      action_options: items.length > 0 ? ['Salvar ajustes', 'Voltar'] : undefined,
      requires_action: 'edit_fields',
    }
  }

  const looksLikeBusinessTypeInput =
    (currentStep === 'business_type' || currentStep === 'collect_free_text') && looksLikeBusinessSeedInput(text)

  if (currentStep === 'collect_free_text' && hasMinimalData(collectedData) && isGreetingOnlyMessage(text)) {
    return {
      assistant_message: buildGreetingDiscoveryMessage(),
      next_step: 'welcome_intro_choice',
      action_options: INTRO_DISCOVERY_OPTIONS,
      requires_action: 'welcome_intro_choice',
      extracted_data: {},
    }
  }

  if (currentStep === 'collect_free_text') {
    const extractedRaw = await extractBusinessModelWithAI(text, collectedData)
    const extracted = sanitizeExtractionResult(extractedRaw, text)
    const hasExtractedServices = Array.isArray(extracted.services) && extracted.services.length > 0
    const resolvedBusinessType = resolveBusinessTypeCandidate(extracted.business_type, text)
    const merged = {
      ...collectedData,
      ...extracted,
      ...(hasExtractedServices ? { services_confirmed: false } : {}),
      ...(resolvedBusinessType ? { business_type: resolvedBusinessType } : {}),
    }
    const hasSeedExtraction = hasOnboardingSeedExtraction(extracted) || Boolean(resolvedBusinessType)

    if (hasSeedExtraction || merged.business_type) {
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('collect_free_text', merged))
      return {
        assistant_message: next.message,
        next_step: next.step,
        extracted_data: {
          ...extracted,
          ...(hasExtractedServices ? { services_confirmed: false } : {}),
          ...(resolvedBusinessType ? { business_type: resolvedBusinessType } : {}),
        },
        requires_action: next.requires_action,
        action_options: next.action_options,
        ...(next.step === 'schedule_days'
          ? { selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []) }
          : {}),
      }
    }
  }

  // Dúvidas contínuas na fase introdutória: resposta fluida via IA + tutorial ou CTA
  const introSteps = ['welcome', 'business_type', 'collect_free_text'] as const
  if (
    introSteps.includes(currentStep as any) &&
    hasMinimalData(collectedData) &&
    !isGreetingOnlyMessage(text) &&
    !looksLikeBusinessTypeInput &&
    (await classifyNeedsIntroTutorial(text))
  ) {
    const { response: fluidResponse, ready_to_start } = await answerDoubtWithAI(text, { lastWasTutorial: true })
    const cta =
      ready_to_start
        ? '\n\nVamos começar? Me conta qual é o seu ramo de atividade e o que você faz!'
        : '\n\n' + buildIntroTutorialMessage()
    return {
      assistant_message: fluidResponse + cta,
      next_step: ready_to_start ? 'collect_free_text' : 'business_type',
      extracted_data: {},
    }
  }

  // Steps determinísticos primeiro (não depender de botão/ui_action)
  if (currentStep === 'business_type') {
    const extractedRaw = await extractBusinessModelWithAI(text, collectedData)
    const extracted = sanitizeExtractionResult(extractedRaw, text)
    const businessType = extracted.business_type || text.trim()
    if (!businessType) {
      return {
        assistant_message: 'Qual é o tipo do seu negócio (o que você faz/vende)?',
        next_step: 'business_type',
      }
    }
    const merged = {
      ...collectedData,
      ...extracted,
      business_type: businessType,
    }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('business_type', merged))
    return {
      assistant_message: `✅ Entendi. Você atua com ${businessType}.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { business_type: businessType, ...(extracted.business_name ? { business_name: extracted.business_name } : {}) },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'business_name') {
    const extractedRaw = await extractBusinessModelWithAI(text, collectedData)
    const extracted = sanitizeExtractionResult(extractedRaw, text)
    const name = (extracted.business_name || text).trim()
    if (!name) {
      return {
        assistant_message: 'Qual é o nome do seu negócio?',
        next_step: 'business_name',
      }
    }
    const merged = { ...collectedData, ...extracted, business_name: name }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('business_name', merged))
    return {
      assistant_message: `✅ Perfeito, ${name}.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: {
        business_name: name,
        ...(extracted.business_type ? { business_type: extracted.business_type } : {}),
      },
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.step === 'schedule_days'
        ? { selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []) }
        : {}),
    }
  }

  if (currentStep === 'context') {
    const selected = parseContext(text)
    if (!selected) {
      return {
        assistant_message: 'Só pra eu direcionar as próximas perguntas: você quer usar o Nevo para **agendamento**, **orçamento** ou **ambos**?',
        next_step: 'context',
        action_options: ['Agendamento', 'Orçamento', 'Ambos'],
        requires_action: 'context',
      }
    }

    const merged = { ...collectedData, context: selected }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('context', merged))

    if (next.step === 'services_list' && Array.isArray(merged.services) && merged.services.length > 0) {
      return {
        assistant_message: buildServicesReviewMessage(merged.services),
        next_step: 'services_list',
        extracted_data: { context: selected, services_confirmed: false },
        editable_items: buildServiceItems(merged.services),
        action_options: ['Continuar'],
        requires_action: 'services_edit',
      }
    }

    if (next.step === 'schedule_days') {
      return {
        assistant_message: next.message,
        next_step: 'schedule_days',
        extracted_data: { context: selected },
        selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []),
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }

    return {
      assistant_message: `✅ Entendi! Você vai usar para ${selected === 'booking' ? 'agendamento' : selected === 'quote' ? 'orçamento' : 'agendamento e orçamento'}.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { context: selected },
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.selectable_options ? { selectable_options: next.selectable_options } : {}),
    }
  }

  if (currentStep === 'schedule_days') {
    const selectMatch = text.match(/^select_days:(.+)$/)
    const selectedDays = selectMatch ? selectMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : parseDaysFromText(text)
    const existing = collectedData.schedule?.days_of_week || []

    if (!selectedDays.length) {
      return {
        assistant_message: 'Pra eu liberar o agendamento nos dias certos, em quais dias da semana você atende?\n\nSelecione abaixo:',
        next_step: 'schedule_days',
        selectable_options: buildDaysSelectableOptions(existing),
        requires_action: 'schedule_days',
      }
    }

    const merged = {
      ...collectedData,
      schedule: { ...(collectedData.schedule || {}), days_of_week: selectedDays },
    }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('schedule_days', merged))
    return {
      assistant_message: `✅ Anotei os dias.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { schedule: merged.schedule },
      requires_action: next.requires_action,
      action_options: next.action_options,
      selectable_options: next.step === 'schedule_days' ? buildDaysSelectableOptions(selectedDays) : undefined,
    }
  }

  if (currentStep === 'schedule_time') {
    const existing = collectedData.schedule || {}
    const partial = parseScheduleNarrative(text)

    // Se a pessoa só mandar UM horário (ex.: “08:00”), usa para preencher o que estiver faltando.
    const single = parseSingleTime(text)

    const nextSchedule = {
      ...existing,
      ...(partial.start_time ? { start_time: partial.start_time } : {}),
      ...(partial.end_time ? { end_time: partial.end_time } : {}),
      ...(partial.breaks && partial.breaks.length > 0 ? { breaks: partial.breaks } : {}),
    }
    const hasBreaksInCurrentInput = Array.isArray(partial.breaks) && partial.breaks.length > 0
    const breaksConfigured = hasBreaksInCurrentInput || Boolean(collectedData.schedule_breaks_configured)

    // Preencher start/end com single time quando fizer sentido (sem inferir).
    if (single) {
      if (!nextSchedule.start_time && nextSchedule.end_time) nextSchedule.start_time = single
      else if (!nextSchedule.end_time && nextSchedule.start_time) nextSchedule.end_time = single
    }

    // Se ainda não temos nem start nem end, pedir de novo.
    if (!nextSchedule.start_time && !nextSchedule.end_time) {
      return {
        assistant_message:
          'Não consegui entender seu horário ainda. Você pode me dizer assim: “das 8 às 18” ou “08:00 as 18:00”? Se tiver pausa, pode incluir: “pausa 12:00 às 13:00”.',
        next_step: 'schedule_time',
        action_options: [
          '08:00 às 18:00',
          '09:00 às 18:00',
          '08:00 às 17:00',
          '09:00 às 17:00',
          '07:00 às 17:00',
          '10:00 às 19:00',
          '06:00 às 12:00',
          'Outro horário',
        ],
        requires_action: 'schedule_time',
      }
    }

    // Se temos pausa e fim, mas falta começo (caso “até meio dia… volto às 13… até às 17”),
    // não inferir: perguntar explicitamente o horário de início.
    if (!nextSchedule.start_time && nextSchedule.end_time) {
      return {
        assistant_message:
          `Perfeito — entendi que você vai até ${nextSchedule.end_time}` +
          (Array.isArray(nextSchedule.breaks) && nextSchedule.breaks.length > 0
            ? `, com pausa ${nextSchedule.breaks.map((b: any) => `${b.start} às ${b.end}`).join(', ')}`
            : '') +
          '.\n\nQue horas você começa? (ex.: 08:00)',
        next_step: 'schedule_time',
        extracted_data: { schedule: nextSchedule },
      }
    }

    // Se temos começo, mas falta fim: pedir fim.
    if (nextSchedule.start_time && !nextSchedule.end_time) {
      return {
        assistant_message: `Beleza — você começa às ${nextSchedule.start_time}. Até que horas você vai? (ex.: 18:00)`,
        next_step: 'schedule_time',
        extracted_data: { schedule: nextSchedule },
      }
    }

    if (!nextSchedule.breaks || nextSchedule.breaks.length === 0) {
      return {
        assistant_message:
          `✅ Perfeito. Horário: ${nextSchedule.start_time} às ${nextSchedule.end_time}.` +
          `\n\nVocê tem alguma pausa no dia? Pode escolher nos botões ou informar de outra forma.`,
        next_step: 'schedule_breaks',
        extracted_data: { schedule: nextSchedule },
        action_options: [
          '12:00 às 13:00',
          '12:00 às 14:00',
          '11:30 às 12:30',
          'Não tenho pausa',
          'Outra pausa',
        ],
        requires_action: 'schedule_breaks',
      }
    }

    const merged = { ...collectedData, schedule: nextSchedule }
    if (breaksConfigured) {
      ;(merged as any).schedule_breaks_configured = true
    }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('schedule_time', merged))
    return {
      assistant_message:
        `✅ Perfeito. Horário: ${nextSchedule.start_time} às ${nextSchedule.end_time}.` +
        (Array.isArray(nextSchedule.breaks) && nextSchedule.breaks.length > 0
          ? `\n✅ Pausa: ${nextSchedule.breaks.map((b: any) => `${b.start} às ${b.end}`).join(', ')}.`
          : '') +
        `\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { schedule: merged.schedule },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'schedule_breaks') {
    const existing = collectedData.schedule || {}
    const wantsNo = /(não|nao|sem pausa|sem intervalo|sem almoco|sem almoço|nao tenho|não tenho)/i.test(text)
    if (wantsNo) {
      const merged = {
        ...collectedData,
        schedule: { ...existing, breaks: [] },
        schedule_breaks_configured: true,
      }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('schedule_breaks', merged))
      return {
        assistant_message: `Perfeito. Sem pausa.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { schedule: { ...existing, breaks: [] }, schedule_breaks_configured: true },
        action_options: next.action_options,
        requires_action: next.requires_action,
        ...(next.step === 'services_duration'
          ? { editable_items: buildServiceDurationItems(merged.services || [], merged.schedule?.interval_minutes) }
          : {}),
      }
    }

    let breaks = parseBreaksFromText(text)
    if (!breaks.length) {
      const range = parseTimeRange(text)
      if (range) {
        breaks = [{ start: range.start, end: range.end }]
      }
    }
    if (!breaks.length) {
      return {
        assistant_message:
          'Não consegui entender a pausa. Escolha uma opção nos botões ou informe assim: "pausa 12:00 às 13:00". Se não tiver, clique em "Não tenho pausa".',
        next_step: 'schedule_breaks',
        action_options: [
          '12:00 às 13:00',
          '12:00 às 14:00',
          '11:30 às 12:30',
          'Não tenho pausa',
          'Outra pausa',
        ],
        requires_action: 'schedule_breaks',
      }
    }

    const merged = {
      ...collectedData,
      schedule: { ...existing, breaks },
      schedule_breaks_configured: true,
    }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('schedule_breaks', merged))
    return {
      assistant_message:
        `✅ Pausa: ${breaks.map((b: any) => `${b.start} às ${b.end}`).join(', ')}.` +
        `\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { schedule: { ...existing, breaks }, schedule_breaks_configured: true },
      action_options: next.action_options,
      requires_action: next.requires_action,
      ...(next.step === 'services_duration'
        ? { editable_items: buildServiceDurationItems(merged.services || [], merged.schedule?.interval_minutes) }
        : {}),
    }
  }

  if (currentStep === 'schedule_interval') {
    if (lower.includes('outro')) {
      return {
        assistant_message: 'Qual intervalo em minutos você prefere?',
        next_step: 'schedule_interval_custom',
      }
    }
    const value = parseIntervalMinutes(text)
    if (!value) {
      return {
        assistant_message: 'Não entendi o intervalo. Você pode escolher 15, 30, 45, 60 ou informar um número.',
        next_step: 'schedule_interval',
        action_options: ['15 min', '30 min', '45 min', '60 min', 'Outro intervalo'],
        requires_action: 'schedule_interval',
      }
    }
    const merged = {
      ...collectedData,
      schedule: { ...(collectedData.schedule || {}), interval_minutes: value },
    }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('schedule_interval', merged))
    return {
      assistant_message: `✅ Intervalo anotado: ${value} minutos.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { schedule: merged.schedule },
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.step === 'services_duration'
        ? {
            editable_items: buildServiceDurationItems(merged.services || [], value),
          }
        : {}),
    }
  }

  if (currentStep === 'schedule_interval_custom') {
    const value = parseIntervalMinutes(text)
    if (!value) {
      return {
        assistant_message: 'Me diga apenas o número de minutos (ex.: 20).',
        next_step: 'schedule_interval_custom',
      }
    }
    const merged = {
      ...collectedData,
      schedule: { ...(collectedData.schedule || {}), interval_minutes: value },
    }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('schedule_interval', merged))
    return {
      assistant_message: `✅ Intervalo anotado: ${value} minutos.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { schedule: merged.schedule },
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.step === 'services_duration'
        ? {
            editable_items: buildServiceDurationItems(merged.services || [], value),
          }
        : {}),
    }
  }

  if (currentStep === 'min_booking_lead') {
    const value = parseIntervalMinutes(text)
    const validMins = [5, 10, 15, 20, 30]
    const mins = value != null && validMins.includes(value) ? value : value != null && value >= 1 && value <= 60 ? value : null
    if (!mins) {
      return {
        assistant_message: 'Escolha uma das opções (5, 10, 15, 20 ou 30 minutos).',
        next_step: 'min_booking_lead',
        action_options: ['5 min', '10 min', '15 min', '20 min', '30 min'],
        requires_action: 'min_booking_lead',
      }
    }
    const merged = {
      ...collectedData,
      schedule: { ...(collectedData.schedule || {}), min_booking_lead_minutes: mins },
    }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('min_booking_lead', merged))
    return {
      assistant_message: `✅ Antecedência mínima: ${mins} minutos.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { schedule: merged.schedule },
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.step === 'services_duration'
        ? {
            editable_items: buildServiceDurationItems(merged.services || [], collectedData.schedule?.interval_minutes),
          }
        : {}),
    }
  }

  if (currentStep === 'services_duration') {
    const services = Array.isArray(collectedData.services) ? [...collectedData.services] : []
    const defaultMinutes = collectedData.schedule?.interval_minutes
    const wantsContinue = /(continuar|seguir|pronto|ok|manter padrão|manter padrao|salvar)/i.test(text)

    if (wantsContinue) {
      const normalizedServices = services.map((s) => ({
        ...s,
        duration_minutes: s.duration_minutes || defaultMinutes,
      }))
      const merged = { ...collectedData, services: normalizedServices, services_duration_configured: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('services_duration', merged))
      const pricingEntered = next.step === 'services_pricing'
      return {
        assistant_message:
          pricingEntered
            ? '✅ Durações anotadas.\n\nPara cada serviço, informe o valor em R$ (ou deixe em branco). Você pode editar nos itens abaixo e depois clicar em Continuar.'
            : `✅ Durações anotadas.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: {
          services: normalizedServices,
          services_duration_configured: true,
          ...(pricingEntered ? { services_pricing_entered: true } : {}),
        },
        requires_action: next.requires_action,
        action_options: pricingEntered ? ['Continuar', 'Pular por enquanto'] : next.action_options,
        ...(pricingEntered ? { editable_items: buildServicePriceItems(normalizedServices) } : {}),
        ...(next.step === 'schedule_days'
          ? { selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []) }
          : {}),
      }
    }

    const minutes = parseDurationMinutes(text)
    const idx = findServiceIndexByText(services, text)
    if (!minutes || idx < 0) {
      return {
        assistant_message:
          'Não consegui entender a duração. Você pode ajustar direto nos itens abaixo ou escrever algo como:\n“Corte masculino: 30 min”.',
        next_step: 'services_duration',
        editable_items: buildServiceDurationItems(services, defaultMinutes),
        action_options: ['Continuar'],
        requires_action: 'services_duration',
      }
    }

    services[idx] = { ...services[idx], duration_minutes: minutes }
    return {
      assistant_message: `✅ Duração de ${services[idx].name}: ${minutes} min.\n\nQuer ajustar mais algum?`,
      next_step: 'services_duration',
      extracted_data: { services },
      editable_items: buildServiceDurationItems(services, defaultMinutes),
      action_options: ['Continuar'],
      requires_action: 'services_duration',
    }
  }

  if (currentStep === 'services_pricing') {
    const services = Array.isArray(collectedData.services) ? [...collectedData.services] : []
    const wantsSkip = /(pular|pular por enquanto|n[aã]o|deixar pra depois|depois)/i.test(text)
    const wantsContinue = /(continuar|seguir|pronto|ok|salvar)/i.test(text)
    const wantsInform = /(informar valores|informar|sim|quero)/i.test(text)

    if (wantsSkip) {
      const merged = { ...collectedData, services_pricing_configured: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('services_pricing', merged))
      return {
        assistant_message: `Tudo bem. Você pode cadastrar os valores depois.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { services_pricing_configured: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
        ...(next.step === 'schedule_days' ? { selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []) } : 'selectable_options' in next ? { selectable_options: (next as { selectable_options?: unknown }).selectable_options } : {}),
      }
    }

    if (wantsInform && !collectedData.services_pricing_entered) {
      const merged = { ...collectedData, services_pricing_entered: true }
      return {
        assistant_message: 'Para cada serviço, informe o valor em R$ (ou deixe em branco). Você pode editar nos itens abaixo e depois clicar em Continuar.',
        next_step: 'services_pricing',
        extracted_data: { services_pricing_entered: true },
        editable_items: buildServicePriceItems(services),
        action_options: ['Continuar'],
        requires_action: 'services_pricing',
      }
    }

    if (wantsContinue && collectedData.services_pricing_entered) {
      const merged = { ...collectedData, services_pricing_configured: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('services_pricing', merged))
      return {
        assistant_message: `✅ Valores anotados.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: {
          services_pricing_configured: true,
          services,
        },
        requires_action: next.requires_action,
        action_options: next.action_options,
        ...(next.step === 'schedule_days' ? { selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []) } : 'selectable_options' in next ? { selectable_options: (next as { selectable_options?: unknown }).selectable_options } : {}),
      }
    }

    // Interpretar corretamente: "duração de X é 40 min" = duration, não preço
    const isDurationIntent = /\b(dura[çc][ãa]o|min(?:uto)?s?)\b/i.test(text) || /\d+\s*min(?:uto)?s?\b/i.test(text)
    if (isDurationIntent) {
      const minutes = parseDurationMinutes(text)
      const idx = findServiceIndexByText(services, text)
      if (minutes != null && idx >= 0) {
        services[idx] = { ...services[idx], duration_minutes: minutes }
        return {
          assistant_message: `✅ Duração de ${services[idx].name}: ${minutes} min. Quer ajustar mais algum valor ou clicar em Continuar?`,
          next_step: 'services_pricing',
          extracted_data: { services },
          editable_items: buildServicePriceItems(services),
          action_options: ['Continuar'],
          requires_action: 'services_pricing',
        }
      }
    }

    const price = parsePrice(text)
    const idx = findServiceIndexByText(services, text)
    if (price != null && idx >= 0) {
      services[idx] = { ...services[idx], base_price: price }
      return {
        assistant_message: `✅ ${services[idx].name}: R$ ${price}.\n\nQuer ajustar mais algum valor ou clicar em Continuar?`,
        next_step: 'services_pricing',
        extracted_data: { services },
        editable_items: buildServicePriceItems(services),
        action_options: ['Continuar'],
        requires_action: 'services_pricing',
      }
    }

    if (collectedData.services_pricing_entered) {
      return {
        assistant_message: 'Pode ajustar os valores nos itens abaixo ou clicar em Continuar para seguir.',
        next_step: 'services_pricing',
        editable_items: buildServicePriceItems(services),
        action_options: ['Continuar'],
        requires_action: 'services_pricing',
      }
    }

    return {
      assistant_message: 'Quer informar o valor de cada serviço? Assim o cliente já pode saber na hora. (Se preferir, pode pular.)',
      next_step: 'services_pricing',
      action_options: ['Informar valores', 'Pular por enquanto'],
      requires_action: 'services_pricing',
    }
  }

  if (currentStep === 'owner_attends') {
    const alsoAttends = /(eu\s*tamb[eé]m\s*atendo|tamb[eé]m\s*atendo|eu\s*atendo)/i.test(text)
    const onlyStaff = /(s[oó]\s*os\s*colaboradores|s[oó]\s*colaboradores|colaboradores\s*atendem)/i.test(text)
    if (alsoAttends) {
      return {
        assistant_message:
          'Beleza. Qual é o **seu nome**? E o nome dos outros colaboradores? (separe por vírgulas, ex: João, Maria, Carlos)',
        next_step: 'staff_list',
        extracted_data: { owner_attends: true },
      }
    }
    if (onlyStaff) {
      return {
        assistant_message: 'Entendido. Quais são os nomes dos colaboradores que atendem? (separe por vírgulas, ex: João, Maria, Carlos)',
        next_step: 'staff_list',
        extracted_data: { owner_attends: false },
      }
    }
    return {
      assistant_message: 'Você também atende clientes ou só gerencia o negócio?',
      next_step: 'owner_attends',
      action_options: ['Eu também atendo', 'Só os colaboradores atendem'],
      requires_action: 'owner_attends',
    }
  }

  if (currentStep === 'sequence_booking_offer') {
    const onlyOne = /(apenas\s*um|um\s*servi[cç]o\s*por\s*agendamento|s[oó]\s*um)/i.test(text)
    const allowSeq = /(sim|pode\s*agendar\s*em\s*sequ[eê]ncia|em\s*sequ[eê]ncia|v[aá]rios\s*servi[cç]os)/i.test(text)
    if (onlyOne) {
      const merged = { ...collectedData, sequence_booking_configured: true, allow_sequence_booking: false }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('sequence_booking_offer', merged))
      return {
        assistant_message: `Entendido. O cliente agenda um serviço por vez.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { sequence_booking_configured: true, allow_sequence_booking: false },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    if (allowSeq) {
      const merged = { ...collectedData, sequence_booking_configured: true, allow_sequence_booking: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('sequence_booking_offer', merged))
      const serviceNames = (merged.services || []).map((s) => s?.name).filter(Boolean)
      const selectableOpts = serviceNames.map((name, i) => ({ id: `seq_svc_${i}`, label: name, value: name }))
      return {
        assistant_message: `Ótimo! O cliente poderá combinar serviços.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { sequence_booking_configured: true, allow_sequence_booking: true },
        requires_action: next.requires_action,
        selectable_options: selectableOpts,
      }
    }
    return {
      assistant_message:
        'O cliente pode agendar **vários serviços na mesma visita** (em sequência) ou apenas **um serviço por agendamento**?',
      next_step: 'sequence_booking_offer',
      action_options: ['Apenas um serviço por agendamento', 'Sim, pode agendar em sequência'],
      requires_action: 'sequence_booking_offer',
    }
  }

  if (currentStep === 'sequence_services_select') {
    const selectMatch = text.match(/^select_sequence_services:(.+)$/i)
    if (selectMatch) {
      const servicesText = selectMatch[1].trim()
      const selected = servicesText.split(',').map((s) => s.trim()).filter(Boolean)
      if (selected.length > 0) {
        const merged = { ...collectedData, sequence_eligible_services: selected }
        const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('sequence_services_select', merged))
        return {
          assistant_message: `Perfeito! Os serviços ${selected.join(', ')} podem ser combinados em sequência.\n\n${next.message}`,
          next_step: next.step,
          extracted_data: { sequence_eligible_services: selected },
          requires_action: next.requires_action,
          action_options: next.action_options,
        }
      }
    }
    const serviceNames = (collectedData.services || []).map((s) => s?.name).filter(Boolean)
    const selectableOpts = serviceNames.map((name, i) => ({ id: `seq_svc_${i}`, label: name, value: name }))
    return {
      assistant_message:
        'Quais serviços podem ser combinados em sequência? Selecione os que fazem sentido oferecer juntos (ex: banho + tosa).',
      next_step: 'sequence_services_select',
      selectable_options: selectableOpts,
      requires_action: 'sequence_services_select',
    }
  }

  if (currentStep === 'staff_mode') {
    const isSolo = /(s[oó]\s*eu\s*atendo|atendo\s*sozinho|sozinh[oa]|s[oó]\s*eu|apenas\s*eu|somente\s*eu)/i.test(text)
    const hasTeam = /(eu\s*e\s*outros|colaboradores?|funcion[aá]rios?|equipe|temos|tenho)/i.test(text)
    if (isSolo && !hasTeam) {
      return {
        assistant_message: 'Perfeito. Qual é o seu nome? (você será o único atendente cadastrado)',
        next_step: 'staff_list',
        extracted_data: { staff_mode: 'solo', owner_attends: true },
      }
    }
    if (hasTeam) {
      return {
        assistant_message: 'Você também atende clientes ou só gerencia o negócio?',
        next_step: 'owner_attends',
        extracted_data: { staff_mode: 'team' },
        action_options: ['Eu também atendo', 'Só os colaboradores atendem'],
        requires_action: 'owner_attends',
      }
    }
    return {
      assistant_message:
        '**Você** atende sozinho (só você) ou tem outros colaboradores além de você? (O sistema já considera que você é o dono/primeiro atendente.)',
      next_step: 'staff_mode',
      action_options: ['Só eu atendo', 'Eu e outros colaboradores'],
      requires_action: 'staff_mode',
    }
  }

  if (currentStep === 'staff_list') {
    const names = parseStaffNames(text)
    const mode = collectedData.staff_mode
    const ownerAttends = collectedData.owner_attends !== false
    if (!names.length) {
      return {
        assistant_message:
          mode === 'solo'
            ? 'Qual é o seu nome? (você será o único atendente cadastrado)'
            : ownerAttends
              ? 'Não consegui identificar os nomes. Qual é o seu nome e dos outros colaboradores? (separe por vírgulas, ex: João, Maria)'
              : 'Não consegui identificar os nomes. Quais são os colaboradores que atendem? (separe por vírgulas, ex: João, Maria)',
        next_step: 'staff_list',
      }
    }

    const staff = names.map((name) => ({ name }))
    const merged = { ...collectedData, staff, staff_setup_index: 0 }
    const first = staff[0]

    if (mode === 'team' && ownerAttends && staff.length === 1) {
      return {
        assistant_message: `Anotado, ${first?.name || 'você'}. Tem mais alguém? Pode incluir os outros nomes separados por vírgula ou escolher:`,
        next_step: 'staff_list_more',
        extracted_data: { staff, staff_setup_index: 0 },
        action_options: ['É só eu e mais um', 'É só eu e mais alguns', 'Já terminei a lista'],
        requires_action: 'staff_list_more',
      }
    }

    return {
      assistant_message: `Perfeito. A agenda de **${first?.name || 'colaborador 1'}** é a mesma do estabelecimento ou tem horário próprio?`,
      next_step: 'staff_schedule_mode',
      extracted_data: { staff, staff_setup_index: 0 },
      action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
      requires_action: 'staff_schedule_mode',
    }
  }

  if (currentStep === 'staff_list_more') {
    const wantsOneMore = /(s[oó]\s*eu\s*e\s*mais\s*um|mais\s*um)/i.test(text)
    const wantsSeveral = /(s[oó]\s*eu\s*e\s*mais\s*alguns|mais\s*alguns)/i.test(text)
    const wantsDone = /(j[aá]\s*terminei|terminei\s*a\s*lista|s[oó]\s*isso|pronto)/i.test(text)
    const names = parseStaffNames(text)
    const existingStaff = Array.isArray(collectedData.staff) ? collectedData.staff : []

    if (wantsOneMore) {
      return {
        assistant_message: 'Qual é o nome do outro colaborador?',
        next_step: 'staff_list_one_more',
        extracted_data: { staff_list_more_mode: 'one' },
      }
    }
    if (wantsSeveral || names.length > 1) {
      const newNames = names.length > 1 ? names : []
      const combined = existingStaff.map((s) => s.name)
      newNames.forEach((n) => {
        if (n && !combined.includes(n)) combined.push(n)
      })
      if (combined.length > 1) {
        const staff = combined.map((name) => ({ name }))
        const merged = { ...collectedData, staff, staff_setup_index: 0 }
        const first = staff[0]
        return {
          assistant_message: `Perfeito. A agenda de **${first?.name}** é a mesma do estabelecimento ou tem horário próprio?`,
          next_step: 'staff_schedule_mode',
          extracted_data: { staff, staff_setup_index: 0 },
          action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
          requires_action: 'staff_schedule_mode',
        }
      }
      return {
        assistant_message: 'Quais são os nomes? (separe por vírgulas, ex: Maria, Carlos)',
        next_step: 'staff_list_more',
      }
    }
    if (wantsDone) {
      const staff = [...existingStaff]
      const first = staff[0]
      return {
        assistant_message: `Perfeito. A agenda de **${first?.name || 'colaborador 1'}** é a mesma do estabelecimento ou tem horário próprio?`,
        next_step: 'staff_schedule_mode',
        extracted_data: { staff, staff_setup_index: 0 },
        action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
        requires_action: 'staff_schedule_mode',
      }
    }

    const newNames = parseStaffNames(text)
    if (newNames.length > 0) {
      const combined = existingStaff.map((s) => s.name)
      newNames.forEach((n) => {
        if (n && !combined.includes(n)) combined.push(n)
      })
      const staff = combined.map((name) => ({ name }))
      const merged = { ...collectedData, staff, staff_setup_index: 0 }
      const first = staff[0]
      return {
        assistant_message: `Perfeito. A agenda de **${first?.name}** é a mesma do estabelecimento ou tem horário próprio?`,
        next_step: 'staff_schedule_mode',
        extracted_data: { staff, staff_setup_index: 0 },
        action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
        requires_action: 'staff_schedule_mode',
      }
    }

    return {
      assistant_message: 'Tem mais alguém? Pode incluir os nomes separados por vírgula ou escolher:',
      next_step: 'staff_list_more',
      action_options: ['É só eu e mais um', 'É só eu e mais alguns', 'Já terminei a lista'],
      requires_action: 'staff_list_more',
    }
  }

  if (currentStep === 'staff_list_one_more') {
    const names = parseStaffNames(text)
    const existingStaff = Array.isArray(collectedData.staff) ? collectedData.staff : []
    if (names.length >= 1) {
      const newName = names[0]
      const combined = existingStaff.map((s) => s.name).concat(newName)
      const staff = combined.map((name) => ({ name }))
      const first = staff[0]
      return {
        assistant_message: `Perfeito. A agenda de **${first?.name}** é a mesma do estabelecimento ou tem horário próprio?`,
        next_step: 'staff_schedule_mode',
        extracted_data: { staff, staff_setup_index: 0 },
        action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
        requires_action: 'staff_schedule_mode',
      }
    }
    return {
      assistant_message: 'Qual é o nome do outro colaborador?',
      next_step: 'staff_list_one_more',
    }
  }

  if (currentStep === 'staff_schedule_mode') {
    const staff = Array.isArray(collectedData.staff) ? [...collectedData.staff] : []
    if (!staff.length) {
      return {
        assistant_message:
          '**Você** atende sozinho (só você) ou tem outros colaboradores além de você? (O sistema já considera que você é o dono/primeiro atendente.)',
        next_step: 'staff_mode',
        action_options: ['Só eu atendo', 'Eu e outros colaboradores'],
        requires_action: 'staff_mode',
      }
    }

    const idx = getStaffSetupIndex(collectedData)
    const member = staff[idx]
    if (!member) {
      const next = determineNextStep(collectedData as BusinessModelData, '', makeFlowState('staff_schedule_mode', collectedData))
      return {
        assistant_message: next.message,
        next_step: next.step,
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }

    const sameSchedule = /(mesmo|igual|padra[oã]|estabelecimento|geral)/i.test(text)
    const ownSchedule = /(pr[oó]prio|proprio|diferente|personalizado|hor[aá]rio pr[oó]prio)/i.test(text)
    if (!sameSchedule && !ownSchedule) {
      return {
        assistant_message: `A agenda de **${member.name}** é a mesma do estabelecimento ou tem horário próprio?`,
        next_step: 'staff_schedule_mode',
        action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
        requires_action: 'staff_schedule_mode',
      }
    }

    if (sameSchedule) {
      staff[idx] = { ...member, use_business_schedule: true, schedule: undefined }
      const nextIndex = idx + 1
      if (nextIndex < staff.length) {
        const nextMember = staff[nextIndex]
        return {
          assistant_message: `Perfeito. Agora, sobre **${nextMember.name}**: a agenda é a mesma do estabelecimento ou tem horário próprio?`,
          next_step: 'staff_schedule_mode',
          extracted_data: { staff, staff_setup_index: nextIndex },
          action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
          requires_action: 'staff_schedule_mode',
        }
      }
      const merged = { ...collectedData, staff, staff_setup_index: staff.length }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('staff_schedule_mode', merged))
      return {
        assistant_message: `✅ Agenda de ${member.name} configurada.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { staff: merged.staff, staff_setup_index: merged.staff_setup_index },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }

    staff[idx] = { ...member, use_business_schedule: false, schedule: { ...(member.schedule || {}) } }
    return {
      assistant_message: `Em quais dias da semana **${member.name}** atende? (você pode selecionar nos checkboxes)`,
      next_step: 'staff_schedule_days',
      extracted_data: { staff, staff_setup_index: idx },
      selectable_options: buildDaysSelectableOptions(member.schedule?.days_of_week || []),
      requires_action: 'schedule_days',
    }
  }

  if (currentStep === 'staff_schedule_days') {
    const staff = Array.isArray(collectedData.staff) ? [...collectedData.staff] : []
    if (!staff.length) {
      return {
        assistant_message: 'Você atende sozinho ou tem colaboradores?',
        next_step: 'staff_mode',
        action_options: ['Atendo sozinho', 'Tenho colaboradores'],
        requires_action: 'staff_mode',
      }
    }

    const idx = getStaffSetupIndex(collectedData)
    const member = staff[idx]
    const selectMatch = text.match(/^select_days:(.+)$/)
    const selectedDays = selectMatch ? selectMatch[1].split(',').map((s) => s.trim()).filter(Boolean) : parseDaysFromText(text)
    const existing = member?.schedule?.days_of_week || []

    if (!selectedDays.length) {
      return {
        assistant_message: `Em quais dias da semana **${member?.name || 'este colaborador'}** atende?\n\nSelecione abaixo:`,
        next_step: 'staff_schedule_days',
        selectable_options: buildDaysSelectableOptions(existing),
        requires_action: 'schedule_days',
      }
    }

    staff[idx] = {
      ...member,
      use_business_schedule: false,
      schedule: { ...(member?.schedule || {}), days_of_week: selectedDays },
    }

    return {
      assistant_message: `✅ Anotei os dias de **${member?.name || 'este colaborador'}**.\n\nE qual é a faixa de horário que ele(a) atende? Pode escolher nos botões ou informar de outra forma.`,
      next_step: 'staff_schedule_time',
      extracted_data: { staff, staff_setup_index: idx },
      action_options: [
        '08:00 às 18:00',
        '09:00 às 18:00',
        '08:00 às 17:00',
        '09:00 às 17:00',
        '07:00 às 17:00',
        '10:00 às 19:00',
        '06:00 às 12:00',
        'Outro horário',
      ],
      requires_action: 'staff_schedule_time',
    }
  }

  if (currentStep === 'staff_schedule_time') {
    const staff = Array.isArray(collectedData.staff) ? [...collectedData.staff] : []
    if (!staff.length) {
      return {
        assistant_message: 'Você atende sozinho ou tem colaboradores?',
        next_step: 'staff_mode',
        action_options: ['Atendo sozinho', 'Tenho colaboradores'],
        requires_action: 'staff_mode',
      }
    }

    const idx = getStaffSetupIndex(collectedData)
    const member = staff[idx]
    const existing = member?.schedule || {}
    const partial = parseScheduleNarrative(text)
    const single = parseSingleTime(text)

    const nextSchedule = {
      ...existing,
      ...(partial.start_time ? { start_time: partial.start_time } : {}),
      ...(partial.end_time ? { end_time: partial.end_time } : {}),
      ...(partial.breaks && partial.breaks.length > 0 ? { breaks: partial.breaks } : {}),
    }

    if (single) {
      if (!nextSchedule.start_time && nextSchedule.end_time) nextSchedule.start_time = single
      else if (!nextSchedule.end_time && nextSchedule.start_time) nextSchedule.end_time = single
    }

    if (!nextSchedule.start_time && !nextSchedule.end_time) {
      return {
        assistant_message:
          'Não consegui entender o horário. Você pode me dizer assim: “das 8 às 18” ou “08:00 as 18:00”? Se tiver pausa, pode incluir: “pausa 12:00 às 13:00”.',
        next_step: 'staff_schedule_time',
        action_options: [
          '08:00 às 18:00',
          '09:00 às 18:00',
          '08:00 às 17:00',
          '09:00 às 17:00',
          '07:00 às 17:00',
          '10:00 às 19:00',
          '06:00 às 12:00',
          'Outro horário',
        ],
        requires_action: 'staff_schedule_time',
      }
    }

    staff[idx] = {
      ...member,
      use_business_schedule: false,
      schedule: nextSchedule,
    }

    return {
      assistant_message:
        `✅ Horário de **${member?.name || 'este colaborador'}**: ${nextSchedule.start_time || '??'} às ${nextSchedule.end_time || '??'}.` +
        (Array.isArray(nextSchedule.breaks) && nextSchedule.breaks.length > 0
          ? `\n✅ Pausa: ${nextSchedule.breaks.map((b: any) => `${b.start} às ${b.end}`).join(', ')}.`
          : '') +
        `\n\nQual é o intervalo entre atendimentos?`,
      next_step: 'staff_schedule_interval',
      extracted_data: { staff, staff_setup_index: idx },
      action_options: ['15 min', '30 min', '45 min', '60 min', 'Outro intervalo'],
      requires_action: 'schedule_interval',
    }
  }

  if (currentStep === 'staff_schedule_interval') {
    if (lower.includes('outro')) {
      return {
        assistant_message: 'Qual intervalo em minutos você prefere?',
        next_step: 'staff_schedule_interval_custom',
      }
    }
    const value = parseIntervalMinutes(text)
    if (!value) {
      return {
        assistant_message: 'Não entendi o intervalo. Você pode escolher 15, 30, 45, 60 ou informar um número.',
        next_step: 'staff_schedule_interval',
        action_options: ['15 min', '30 min', '45 min', '60 min', 'Outro intervalo'],
        requires_action: 'schedule_interval',
      }
    }

    const staff = Array.isArray(collectedData.staff) ? [...collectedData.staff] : []
    const idx = getStaffSetupIndex(collectedData)
    const member = staff[idx]
    staff[idx] = {
      ...member,
      use_business_schedule: false,
      schedule: { ...(member?.schedule || {}), interval_minutes: value },
    }

    const nextIndex = idx + 1
    if (nextIndex < staff.length) {
      const nextMember = staff[nextIndex]
      return {
        assistant_message: `✅ Intervalo anotado: ${value} min.\n\nAgora, sobre **${nextMember.name}**: a agenda é a mesma do estabelecimento ou tem horário próprio?`,
        next_step: 'staff_schedule_mode',
        extracted_data: { staff, staff_setup_index: nextIndex },
        action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
        requires_action: 'staff_schedule_mode',
      }
    }

    const merged = { ...collectedData, staff, staff_setup_index: staff.length }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('staff_schedule_interval', merged))
    return {
      assistant_message: `✅ Intervalo anotado: ${value} minutos.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { staff: merged.staff, staff_setup_index: merged.staff_setup_index },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'staff_schedule_interval_custom') {
    const value = parseIntervalMinutes(text)
    if (!value) {
      return {
        assistant_message: 'Me diga apenas o número de minutos (ex.: 20).',
        next_step: 'staff_schedule_interval_custom',
      }
    }

    const staff = Array.isArray(collectedData.staff) ? [...collectedData.staff] : []
    const idx = getStaffSetupIndex(collectedData)
    const member = staff[idx]
    staff[idx] = {
      ...member,
      use_business_schedule: false,
      schedule: { ...(member?.schedule || {}), interval_minutes: value },
    }

    const nextIndex = idx + 1
    if (nextIndex < staff.length) {
      const nextMember = staff[nextIndex]
      return {
        assistant_message: `✅ Intervalo anotado: ${value} min.\n\nAgora, sobre **${nextMember.name}**: a agenda é a mesma do estabelecimento ou tem horário próprio?`,
        next_step: 'staff_schedule_mode',
        extracted_data: { staff, staff_setup_index: nextIndex },
        action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
        requires_action: 'staff_schedule_mode',
      }
    }

    const merged = { ...collectedData, staff, staff_setup_index: staff.length }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('staff_schedule_interval', merged))
    return {
      assistant_message: `✅ Intervalo anotado: ${value} minutos.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { staff: merged.staff, staff_setup_index: merged.staff_setup_index },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'location_mode') {
    const fixed = /tenho\s+endere[cç]o\s+fixo|endere[cç]o\s+fixo|ponto\s+fixo/i.test(text)
    const mobile = /atendo\s+no\s+endere[cç]o|no\s+endere[cç]o\s+do\s+cliente|atendo\s+em\s+casa|desloco|vou\s+at[eé]/i.test(text)
    if (fixed) {
      const merged = { ...collectedData, location_mode: 'fixed' }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('location_mode', merged))
      return {
        assistant_message: `✅ Entendido — endereço fixo.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { location_mode: 'fixed' },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    if (mobile) {
      const merged = { ...collectedData, location_mode: 'mobile' }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('location_mode', merged))
      return {
        assistant_message: `✅ Entendido — você atende no local do cliente.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { location_mode: 'mobile' },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    return {
      assistant_message: 'Escolha uma opção: você tem endereço fixo ou atende no endereço do cliente?',
      next_step: 'location_mode',
      action_options: ['Tenho endereço fixo', 'Atendo no endereço do cliente'],
      requires_action: 'location_mode',
    }
  }

  if (currentStep === 'address') {
    const wantsSkip = /(pular|nao quero|não quero|na verdade atendo no local|atendo no local do cliente)/i.test(text)
    if (wantsSkip) {
      const merged = { ...collectedData, location_mode: 'mobile', establishment_address: undefined }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('address', merged))
      return {
        assistant_message: `Sem problemas — vamos configurar as regiões de atendimento.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { location_mode: 'mobile', establishment_address: undefined },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }

    const addr = collectedData.establishment_address
    if (addr?.cep && addr?.logradouro && addr?.numero && addr?.bairro && addr?.localidade && addr?.uf) {
      const merged = { ...collectedData }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('address', merged))
      const addrStr = `${addr.logradouro}, ${addr.numero}${addr.complemento ? ` ${addr.complemento}` : ''} - ${addr.bairro}, ${addr.localidade}/${addr.uf}`
      return {
        assistant_message: `✅ Endereço anotado: ${addrStr}.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { establishment_address: addr },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    return {
      assistant_message: 'Informe o endereço no formulário acima. Comece pelo CEP para preencher automaticamente.',
      next_step: 'address',
      requires_action: 'address',
    }
  }

  if (currentStep === 'policies') {
    const noPolicy = /(não tenho|nao tenho|nenhuma|nenhum|sem política|sem politica|não por enquanto|nao por enquanto)/i.test(text)
    if (noPolicy) {
      const merged = { ...collectedData, policies: {} }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('policies', merged))
      return {
        assistant_message: `Tranquilo — sem políticas por enquanto. ✅\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { policies: {} },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    // Se informou algo, por enquanto apenas salvar o texto como “tem políticas” (sem inferir valores).
    const merged = { ...collectedData, policies: { note: text } }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('policies', merged))
    return {
      assistant_message: `Perfeito — anotei suas políticas. ✅\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { policies: { note: text } },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'tone_of_voice') {
    const parsedTone = parseTone(text)
    if (!parsedTone) {
      return {
        assistant_message:
          'E sobre o jeito de falar com seus clientes: qual **tom de voz** você prefere que eu use?\n\nPergunto isso pra deixar as mensagens com a cara do seu negócio.',
        next_step: 'tone_of_voice',
        action_options: ['Formal', 'Amigável', 'Profissional', 'Engraçado'],
        requires_action: 'tone_of_voice',
      }
    }
    const merged = { ...collectedData, tone_of_voice: parsedTone }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('tone_of_voice', merged))
    return {
      assistant_message: `✅ Tom anotado: ${parsedTone === 'formal' ? 'Formal' : parsedTone === 'friendly' ? 'Amigável' : parsedTone === 'professional' ? 'Profissional' : 'Engraçado'}.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { tone_of_voice: parsedTone },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'handoff_mode') {
    const handoff = /sempre humano/i.test(text)
      ? 'always'
      : /(condicional|alguns casos)/i.test(text)
        ? 'conditional'
        : /(automático|automatico)/i.test(text)
          ? 'never'
          : null
    if (!handoff) {
      return {
        assistant_message:
          'Pra eu não "segurar" conversa quando você quiser assumir, quando você prefere que eu **passe para um humano**?',
        next_step: 'handoff_mode',
        action_options: ['Sempre humano', 'Condicional (alguns casos)', 'Automático'],
        requires_action: 'handoff_mode',
      }
    }
    const merged = { ...collectedData, handoff_mode: handoff }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('handoff_mode', merged))
    return {
      assistant_message: `✅ Anotado.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { handoff_mode: handoff },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'target_audience') {
    const audience = parseTargetAudience(text)
    if (!audience) {
      return {
        assistant_message:
          'Seu atendimento e focado em algum publico especifico?',
        next_step: 'target_audience',
        action_options: ['Atendo todos os publicos', 'Somente mulheres', 'Somente homens', 'Infantil', 'Homens e infantil', 'Outro publico especifico'],
        requires_action: 'target_audience',
      }
    }
    const isCustomWithoutNote =
      (audience.mode === 'custom' || (audience as { modes?: string[] }).modes?.includes('custom')) &&
      !audience.note
    if (isCustomWithoutNote) {
      return {
        assistant_message:
          'Perfeito. Qual publico especifico voce quer atender? (responda em texto livre)',
        next_step: 'target_audience',
      }
    }
    const merged = { ...collectedData, target_audience: audience }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('target_audience', merged))
    return {
      assistant_message: `✅ Público-alvo anotado.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { target_audience: audience },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'interaction_style') {
    const style = parseInteractionStyle(text)
    if (!style) {
      return {
        assistant_message:
          'Como voce prefere o estilo das respostas no chat?',
        next_step: 'interaction_style',
        action_options: ['Misto (recomendado)', 'Opcoes numeradas (mais agil)', 'Conversa natural (mais humana)'],
        requires_action: 'interaction_style',
      }
    }
    const merged = { ...collectedData, interaction_style: style }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('interaction_style', merged))
    return {
      assistant_message: `✅ Estilo de respostas definido.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { interaction_style: style },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  if (currentStep === 'holidays_offer') {
    const wantsSkip = /(pular|pular por enquanto|depois|nao por enquanto)/i.test(text)
    const wantsNoAttend = /(nao atendo|não atendo|nenhum|nenhum feriado)/i.test(text)
    const wantsAll = /(atendo todos|atende em todos|todos os feriados)/i.test(text)
    const wantsYes = /(sim|quero marcar|marcar)/i.test(text)

    if (wantsSkip && !wantsYes) {
      const merged = { ...collectedData, holidays_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('holidays_offer', merged))
      return {
        assistant_message: `Sem problemas — pode configurar depois. ✅\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { holidays_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    if (wantsNoAttend && !wantsYes) {
      const merged = { ...collectedData, holidays_attend: [], holidays_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('holidays_offer', merged))
      return {
        assistant_message: `Anotado — nao atendemos em feriados. ✅\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { holidays_attend: [], holidays_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    if (wantsAll) {
      const year = new Date().getFullYear()
      const allHolidays = await fetchNationalHolidays(year)
      const allDates = allHolidays.map((h) => h.date)
      const merged = { ...collectedData, holidays_attend: allDates, holidays_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('holidays_offer', merged))
      return {
        assistant_message: `✅ Anotado — voce atende em todos os feriados de ${year}.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { holidays_attend: allDates, holidays_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }
    if (wantsYes) {
      const year = new Date().getFullYear()
      const allHolidays = await fetchNationalHolidays(year)
      const selected = collectedData.holidays_attend || []
      return {
        assistant_message:
          'Marque os feriados em que voce atende (pode selecionar varios). Depois clique em Continuar.',
        next_step: 'holidays_select',
        extracted_data: { holidays_entered: true },
        selectable_options: buildHolidaysSelectableOptions(allHolidays, selected),
        action_options: ['Atendo todos os feriados', 'Continuar', 'Nao atendo em nenhum'],
        requires_action: 'holidays_select',
      }
    }
    return {
      assistant_message:
        'Voce atende em feriados nacionais? Pode marcar os que trabalha, dizer que nao atende ou pular.',
      next_step: 'holidays_offer',
      action_options: ['Sim, quero marcar', 'Nao atendo em feriados', 'Pular por enquanto'],
      requires_action: 'holidays_offer',
    }
  }

  if (currentStep === 'holidays_select') {
    const selectMatch = text.match(/^select_holidays:(.*)$/)
    const wantsNone = /(nao atendo|não atendo|nenhum)/i.test(text)
    const wantsAll = /(atendo todos|atende em todos|todos os feriados)/i.test(text)
    const wantsContinue = /(continuar|pronto|ok)/i.test(text)

    if (wantsAll) {
      const year = new Date().getFullYear()
      const allHolidays = await fetchNationalHolidays(year)
      const allDates = allHolidays.map((h) => h.date)
      const merged = { ...collectedData, holidays_attend: allDates, holidays_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('holidays_select', merged))
      return {
        assistant_message: `✅ Anotado — voce atende em todos os feriados de ${year}.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { holidays_attend: allDates, holidays_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }

    if (wantsNone) {
      const merged = { ...collectedData, holidays_attend: [], holidays_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('holidays_select', merged))
      return {
        assistant_message: `Anotado — nao atendemos em feriados. ✅\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { holidays_attend: [], holidays_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }

    let selectedDates: string[] = collectedData.holidays_attend || []
    if (selectMatch) {
      selectedDates = selectMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    }

    if (wantsContinue) {
      const merged = { ...collectedData, holidays_attend: selectedDates, holidays_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('holidays_select', merged))
      return {
        assistant_message:
          selectedDates.length > 0
            ? `✅ Anotei ${selectedDates.length} feriado(s) em que voce atende.\n\n${next.message}`
            : `✅ Anotado.\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { holidays_attend: selectedDates, holidays_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
    }

    const year = new Date().getFullYear()
    const allHolidays = await fetchNationalHolidays(year)
    return {
      assistant_message: 'Marque os feriados em que voce atende e clique em Continuar.',
      next_step: 'holidays_select',
      selectable_options: buildHolidaysSelectableOptions(allHolidays, selectedDates),
      action_options: ['Atendo todos os feriados', 'Continuar', 'Nao atendo em nenhum'],
      requires_action: 'holidays_select',
    }
  }

  if (currentStep === 'closure_offer') {
    const wantsSkip = /(pular|pular por enquanto|depois)/i.test(text)
    const wantsNo = /^(nao|não)$/i.test(text.trim())
    const wantsYes = /(sim|tenho periodo|tenho período)/i.test(text)

    if (wantsSkip && !wantsYes) {
      const merged = { ...collectedData, closure_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('closure_offer', merged))
      let resp: OnboardingResponse = {
        assistant_message: `Sem problemas — pode configurar depois. ✅\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { closure_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
      resp = attachSummaryPayload(resp, merged)
      return resp
    }
    if (wantsNo && !wantsYes) {
      const merged = { ...collectedData, closure_periods: [], closure_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('closure_offer', merged))
      let resp: OnboardingResponse = {
        assistant_message: `Anotado. ✅\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { closure_periods: [], closure_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
      resp = attachSummaryPayload(resp, merged)
      return resp
    }
    if (wantsYes) {
      return {
        assistant_message:
          'Informe o periodo no formato: **data inicial a data final**\n\nExemplo: 20/12/2026 a 05/01/2027',
        next_step: 'closure_dates',
        extracted_data: { closure_entered: true },
        requires_action: 'closure_dates',
      }
    }
    return {
      assistant_message: 'Tem algum periodo de ferias ou fechamento planejado?',
      next_step: 'closure_offer',
      action_options: ['Sim, tenho periodo', 'Nao', 'Pular por enquanto'],
      requires_action: 'closure_offer',
    }
  }

  if (currentStep === 'closure_dates') {
    const period = parseClosurePeriod(text)
    if (period) {
      const existing = collectedData.closure_periods || []
      const merged = {
        ...collectedData,
        closure_periods: [...existing, { start: period.start, end: period.end }],
      }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('closure_dates', merged))
      let resp: OnboardingResponse = {
        assistant_message: `✅ Periodo anotado: ${period.start} a ${period.end}.\n\nQuer adicionar mais algum periodo ou continuar?`,
        next_step: 'closure_more',
        extracted_data: {
          closure_periods: merged.closure_periods,
        },
        requires_action: 'closure_more',
        action_options: ['Adicionar outro periodo', 'Continuar'],
      }
      resp = attachSummaryPayload(resp, merged)
      return resp
    }
    return {
      assistant_message:
        'Nao consegui entender o periodo. Informe assim: **20/12/2026 a 05/01/2027**',
      next_step: 'closure_dates',
      requires_action: 'closure_dates',
    }
  }

  if (currentStep === 'closure_more') {
    const wantsMore = /(adicionar|outro periodo|mais)/i.test(text)
    const wantsContinue = /(continuar|pronto|nao|não|seguir)/i.test(text)

    if (wantsMore && !wantsContinue) {
      return {
        assistant_message:
          'Informe o proximo periodo no formato: **data inicial a data final**\n\nExemplo: 15/07/2026 a 30/07/2026',
        next_step: 'closure_dates',
        requires_action: 'closure_dates',
      }
    }
    const merged = { ...collectedData, closure_skipped: true }
    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('closure_more', merged))
    let resp: OnboardingResponse = {
      assistant_message: next.message,
      next_step: next.step,
      extracted_data: { closure_skipped: true },
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.step === 'schedule_days'
        ? { selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []) }
        : {}),
    }
    resp = attachSummaryPayload(resp, merged)
    return resp
  }

  if (currentStep === 'faq_offer') {
    const wantsYes = /(sim|quero|adicionar|vamos|ok|pode)/i.test(text)
    const wantsNo = /(não|nao|pular|agora não|agora nao|depois|não por enquanto|nao por enquanto)/i.test(text)

    if (wantsYes && !wantsNo) {
      return {
        assistant_message:
          'Perfeito. Me envie as perguntas e respostas.\n\nVocê pode mandar assim:\n- “Pergunta? Resposta”\n\nE pode mandar várias de uma vez (uma por linha).',
        next_step: 'faq_question',
      }
    }

    // Se não quiser agora: marcar como pulado e seguir
    if (wantsNo || (!wantsYes && wantsNo)) {
      const merged = { ...collectedData, faq_skipped: true }
      const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('faq_offer', merged))
      let resp: OnboardingResponse = {
        assistant_message: `Sem problemas — podemos deixar FAQ pra depois. ✅\n\n${next.message}`,
        next_step: next.step,
        extracted_data: { faq_skipped: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
      }
      resp = attachSummaryPayload(resp, merged)
      return resp
    }

    // Fallback: repetir oferta com botões
    return {
      assistant_message:
        'Quer cadastrar algumas perguntas frequentes agora? (Isso ajuda a responder dúvidas repetidas.)',
      next_step: 'faq_offer',
      action_options: ['Sim, quero adicionar', 'Não, pular'],
      requires_action: 'faq_offer',
    }
  }

  if (currentStep === 'faq_question') {
    const newPairs = parseFaqPairs(text)
    if (newPairs.length === 0) {
      return {
        assistant_message:
          'Não consegui identificar perguntas e respostas.\n\nTente assim:\n- “Pergunta? Resposta”\n\nEx.: “Você faz corte feminino? Sim.”',
        next_step: 'faq_question',
      }
    }

    const existingFaq = Array.isArray(collectedData.faq) ? collectedData.faq : []
    const mergedFaq = [...existingFaq, ...newPairs].filter((item, idx, self) => {
      const q = (item?.question || '').toLowerCase().trim()
      if (!q) return false
      return idx === self.findIndex((x) => (x?.question || '').toLowerCase().trim() === q)
    })

    return {
      assistant_message:
        `✅ Adicionei ${newPairs.length === 1 ? '1 FAQ' : `${newPairs.length} FAQs`}. Quer adicionar mais alguma ou podemos continuar?`,
      next_step: 'faq_more',
      extracted_data: { faq: mergedFaq, faq_skipped: false },
      action_options: ['Adicionar mais', 'Continuar'],
      requires_action: 'faq_more',
    }
  }

  if (currentStep === 'faq_more') {
    const wantsMore = /(mais|adicionar|sim)/i.test(text)
    const wantsContinue = /(continuar|não|nao|seguir|pronto|ok)/i.test(text)

    if (wantsMore && !wantsContinue) {
      return {
        assistant_message: 'Manda mais perguntas e respostas no formato “Pergunta? Resposta”.',
        next_step: 'faq_question',
      }
    }

    const merged = { ...collectedData, faq_skipped: true } // “true” aqui significa “não perguntar de novo”; se já tem faq, ok
    if (Array.isArray(collectedData.faq) && collectedData.faq.length > 0) merged.faq_skipped = false

    const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('faq_more', merged))
    let resp: OnboardingResponse = {
      assistant_message: next.message,
      next_step: next.step,
      extracted_data: {},
      requires_action: next.requires_action,
      action_options: next.action_options,
      ...(next.step === 'schedule_days'
        ? { selectable_options: buildDaysSelectableOptions(merged.schedule?.days_of_week || []) }
        : {}),
    }
    resp = attachSummaryPayload(resp, merged)
    return resp
  }

  if (currentStep === 'services_list') {
    const selectServicesMatch = text.match(/^select_services:(.+)$/i)
    if (selectServicesMatch) {
      const servicesText = selectServicesMatch[1].trim()
      const newFromPayload = sanitizeExtractedServices(parseServicesList(servicesText), text).services
      if (newFromPayload.length > 0) {
        const baseServices = Array.isArray(collectedData.services) ? collectedData.services : []
        const mergedServices = [...baseServices, ...newFromPayload].filter((s, i, self) => {
          const key = (s?.name || '').toLowerCase().trim()
          return key && i === self.findIndex((x) => (x?.name || '').toLowerCase().trim() === key)
        })
        const merged = { ...collectedData, services: mergedServices, services_confirmed: false }
        const next = determineNextStep(merged as BusinessModelData, '', makeFlowState('services_list', merged))
        return {
          assistant_message: buildServicesReviewMessage(mergedServices),
          next_step: 'services_list',
          extracted_data: { services: mergedServices, services_confirmed: false },
          editable_items: buildServiceItems(mergedServices),
          action_options: ['Continuar'],
          requires_action: 'services_edit',
        }
      }
    }

    const wantsContinue = /(continuar|seguir|pronto|ok)/i.test(text)
    if (lower.includes('adicionar serviço') || lower.includes('adicionar servico')) {
      return {
        assistant_message: 'Qual serviço você quer adicionar?',
        next_step: 'services_add',
      }
    }
    const merged = { ...collectedData }
    let services = []
    if (isExplicitServicesList(text)) services = parseServicesList(text)
    else {
      const extractedRaw = await extractBusinessModelWithAI(text, merged)
      const extracted = sanitizeExtractionResult(extractedRaw, text)
      services = extracted.services || []
      if (!services.length) services = extractServicesFromText(text)
    }

    services = sanitizeExtractedServices(services, text).services

    const baseServices = shouldReplaceServices(text) ? [] : merged.services || []
    const unique = [...baseServices, ...services].filter((s, i, self) => {
      const key = (s?.name || '').toLowerCase().trim()
      return key && i === self.findIndex((x) => (x?.name || '').toLowerCase().trim() === key)
    })

    if (!unique.length) {
      const serviceExamples = buildServiceExamples(collectedData.business_type, collectedData.business_segment)
      const serviceOpts = buildServiceSelectableOptions(serviceExamples)
      return {
        assistant_message:
          'Beleza. Pra eu montar a parte de **agendamento**, preciso saber o que o cliente pode marcar.\n\nSelecione os que você oferece ou adicione outros abaixo:',
        next_step: 'services_list',
        selectable_options: serviceOpts,
        requires_action: 'services_list',
      }
    }

    const merged2 = { ...merged, services: unique, services_confirmed: false }
    if (wantsContinue) {
      const confirmed = { ...merged2, services_confirmed: true }
      const next = determineNextStep(confirmed as BusinessModelData, '', makeFlowState('services_list', confirmed))
      return {
        assistant_message: next.message,
        next_step: next.step,
        extracted_data: { services: unique, services_confirmed: true },
        requires_action: next.requires_action,
        action_options: next.action_options,
        ...(next.step === 'schedule_days'
          ? { selectable_options: buildDaysSelectableOptions(confirmed.schedule?.days_of_week || []) }
          : {}),
      }
    }
    return {
      assistant_message: buildServicesReviewMessage(unique),
      next_step: 'services_list',
      extracted_data: { services: unique, services_confirmed: false },
      editable_items: buildServiceItems(unique),
      action_options: ['Continuar'],
      requires_action: 'services_edit',
    }
  }

  if (currentStep === 'services_add') {
    const services = sanitizeExtractedServices(
      isExplicitServicesList(text)
      ? parseServicesList(text)
      : extractServicesFromText(text),
      text
    ).services
    if (!services.length && text.trim().length >= 2) {
      services.push({ name: text.trim() })
    }
    if (!services.length) {
      return {
        assistant_message: 'Não consegui identificar o serviço. Você pode escrever assim: "Corte masculino".',
        next_step: 'services_add',
      }
    }
    const mergedServices = [...(collectedData.services || []), ...services].filter((s, i, self) => {
      const key = (s?.name || '').toLowerCase().trim()
      return key && i === self.findIndex((x) => (x?.name || '').toLowerCase().trim() === key)
    })
    return {
      assistant_message: '✅ Serviço(s) adicionado(s). Você pode revisar a lista abaixo e continuar quando quiser.',
      next_step: 'services_list',
      extracted_data: { services: mergedServices, services_confirmed: false },
      editable_items: buildServiceItems(mergedServices),
      action_options: ['Continuar'],
      requires_action: 'services_edit',
    }
  }

  // Para os demais steps, usamos IA apenas para enriquecer/mesclar e seguimos o motor
  const extractedRaw = await extractBusinessModelWithAI(text, collectedData)
  const extracted = sanitizeExtractionResult(extractedRaw, text)
  // Merge seguro: schedule é mesclado para não sobrescrever interval_minutes etc. quando a IA retorna objeto parcial
  const mergedData = { ...collectedData, ...extracted }
  if (Array.isArray(extracted.services) && extracted.services.length > 0) {
    ;(mergedData as any).services_confirmed = false
    if (currentStep === 'summary_edit' || currentStep === 'summary') {
      mergedData.services = [...(collectedData.services || []), ...extracted.services].filter((s, i, self) => {
        const key = (s?.name || '').toLowerCase().trim()
        return key && i === self.findIndex((x) => (x?.name || '').toLowerCase().trim() === key)
      })
    }
  }
  if (extracted?.schedule && typeof extracted.schedule === 'object') {
    mergedData.schedule = { ...(collectedData.schedule || {}), ...extracted.schedule }
    if (Array.isArray(extracted.schedule.breaks) && extracted.schedule.breaks.length > 0) {
      ;(mergedData as any).schedule_breaks_configured = true
    }
  }
  const contextFromMessage = parseContext(text)
  if (contextFromMessage) {
    ;(mergedData as any).context = combineContext(
      normalizeContextValue((mergedData as any).context),
      contextFromMessage
    )
  }
  // Parse location_mode a partir de frases como "Ponto fixo", "Atende no local do cliente"
  const locLower = text.toLowerCase()
  if (locLower.includes('ponto fixo') || locLower.includes('endereço fixo') || locLower.includes('endereco fixo')) {
    ;(mergedData as any).location_mode = 'fixed'
  }
  if (locLower.includes('atende no local') || locLower.includes('local do cliente') || locLower.includes('atendimento no local')) {
    ;(mergedData as any).location_mode = 'mobile'
  }

  const fallbackServices = extractServicesFromText(text)
  if (fallbackServices.length > 0) {
    const sanitizedFallback = sanitizeExtractedServices(fallbackServices, text).services
    mergedData.services = shouldReplaceServices(text)
      ? sanitizedFallback
      : [...(mergedData.services || []), ...sanitizedFallback].filter((s, i, self) => {
          const key = (s?.name || '').toLowerCase().trim()
          return key && i === self.findIndex((x) => (x?.name || '').toLowerCase().trim() === key)
        })
    ;(mergedData as any).services_confirmed = false
  }

  // Handlers simples para alguns steps onde a IA não é necessária
  if (currentStep === 'quote_variables') {
    const vars = extractQuoteVariables(text)
    if (!vars.length) {
      return {
        assistant_message:
          'Pra eu conseguir qualificar um orçamento, quais informações você precisa que o cliente informe?\n\nEx.: medidas, quantidade, material, cor.',
        next_step: 'quote_variables',
      }
    }
    const dynamic = vars.map((v) => ({ key: v, label: v.charAt(0).toUpperCase() + v.slice(1), type: 'text', context: 'quote' }))
    const merged2 = { ...mergedData, dynamic_variables: dynamic }
    const next = determineNextStep(merged2 as BusinessModelData, '', makeFlowState('quote_variables', merged2))
    return { assistant_message: `✅ Anotei as variáveis.\n\n${next.message}`, next_step: next.step, extracted_data: { dynamic_variables: dynamic } }
  }

  if (currentStep === 'summary_edit') {
    // "Salvar ajustes" ou "Voltar" - avançar/voltar no fluxo com os dados atuais
    const isSalvar = /salvar|continuar|confirmar|ok|pronto/i.test(text)
    const isVoltar = /voltar|cancelar|deixa/i.test(text)
    if (isSalvar || isVoltar) {
      const ctx = parseContext(text) || mergedData.context
      if (ctx) mergedData.context = ctx
      const locLower = text.toLowerCase()
      if (locLower.includes('ponto fixo') || locLower.includes('endereço fixo') || locLower.includes('endereco fixo')) {
        ;(mergedData as any).location_mode = 'fixed'
      }
      if (locLower.includes('atende no local') || locLower.includes('local do cliente') || locLower.includes('mobile')) {
        ;(mergedData as any).location_mode = 'mobile'
      }
      const next = determineNextStep(mergedData as BusinessModelData, '', makeFlowState('summary_edit', mergedData))
      let resp: OnboardingResponse = {
        assistant_message: next.message,
        next_step: next.step,
        extracted_data: mergedData,
        requires_action: next.requires_action,
        action_options: next.action_options,
        ...(next.step === 'schedule_days' ? { selectable_options: buildDaysSelectableOptions(mergedData.schedule?.days_of_week || []) } : 'selectable_options' in next ? { selectable_options: (next as { selectable_options?: unknown }).selectable_options } : {}),
      }
      resp = attachSummaryPayload(resp, mergedData)
      return resp
    }
  }

  if (currentStep === 'summary') {
    if (lower.includes('correto') || lower.includes('está certo') || lower.includes('esta certo') || lower.includes('sim')) {
      return {
        assistant_message:
          'Perfeito! Já consigo montar a primeira versão do seu atendimento.\n\nPara salvar tudo e te mostrar o fluxo visual, preciso criar sua conta rapidinho.',
        next_step: 'signup_request',
        requires_action: 'signup',
        action_options: ['Criar conta', 'Tenho conta', 'Simular atendimento', 'Continuar depois'],
      }
    }
    return {
      assistant_message: 'Edite os campos abaixo se quiser alterar algo.',
      next_step: 'summary_edit',
      editable_items: buildEditableItems(mergedData),
      action_options: ['Salvar ajustes', 'Voltar'],
      requires_action: 'edit_fields',
    }
  }

  if (currentStep === 'signup_request') {
    // "Criar conta" / "Quero criar" -> frontend mostra formulário (Google + email/senha). Não pedir email via chat.
    if (lower.includes('criar') || lower.includes('conta') || lower.includes('sim')) {
      return {
        assistant_message: 'Beleza! Use o formulário abaixo para criar sua conta (Google ou email/senha).',
        next_step: 'signup_request',
        requires_action: 'signup',
        action_options: ['Continuar depois'],
      }
    }
    if (lower.includes('tenho conta') || lower.includes('já tenho')) {
      return {
        assistant_message: 'Entendido. Use o formulário abaixo para entrar na sua conta.',
        next_step: 'signup_request',
        requires_action: 'signup',
        action_options: ['Continuar depois'],
      }
    }
    return { assistant_message: 'Ok. Se preferir, você pode criar a conta depois.', next_step: 'signup_request' }
  }

  if (currentStep === 'signup_email') {
    if (!text.includes('@')) return { assistant_message: 'Por favor, informe um email válido.', next_step: 'signup_email' }
    return { assistant_message: 'Agora crie uma senha (mínimo 8 caracteres).', next_step: 'signup_password', extracted_data: { email: text } }
  }

  if (currentStep === 'signup_password') {
    if (text.length < 8) return { assistant_message: 'A senha deve ter no mínimo 8 caracteres. Tente novamente.', next_step: 'signup_password' }
    return { assistant_message: 'Repita a senha para confirmar.', next_step: 'signup_confirm_password', extracted_data: { password: text } }
  }

  if (currentStep === 'signup_confirm_password') {
    const password = collectedData.password || ''
    if (text !== password) return { assistant_message: 'As senhas não coincidem. Digite novamente.', next_step: 'signup_password' }

    const migrationResult = await migrateOnboardingToTenant(supabaseAdmin, session.session_id, mergedData)
    if (!migrationResult.success) {
      return {
        assistant_message: `Ops, ocorreu um erro ao criar sua conta: ${migrationResult.error}\n\nPode tentar novamente?`,
        next_step: 'signup_email',
      }
    }

    return {
      assistant_message: 'Conta criada 🎉\n\nJá montei a primeira versão do seu fluxo.',
      next_step: 'completed',
      extracted_data: { user_id: migrationResult.user_id, tenant_id: migrationResult.tenant_id },
    }
  }

  if (currentStep === 'completed') {
    return { assistant_message: 'Seu onboarding está completo! 🎉', next_step: 'completed' }
  }

  // Fluxo padrão: motor decide o próximo step com base nos missing fields
  const next = determineNextStep(mergedData as BusinessModelData, text, makeFlowState(currentStep, mergedData))
  const resp: OnboardingResponse = {
    assistant_message: next.message,
    next_step: next.step,
    extracted_data: extracted,
    action_options: next.action_options,
    requires_action: next.requires_action,
  }

  if (next.step === 'schedule_days') {
    resp.selectable_options = buildDaysSelectableOptions(mergedData.schedule?.days_of_week || [])
  }
  if (next.step === 'services_list' && next.selectable_options) {
    resp.selectable_options = next.selectable_options
  }
  if (next.step === 'services_pricing' && !resp.editable_items) {
    resp.assistant_message =
      'Para cada serviço, informe o valor em R$ (ou deixe em branco). Você pode editar nos itens abaixo e depois clicar em Continuar.'
    resp.editable_items = buildServicePriceItems(mergedData.services || [])
    resp.action_options = ['Continuar', 'Pular por enquanto']
    resp.requires_action = 'services_pricing'
    resp.extracted_data = {
      ...(resp.extracted_data || {}),
      services_pricing_entered: true,
    }
  }

  // Se caiu em summary, padronizar payload
  const normalized = attachSummaryPayload(resp, mergedData)
  if (normalized.next_step === 'summary' && !normalized.editable_items) {
    // fallback defensivo (não deve acontecer)
    normalized.editable_items = buildEditableItems(mergedData)
  }

  return normalized
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  try {
    const body = await parseBody(req)
    if (!body) return json({ error: 'Body inválido ou não é JSON' }, 400)
    if (!body.session_id || !body.message) return json({ error: 'session_id e message são obrigatórios' }, 400)

    const { supabaseAdmin, envError } = createSupabaseAdmin()
    if (envError) return json({ error: envError }, 500)

    const { session, isNew } = await getOrCreateSession(supabaseAdmin, body.session_id)
    let collectedData = { ...(session?.collected_data || {}) }

    // Aplicar edits em lote (campos inline) antes de processar a mensagem
    if (Array.isArray(body.edits) && body.edits.length > 0) {
      for (const { id, value } of body.edits) {
        collectedData = applyInlineEdit({ ...collectedData }, id, value)
      }
    }

    // Aplicar endereço (formulário com CEP) quando enviado
    if (body.address && body.address.cep && body.address.logradouro && body.address.numero && body.address.bairro && body.address.localidade && body.address.uf) {
      collectedData = { ...collectedData, establishment_address: body.address }
    }

    const currentStep = body.current_step || session.current_step_key || 'welcome'
    const isSignupStep = ['signup_email', 'signup_password', 'signup_confirm_password'].includes(currentStep)

    // Sincronizar apenas edits inline (sem mensagem no chat): persiste no backend e retorna o mesmo step atualizado.
    if (
      body.message === '__sync_edits__' &&
      Array.isArray(body.edits) &&
      body.edits.length > 0
    ) {
      await supabaseAdmin.from('onboarding_sessions').update({
        collected_data: collectedData,
        current_step_key: currentStep,
        updated_at: new Date().toISOString(),
      }).eq('session_id', body.session_id)

      let syncResponse: OnboardingResponse
      if (currentStep === 'services_list') {
        const services = Array.isArray(collectedData.services) ? collectedData.services : []
        syncResponse = {
          assistant_message: buildServicesReviewMessage(services),
          next_step: 'services_list',
          extracted_data: collectedData,
          editable_items: buildServiceItems(services),
          action_options: ['Continuar'],
          requires_action: 'services_edit',
        }
      } else if (currentStep === 'summary_edit' || currentStep === 'summary') {
        syncResponse = {
          assistant_message: 'Edite os campos abaixo se quiser alterar algo.',
          next_step: currentStep,
          extracted_data: collectedData,
          editable_items: buildEditableItems(collectedData),
          action_options: currentStep === 'summary_edit' ? ['Salvar ajustes', 'Voltar'] : ['Está correto', 'Quero ajustar'],
          requires_action: currentStep === 'summary_edit' ? 'edit_fields' : 'summary_confirmation',
        }
      } else {
        syncResponse = {
          assistant_message: 'Atualizado.',
          next_step: currentStep,
          extracted_data: collectedData,
        }
      }
      return json(syncResponse)
    }

    const userMessageContent = isSignupStep
      ? '[dados de cadastro]'
      : userMessageDisplayContent(body.message)

    await supabaseAdmin.from('onboarding_messages').insert({
      session_id: body.session_id,
      role: 'user',
      content: userMessageContent,
    })

    let response: OnboardingResponse
    if (currentStep === 'welcome' && isNew) {
      if (isGreetingOnlyMessage(body.message)) {
        response = {
          assistant_message: buildGreetingDiscoveryMessage(),
          next_step: 'welcome_intro_choice',
          extracted_data: {},
          action_options: INTRO_DISCOVERY_OPTIONS,
          requires_action: 'welcome_intro_choice',
        }
      } else {
      // Pedido de ajuda/tutorial na primeira mensagem tem prioridade sobre extração.
      if (await classifyNeedsIntroTutorial(body.message)) {
        response = {
          assistant_message: `${buildIntroTutorialMessage()}\n\nQuando quiser, escolha uma opção abaixo:`,
          next_step: 'welcome_tutorial_cta',
          extracted_data: {},
          action_options: INTRO_TUTORIAL_CTA_OPTIONS,
          requires_action: 'welcome_tutorial_cta',
        }
      } else {
        // IA first no primeiro turno: se já houver contexto de ramo, avançar sem cair em tutorial.
        const firstExtractionRaw = await extractBusinessModelWithAI(body.message, collectedData)
        const firstExtraction = sanitizeExtractionResult(firstExtractionRaw, body.message)
        const resolvedBusinessType = resolveBusinessTypeCandidate(firstExtraction?.business_type, body.message)
        const hasInitialExtraction = hasOnboardingSeedExtraction(firstExtraction) || Boolean(resolvedBusinessType)
        const hasBusinessContext = hasInitialExtraction || isLikelyBusinessInfoFirstMessage(body.message)

        if (hasBusinessContext) {
          response = await processMessage(
            body.message,
            'collect_free_text',
            {
              ...collectedData,
              ...firstExtraction,
              ...(resolvedBusinessType ? { business_type: resolvedBusinessType } : {}),
            },
            session,
            supabaseAdmin
          )
        } else {
          response = {
            assistant_message:
              'Oi! Eu sou o Nevo. Vou te fazer algumas perguntas rápidas pra entender seu negócio e montar um atendimento inteligente.\n\nMe conta: qual é o seu ramo de atividade e o que você faz?',
            next_step: 'collect_free_text',
            extracted_data: {},
          }
        }
      }
      }
    } else {
      response = await processMessage(body.message, currentStep, collectedData, session, supabaseAdmin)
    }

    response = ensureNextStep(response, currentStep || 'collect_free_text')

    const updatedData = { ...collectedData, ...(response.extracted_data || {}) }

    // IA como fonte principal de exemplos de serviços — categorização por ramo de atividade, sem mapeamento estático
    if (
      response.next_step === 'services_list' &&
      updatedData.business_type &&
      (response.requires_action === 'services_list' || response.requires_action === 'services_edit')
    ) {
      const aiExamples = await suggestServicesWithAI(updatedData.business_type)
      response.selectable_options = buildServiceSelectableOptions(aiExamples)
    }
    // Não injetar handoff_mode por padrão — só mostrar na UI se o usuário configurou explicitamente

    const missingFields = identifyMissingFields(updatedData as BusinessModelExtraction, (updatedData as any).context)

    await supabaseAdmin
      .from('onboarding_sessions')
      .update({
        current_step_key: response.next_step,
        collected_data: updatedData,
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', body.session_id)

    await supabaseAdmin.from('onboarding_messages').insert({
      session_id: body.session_id,
      role: 'assistant',
      content: response.assistant_message,
      metadata: {
        next_step: response.next_step,
        requires_action: response.requires_action,
        action_options: response.action_options,
        missing_fields: missingFields,
        selectable_options: response.selectable_options ?? undefined,
        editable_items: response.editable_items ?? undefined,
      },
    })

    return json(response)
  } catch (error: any) {
    console.error('Error na Edge Function:', error)
    return json(
      { error: error?.message || error?.toString() || 'Erro desconhecido' },
      500
    )
  }
})

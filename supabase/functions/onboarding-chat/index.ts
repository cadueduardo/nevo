// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import {
  extractBusinessModelWithAI,
  identifyMissingFields,
  parseServicesList,
  extractQuoteVariables,
  BusinessModelExtraction,
} from './extractors.ts'

import { determineNextStep, generateSummary, generateFullStructure, BusinessModelData, FlowState } from './flow-manager.ts'
import { migrateOnboardingToTenant } from './migrate.ts'

interface OnboardingRequest {
  session_id: string
  message: string
  current_step?: string
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

function isLikelyBusinessInfoFirstMessage(message: string): boolean {
  const text = (message || '').toLowerCase().trim()
  if (!text) return false

  // Cumprimentos curtos / mensagens vazias → não tratar como descrição do negócio
  if (text.length < 8) return false
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|e aí|e ai|fala|hello)\b/.test(text) && text.length < 30) {
    return false
  }

  // Sinais de descrição de negócio / atendimento / horários / nome
  const patterns = [
    /\b(sou|tenho|trabalho|atuo|atendo|faço|faco|vendo|presto)\b/,
    /\b(barbearia|barbeiro|salão|salao|clínica|clinica|loja|restaurante|pizzaria|lanchonete|oficina|delivery)\b/,
    /\b(chama|se chama|nome)\b/,
    /\b(seg|segunda|ter|terça|quarta|quinta|sexta|sáb|sábado|domingo)\b/,
    /\b(das|de)\s*\d{1,2}\b.*\b(as|às|até|ate)\b.*\d{1,2}\b/,
  ]
  return patterns.some((p) => p.test(text))
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

function buildEditableItems(data: any) {
  const items: Array<{ id: string; label: string; value: string; type: string }> = []
  if (data.business_name) items.push({ id: 'business_name', label: 'Nome do negócio', value: data.business_name, type: 'business_name' })
  if (data.business_type) items.push({ id: 'business_type', label: 'Tipo de negócio', value: data.business_type, type: 'business_type' })

  if (data.context) {
    const label = data.context === 'booking' ? 'Agendamento' : data.context === 'quote' ? 'Orçamento' : 'Agendamento + Orçamento'
    items.push({ id: 'context', label: 'Contexto', value: label, type: 'context' })
  }

  if (data.service_area?.region || data.service_area?.coverage) {
    const cov = data.service_area?.coverage ? ` (${data.service_area.coverage})` : ''
    const val = `${data.service_area?.region || ''}${cov}`.trim()
    if (val) items.push({ id: 'service_area', label: 'Região', value: val, type: 'service_area' })
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

  if (data.policies) {
    const note = typeof data.policies?.note === 'string' ? data.policies.note.trim() : ''
    items.push({
      id: 'policies',
      label: 'Políticas',
      value: note ? note : 'Sem políticas por enquanto',
      type: 'policies',
    })
  }

  if (Array.isArray(data.services)) {
    data.services.forEach((s: any, i: number) => items.push({ id: `service_${i}`, label: 'Serviço', value: s.name, type: 'service' }))
  }
  return items
}

function attachSummaryPayload(resp: OnboardingResponse, data: any): OnboardingResponse {
  if (resp.next_step !== 'summary') return resp
  if (!(data?.business_name && data?.business_type && data?.context)) return resp
  return {
    ...resp,
    assistant_message: generateSummary(data),
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
  const booking = m.includes('agendamento') || m.includes('agendar')
  const quote = m.includes('orçamento') || m.includes('orcamento') || m.includes('orcar')
  if (booking && quote) return 'both'
  if (booking) return 'booking'
  if (quote) return 'quote'
  return null
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
    /(?:pausa|intervalo|almo[cç]o).*?(?:das|de)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\s*(?:às|as|a|até|ate|-)\s*(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?/i
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
  const midday = text.match(/(?:pausa|intervalo|almo[cç]o).*?(meio\s*dia|12h|12:00|12)\s*(?:até|ate)\s*(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?/i)
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

  // Tentativa 1: range completo em uma tacada
  const range = parseTimeRange(text)
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

  // Pausas explícitas (se vierem no texto)
  const explicitBreaks = parseBreaksFromText(text)
  if (explicitBreaks.length > 0) out.breaks = explicitBreaks

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
      } else if (id.startsWith('service_')) {
        const idx = parseInt(id.replace('service_', ''))
        const services = Array.isArray(updated.services) ? [...updated.services] : []
        if (!Number.isNaN(idx) && idx >= 0 && idx < services.length) {
          services[idx] = { ...(services[idx] || {}), name: value }
          updated.services = services
        }
      } else if (id === 'policies') {
        // salvar como nota (não inferir valores)
        updated.policies = { note: value }
      }
    }

    if (delCmd) {
      const { id } = delCmd
      if (id === 'service_area') delete updated.service_area
      else if (id === 'tone_of_voice') delete updated.tone_of_voice
      else if (id === 'schedule') updated.schedule = {}
      else if (id === 'policies') delete updated.policies
      else if (id.startsWith('service_')) {
        const idx = parseInt(id.replace('service_', ''))
        const services = Array.isArray(updated.services) ? [...updated.services] : []
        if (!Number.isNaN(idx) && idx >= 0 && idx < services.length) {
          updated.services = services.filter((_, i) => i !== idx)
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

  // Comando explícito: mostrar estrutura completa
  if (/(quero ver o resumo|mostrar resumo|mostrar estrutura|ver estrutura|ver configuração|mostrar configuração)/i.test(text)) {
    const merged = { ...collectedData }
    if (!merged.business_type) {
      return { assistant_message: 'Antes do resumo, qual é o tipo do seu negócio (o que você faz/vende)?', next_step: 'business_type' }
    }
    if (!merged.business_name) {
      return { assistant_message: `Entendi que você atua com ${merged.business_type}. Qual é o nome do seu negócio?`, next_step: 'business_name' }
    }
    if (!merged.context) {
      return {
        assistant_message: `Perfeito — ${merged.business_name} (${merged.business_type}). Você quer configurar **agendamento**, **orçamento**, ou **ambos**?`,
        next_step: 'context',
        action_options: ['Agendamento', 'Orçamento', 'Ambos'],
        requires_action: 'context',
      }
    }
    return {
      assistant_message: `${generateFullStructure(merged)}\n\nQuer que eu ajuste algo?`,
      next_step: 'summary_edit',
      editable_items: buildEditableItems(merged),
      action_options: ['Salvar ajustes', 'Voltar'],
      requires_action: 'edit_fields',
    }
  }

  // Steps determinísticos primeiro (não depender de botão/ui_action)
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

    const merged = { ...collectedData, schedule: nextSchedule }
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
    const merged = { ...collectedData }
    let services = []
    if (isExplicitServicesList(text)) services = parseServicesList(text)
    else {
      const extracted = await extractBusinessModelWithAI(text, merged)
      services = extracted.services || []
    }

    const unique = [...(merged.services || []), ...services].filter((s, i, self) => {
      const key = (s?.name || '').toLowerCase().trim()
      return key && i === self.findIndex((x) => (x?.name || '').toLowerCase().trim() === key)
    })

    if (!unique.length) {
      return {
        assistant_message:
          'Pra eu configurar o agendamento, preciso saber o que o cliente pode marcar.\n\nQuais serviços você oferece? Liste separando por vírgula.\n\nExemplo: Consulta, Atendimento, Retorno',
        next_step: 'services_list',
      }
    }

    const merged2 = { ...merged, services: unique }
    const next = determineNextStep(merged2 as BusinessModelData, '', makeFlowState('services_list', merged2))
    return {
      assistant_message: `✅ Serviços anotados.\n\n${next.message}`,
      next_step: next.step,
      extracted_data: { services: unique },
      requires_action: next.requires_action,
      action_options: next.action_options,
    }
  }

  // Para os demais steps, usamos IA apenas para enriquecer/mesclar e seguimos o motor
  const extracted = await extractBusinessModelWithAI(text, collectedData)
  const mergedData = { ...collectedData, ...extracted }

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

  if (currentStep === 'summary') {
    if (lower.includes('correto') || lower.includes('está certo') || lower.includes('esta certo') || lower.includes('sim')) {
      return {
        assistant_message:
          'Perfeito! Já consigo montar a primeira versão do seu atendimento.\n\nPara salvar tudo e te mostrar o fluxo visual, preciso criar sua conta rapidinho.',
        next_step: 'signup_request',
        requires_action: 'signup',
        action_options: ['Criar conta', 'Continuar depois'],
      }
    }
    return {
      assistant_message: 'Sem problemas! Me diga o que você quer ajustar.',
      next_step: 'summary_edit',
      editable_items: buildEditableItems(mergedData),
      action_options: ['Salvar ajustes', 'Voltar'],
      requires_action: 'edit_fields',
    }
  }

  if (currentStep === 'signup_request') {
    if (lower.includes('criar') || lower.includes('conta') || lower.includes('sim')) {
      return {
        assistant_message: 'Beleza. Qual email você quer usar para acessar o Nevo?',
        next_step: 'signup_email',
      }
    }
    return { assistant_message: 'Ok. Se preferir, você pode criar a conta depois.', next_step: 'collect_free_text' }
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
    const collectedData = session?.collected_data || {}

    await supabaseAdmin.from('onboarding_messages').insert({
      session_id: body.session_id,
      role: 'user',
      content: body.message,
    })

    const currentStep = body.current_step || session.current_step_key || 'welcome'

    let response: OnboardingResponse
    if (currentStep === 'welcome' && isNew) {
      // “Chat inteligente”: se o usuário já descreveu o negócio na 1ª mensagem,
      // não repetir pergunta genérica — extrair e avançar no fluxo.
      if (isLikelyBusinessInfoFirstMessage(body.message)) {
        response = await processMessage(body.message, 'collect_free_text', collectedData, session, supabaseAdmin)
      } else {
        response = {
          assistant_message:
            'Oi! Eu sou o Nevo. Vou te fazer algumas perguntas rápidas pra entender seu negócio e montar um atendimento inteligente.\n\nMe conta: qual é o seu ramo de atividade e o que você faz?',
          next_step: 'collect_free_text',
          extracted_data: {},
        }
      }
    } else {
      response = await processMessage(body.message, currentStep, collectedData, session, supabaseAdmin)
    }

    response = ensureNextStep(response, currentStep || 'collect_free_text')

    const updatedData = { ...collectedData, ...(response.extracted_data || {}) }
    if (!updatedData.handoff_mode) updatedData.handoff_mode = 'conditional'

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


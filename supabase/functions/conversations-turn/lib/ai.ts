// @ts-nocheck
import {
  normalizeText,
  getTodayIsoBusinessTz,
  addDaysToIsoDate,
  getWeekdayKey,
  getNowInBusinessTz,
  isBusinessClosedForToday,
  formatDatePt,
  parseDateOrWeekday,
  parseTime,
} from "./utils.ts"
import { fetchNationalHolidays } from "./holidays.ts"
import type { SimulatorState, SimulatorConfig, FlowOrchestratorOutput } from "./types.ts"
import { findServicesFromText } from "./services.ts"
import { resolveConfiguredServicesFromConfig } from "./canonical-services.ts"
import { buildBusinessBrain } from "./semantic-core/business-brain.ts"
import { buildAgentRuntimeContext } from "./semantic-core/agent-runtime-context.ts"
import type { AgentNarrative, AgentRuntimeContext, BusinessBrain } from "./semantic-core/types.ts"

type SemanticContinuationContext = {
  kind?: "audience_confirmation" | "price_followup" | "calendar_response" | "contact_preference"
  matched_option?: string
  last_prompt?: string
  last_action_options?: string[]
}

function buildSemanticContinuationPrompt(
  semanticContext?: SemanticContinuationContext,
  extraRules?: string[]
): string {
  if (!semanticContext?.kind) return ""

  const rules = [
    'Se continuation_kind = "price_followup", trate a mensagem atual como continuidade da pergunta anterior sobre preco/servico.',
    'Se continuation_kind = "audience_confirmation", trate a mensagem atual como continuidade de um agendamento ja iniciado.',
    ...(extraRules || []).filter(Boolean),
  ]

  return `\nCONTEXTO DE CONTINUIDADE:
- continuation_kind: ${semanticContext.kind}
- last_prompt: "${semanticContext.last_prompt || ""}"
- matched_option: "${semanticContext.matched_option || ""}"
- last_action_options: ${JSON.stringify(semanticContext.last_action_options || [])}

Regras de continuidade:
${rules.map((rule) => `- ${rule}`).join("\n")}`
}

const DAY_NAMES: Record<string, string> = {
  monday: "segunda",
  tuesday: "terÃ§a",
  wednesday: "quarta",
  thursday: "quinta",
  friday: "sexta",
  saturday: "sÃ¡bado",
  sunday: "domingo",
}

function buildConfigSummary(config: SimulatorConfig): string {
  const parts: string[] = []
  if (config.business_name) parts.push(`Nome: ${config.business_name}`)
  if (config.business_type) parts.push(`Ramo: ${config.business_type}`)
  const addr = config.establishment_address
  if (addr?.logradouro) {
    const a = `${addr.logradouro}, ${addr.numero}${addr.complemento ? ` ${addr.complemento}` : ""} - ${addr.bairro}, ${addr.localidade}/${addr.uf}`
    parts.push(`EndereÃ§o: ${a}`)
  }
  const sched = config.schedule
  if (sched?.days_of_week?.length && sched.start_time && sched.end_time) {
    const days = sched.days_of_week.map((d) => DAY_NAMES[d] || d).join(", ")
    parts.push(`HorÃ¡rio: ${days}, das ${sched.start_time} Ã s ${sched.end_time}`)
    if (sched.interval_minutes) parts.push(`Intervalo entre atendimentos: ${sched.interval_minutes} min`)
    if (sched.breaks?.length) {
      const breaksStr = sched.breaks.map((b) => `${b.start} Ã s ${b.end}`).join("; ")
      parts.push(`Pausa no expediente (nao atendemos nesses horarios): ${breaksStr}`)
    }
  }
  const services = resolveConfiguredServicesFromConfig(config)
  if (services.length > 0) {
    const withPrice = services.filter((s) => s.base_price != null)
    const svcLines = services.map((s) => {
      const p = s.base_price != null ? `R$ ${s.base_price}` : "valor sob consulta"
      const d = s.duration_minutes ? ` (${s.duration_minutes} min)` : ""
      return `- ${s.name}: ${p}${d}`
    })
    parts.push(`ServiÃ§os e preÃ§os:\n${svcLines.join("\n")}`)
    if (withPrice.length > 0) {
      parts.push(`\n[IMPORTANTE: ${withPrice.length} serviÃ§o(s) tem preÃ§o. Quando o cliente perguntar preÃ§o, informe o valor exato.]`)
    }
  }
  const faq = Array.isArray(config.faq) ? config.faq.filter((item) => item?.question || item?.answer) : []
  if (faq.length > 0) {
    const faqLines = faq
      .map((item) => `- ${String(item.question || "Pergunta").trim()}: ${String(item.answer || "").trim()}`)
      .join("\n")
    parts.push(`FAQ:
${faqLines}`)
  }

  const staff = config.staff || []
  if (staff.length > 0) {
    parts.push(`Colaboradores: ${staff.map((s) => s.name).join(", ")}`)
  }
  const ta = config.target_audience
  const modes = Array.isArray(ta?.modes) && ta.modes.length > 0 ? ta.modes : ta?.mode ? [ta.mode] : ["all"]
  const audienceLabels: Record<string, string> = {
    all: "todos os publicos",
    women_only: "somente mulheres",
    men_only: "somente homens",
    kids_only: "somente publico infantil",
    custom: ta?.note?.trim() || "publico personalizado",
  }
  const audienceText =
    modes.length === 0 || (modes.length === 1 && modes[0] === "all")
      ? audienceLabels.all
      : modes.map((m) => audienceLabels[m] || m).filter(Boolean).join(" e ")
  parts.push(`Publico-alvo: ${audienceText}`)

  const style = config.interaction_style || "numbered_options"
  const styleLabel =
    style === "conversational" ? "conversa natural" : style === "hybrid" ? "hibrido (natural + opcoes)" : "opcoes numeradas"
  parts.push(`Estilo de interacao: ${styleLabel}`)

  const holidaysAttend = Array.isArray(config.holidays_attend) ? config.holidays_attend : []
  if (holidaysAttend.length === 0) {
    parts.push("Feriados: nao atendemos em feriados nacionais.")
  } else {
    parts.push(`Feriados: atendemos apenas nos feriados que foram marcados no cadastro (${holidaysAttend.length} data(s)). Em feriados nao marcados, nao atendemos.`)
  }

  return parts.join("\n")
}

/** Retorna contexto de feriados para hoje e amanhÃ£: se sÃ£o feriados e se o negÃ³cio atende nesses dias. Usa Brasil API (mesma do onboarding). */
async function getHolidaysContextForPrompt(
  config: SimulatorConfig,
  todayIso: string,
  tomorrowIso: string
): Promise<string> {
  const holidaysAttend = new Set(Array.isArray(config.holidays_attend) ? config.holidays_attend : [])
  const yearToday = parseInt(todayIso.slice(0, 4), 10)
  const yearTomorrow = parseInt(tomorrowIso.slice(0, 4), 10)
  const years = yearToday === yearTomorrow ? [yearToday] : [yearToday, yearTomorrow]
  const allHolidays: Array<{ date: string; name: string }> = []
  for (const y of years) {
    const list = await fetchNationalHolidays(y)
    allHolidays.push(...list)
  }
  const lines: string[] = []
  for (const { dateIso, label } of [
    { dateIso: todayIso, label: "Hoje" },
    { dateIso: tomorrowIso, label: "Amanha" },
  ]) {
    const holiday = allHolidays.find((h) => h.date === dateIso)
    const ddMm = formatDatePt(dateIso)
    if (holiday) {
      const attends = holidaysAttend.has(dateIso)
      lines.push(
        `${label} (${ddMm}) e feriado de ${holiday.name}. ${attends ? "Atendemos nesse dia." : "NAO atendemos nesse dia; nao sugira essa data para agendamento."}`
      )
    } else {
      lines.push(`${label} (${ddMm}) nao e feriado.`)
    }
  }
  return `Feriados (Brasil): ${lines.join(" ")} Ao sugerir data, so sugira dias em que atendemos (dias de expediente e, se for feriado, so se estiver na lista de feriados em que atende).`
}

/** Contexto de hora atual, data (hoje/amanhÃ£ em DD/MM), dia da semana e se hoje/amanhÃ£ tÃªm expediente. A IA usa para nÃ£o dizer "tem vaga hoje" quando jÃ¡ encerrou e para sÃ³ sugerir dias em que hÃ¡ atendimento. */
function getNowAndTodayAvailabilityContext(
  config: SimulatorConfig,
  now: Date = new Date()
): string {
  const sched = config.schedule
  const { time: nowTime, dateIso: todayIso } = getNowInBusinessTz(now)
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)
  const todayDdMm = formatDatePt(todayIso)
  const tomorrowDdMm = formatDatePt(tomorrowIso)
  const end = sched?.end_time || "18:00"
  const closed = isBusinessClosedForToday(sched, now)
  const todayWeekdayKey = getWeekdayKey(todayIso)
  const tomorrowWeekdayKey = getWeekdayKey(tomorrowIso)
  const daysOfWeek = Array.isArray(sched?.days_of_week) ? sched.days_of_week : []
  const todayLabel = DAY_NAMES[todayWeekdayKey] || todayWeekdayKey
  const tomorrowLabel = DAY_NAMES[tomorrowWeekdayKey] || tomorrowWeekdayKey
  const tomorrowHasExpediente = daysOfWeek.length > 0 && daysOfWeek.includes(tomorrowWeekdayKey)
  const workingDaysLabel =
    daysOfWeek.length > 0
      ? daysOfWeek.map((d) => DAY_NAMES[d] || d).join(", ")
      : "nÃ£o definido"

  const dateLine = `DATA: Hoje Ã© ${todayDdMm} (${todayLabel}-feira). AmanhÃ£ Ã© ${tomorrowDdMm} (${tomorrowLabel}-feira). Use APENAS estas datas; nunca invente dia ou mÃªs.`
  const dayContext = `Atendemos apenas em: ${workingDaysLabel}. AmanhÃ£ ${tomorrowHasExpediente ? "temos" : "NÃƒO temos"} expediente. Ao sugerir "outro dia" ou "amanhÃ£", sÃ³ sugira dias em que hÃ¡ atendimento; se amanhÃ£ nÃ£o for dia de expediente, sugira o prÃ³ximo dia Ãºtil. Se o cliente JÃ disse que quer amanhÃ£, NÃƒO repita que o expediente de hoje encerrou.`

  if (closed) {
    const suggestLine = tomorrowHasExpediente
      ? "Diga que jÃ¡ encerrou e sugira amanhÃ£ ou outro dia em que haja expediente."
      : "Diga que jÃ¡ encerrou. NÃƒO sugira amanhÃ£ se amanhÃ£ nÃ£o for dia de atendimento; sugira o prÃ³ximo dia em que hÃ¡ expediente ou pergunte qual dia prefere."
    return `AGORA (horÃ¡rio do negÃ³cio): ${nowTime}. Expediente de hoje encerra Ã s ${end}. O expediente de hoje JÃ ENCERROU. NÃƒO diga que hÃ¡ horÃ¡rios disponÃ­veis para hoje. ${suggestLine}\n\n${dateLine}\n${dayContext}`
  }
  return `AGORA (horÃ¡rio do negÃ³cio): ${nowTime}. Expediente de hoje encerra Ã s ${end}. Se o cliente perguntar "tem horÃ¡rio para hoje?", sÃ³ diga que sim se ainda estiver dentro do expediente.\n\n${dateLine}\n${dayContext}`
}

function resolveNarrativeArtifacts(params: {
  config: SimulatorConfig
  businessBrain?: BusinessBrain
  agentNarrative?: AgentNarrative
  agentRuntimeContext?: AgentRuntimeContext
}): {
  businessBrain: BusinessBrain
  agentNarrative: AgentNarrative
  agentRuntimeContext: AgentRuntimeContext
  businessContext: string
} {
  const businessBrain = params.businessBrain || buildBusinessBrain(params.config)
  const agentNarrative = params.agentNarrative || businessBrain.agent_narrative
  const agentRuntimeContext =
    params.agentRuntimeContext ||
    businessBrain.agent_runtime_context ||
    buildAgentRuntimeContext({
      business_brain: {
        ...businessBrain,
        agent_narrative: agentNarrative,
      },
      agent_narrative: agentNarrative,
    })
  return {
    businessBrain,
    agentNarrative,
    agentRuntimeContext,
    businessContext:
      agentRuntimeContext.prompt_context ||
      agentNarrative?.prompt_context ||
      buildConfigSummary(params.config),
  }
}

function resolveServiceNames(params: {
  config: SimulatorConfig
  businessBrain?: BusinessBrain
  overrideServices?: Array<{ name?: string }>
}): string[] {
  const override = Array.isArray(params.overrideServices)
    ? params.overrideServices.map((item) => String(item?.name || "").trim()).filter(Boolean)
    : []
  if (override.length > 0) return override

  const brainServices = Array.isArray(params.businessBrain?.services)
    ? params.businessBrain.services.map((service) => String(service?.name || "").trim()).filter(Boolean)
    : []
  if (brainServices.length > 0) return brainServices

  const configServices = [
    ...resolveConfiguredServicesFromConfig(params.config),
  ]
    .map((item) => String(item?.name || "").trim())
    .filter(Boolean)

  return Array.from(new Set(configServices))
}

function resolveInteractionStyle(params: {
  config: SimulatorConfig
  businessBrain?: BusinessBrain
}): "numbered_options" | "conversational" | "hybrid" {
  return params.businessBrain?.policies?.interaction_style || params.config.interaction_style || "numbered_options"
}

function resolveBusinessType(params: {
  config: SimulatorConfig
  businessBrain?: BusinessBrain
}): string {
  return params.businessBrain?.business_type || params.config.business_type || "empresa"
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions"
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini"
const OPENAI_TIMEOUT_MS = 15000

function getOpenAIApiKey(): string | null {
  return Deno.env.get("OPENAI_API_KEY") || null
}

async function requestOpenAIChat(params: {
  apiKey: string
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
  max_tokens: number
  temperature: number
  response_format?: { type: "json_object" }
}): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_DEFAULT_MODEL,
        messages: params.messages,
        max_tokens: params.max_tokens,
        temperature: params.temperature,
        ...(params.response_format ? { response_format: params.response_format } : {}),
      }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    return typeof content === "string" ? content.trim() || null : null
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Responde de forma natural usando o config como contexto.
 * A IA entende QUALQUER mensagem e responde com os dados disponÃ­veis.
 * Como um ChatGPT que tem as informaÃ§Ãµes do negÃ³cio.
 * @param finalizedContext - Se true, o agendamento jÃ¡ foi confirmado; a IA nÃ£o deve pedir dados de contato.
 */
export async function answerWithContextualAI(
  config: SimulatorConfig,
  message: string,
  history: Array<{ role: string; content: string }> = [],
  finalizedContext = false,
  runtimeContext?: {
    business_brain?: BusinessBrain
    agent_narrative?: AgentNarrative
    agent_runtime_context?: AgentRuntimeContext
  }
): Promise<string | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  const { agentRuntimeContext, businessContext } = resolveNarrativeArtifacts({
    config,
    businessBrain: runtimeContext?.business_brain,
    agentNarrative: runtimeContext?.agent_narrative,
    agentRuntimeContext: runtimeContext?.agent_runtime_context,
  })
  const historyText =
    history.length > 0
      ? history
          .slice(-8)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histÃ³rico)"

  const finalizedHint = finalizedContext
    ? `\nCONTEXTO CRÃTICO: O agendamento do cliente JÃ FOI CONFIRMADO. Ele pode estar agradecendo, perguntando endereÃ§o/horÃ¡rio ou se despedindo. NUNCA peÃ§a telefone, email ou qualquer dado de contato novamente. NUNCA sugira "agendar um horÃ¡rio" ou "marcar consulta" â€” conecte Ã  conversa que ele acabou de concluir (ex.: "Se precisar de algo mais, estou Ã  disposiÃ§Ã£o."). Responda sÃ³ ao que foi perguntado, de forma cordial e breve.\n\n`
    : ""

  const style = config.interaction_style || "numbered_options"
  const styleHint =
    style === "conversational"
      ? `\nESTILO DE INTERAÃ‡ÃƒO: O dono do negÃ³cio escolheu CONVERSA NATURAL. O cliente responde em texto livre; nÃ£o assuma que ele vai escolher por nÃºmero. Responda de forma natural e humana, como um consierge; evite listar "1 - X, 2 - Y" a menos que seja realmente necessÃ¡rio.\n\n`
      : style === "hybrid"
        ? `\nESTILO DE INTERAÃ‡ÃƒO: O dono escolheu MISTO (natural + opÃ§Ãµes quando fizer sentido). Equilibre conversa natural com clareza; pode sugerir opÃ§Ãµes em alguns momentos.\n\n`
        : `\nESTILO DE INTERAÃ‡ÃƒO: O dono escolheu OPÃ‡Ã•ES NUMERADAS. As respostas podem ser exibidas como botÃµes numerados para o cliente responder de forma Ã¡gil.\n\n`

  const now = new Date()
  const todayIso = getTodayIsoBusinessTz(now)
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)
  const todayDdMm = formatDatePt(todayIso)
  const tomorrowDdMm = formatDatePt(tomorrowIso)
  const dateContext = `DATA E HORA (use APENAS estas; NUNCA invente dia, mÃªs ou ano): Hoje Ã© ${todayDdMm} (${todayIso}, ${DAY_NAMES[getWeekdayKey(todayIso)] || "?"}). AmanhÃ£ Ã© ${tomorrowDdMm} (${tomorrowIso}, ${DAY_NAMES[getWeekdayKey(tomorrowIso)] || "?"}). Ao dizer "amanhÃ£" use sempre a data ${tomorrowDdMm}.`
  const nowAvailabilityContext = getNowAndTodayAvailabilityContext(config)
  const holidaysContext = await getHolidaysContextForPrompt(config, todayIso, tomorrowIso)

  const systemPrompt = `VocÃª Ã© a assistente virtual do negÃ³cio. O cliente estÃ¡ falando com vocÃª pelo chat.
${finalizedHint}${styleHint}${dateContext}

${nowAvailabilityContext}

${holidaysContext}

DOSSIE DO AGENTE E DO NEGOCIO (use quando relevante para responder):
${businessContext}

REGRAS:
- Ao cumprimentar (oi, ola, bom dia), apresente-se como assistente da empresa e cite o nome do negocio quando disponivel.
- Se o cliente perguntar identidade (ex: "quem estou falando?" ou "quem e voce?"), responda claramente que voce e a assistente virtual da empresa.
- Responda de forma natural e humana, como se estivesse numa conversa real.
- CONSULTE O DOSSIE ACIMA: use apenas as informacoes consolidadas. Nunca invente servicos, areas, publicos ou ofertas.
- ENDEREÃ‡O/LOCALIZAÃ‡ÃƒO: Se o cliente perguntar onde ficam, endereÃ§o ou localizaÃ§Ã£o, use APENAS o endereÃ§o do DOSSIE. NUNCA invente rua, nÃºmero ou endereÃ§o; se nÃ£o houver no dossiÃª, diga que nÃ£o tem o endereÃ§o cadastrado.
- TRIAGEM NATURAL: se o pedido estiver fora do escopo, fora do publico atendido ou bater em restricao operacional, reconheca a necessidade, explique o limite com naturalidade e redirecione para o que o negocio realmente faz.
- PREÃ‡OS: Se um serviÃ§o tem valor em "R$ X" nos dados, o cliente estÃ¡ perguntando o preÃ§o e vocÃª DEVE informar esse valor. NUNCA diga "nÃ£o tenho os valores" se o preÃ§o estÃ¡ nos dados. Use o nome exato do serviÃ§o do config ao informar.
- HORÃRIO PARA UM DIA ESPECÃFICO: Se o cliente perguntar se tem horÃ¡rio/disponibilidade para um dia (ex.: "tem horÃ¡rio para amanhÃ£?", "atendem amanhÃ£?", "tem vaga hoje?"), use os dados de "HorÃ¡rio" e dias de atendimento acima E o bloco "AGORA / Expediente de hoje" acima. Se o expediente de hoje JÃ ENCERROU, NÃƒO diga que hÃ¡ horÃ¡rios para hoje; diga que jÃ¡ encerrou e sugira amanhÃ£ ou outro dia. Se esse dia estÃ¡ entre os dias que atendemos e (para hoje) ainda estamos em expediente, diga que sim e repita o horÃ¡rio; se esse dia NÃƒO estÃ¡ (ex.: amanhÃ£ Ã© sÃ¡bado e sÃ³ atendemos segunda a sexta), diga claramente e sugira outro dia.
- Se o cliente JÃ disse que quer agendar para AMANHÃƒ (ou para outro dia), NÃƒO repita que "o expediente de hoje encerrou"; vÃ¡ direto ao ponto (confirmar horÃ¡rio, serviÃ§o, etc.). Repetir que hoje encerrou sÃ³ quando ele ainda estiver falando de hoje.
- NUNCA invente data, dia ou mÃªs. Use somente as datas do bloco "DATA E HORA" acima (hoje e amanhÃ£ com dia/mÃªs/ano corretos).
- Seja objetiva e prestativa.
- Se nÃ£o tiver a informaÃ§Ã£o que ele pediu, diga com naturalidade.
- Mantenha o tom profissional mas cordial.
- Diretriz de atendimento e booking: ${agentRuntimeContext.booking_context}
- Diretriz de triagem: ${agentRuntimeContext.triage_context}
- IMPORTANTE: Tenha atitude e conduza o cliente. ApÃ³s responder qualquer pergunta informativa (endereÃ§o, serviÃ§os, horÃ¡rios etc.), SEMPRE adicione uma pergunta ou convite para engajar: ex. "Quer agendar um horÃ¡rio conosco?", "Precisa de ajuda em alguma dessas Ã¡reas?", "Posso te ajudar a marcar uma consulta?". O objetivo Ã© converter o lead â€” seja simpÃ¡tico e proativo, puxando o assunto para o agendamento.`

  const userPrompt = `HistÃ³rico da conversa:
${historyText}

Cliente disse: "${message}"

Responda diretamente ao cliente (apenas o texto da resposta, sem prefixos):`

  return await requestOpenAIChat({
    apiKey,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 300,
    temperature: 0.5,
  })
}

export async function generateAdaptiveGreetingWithAI(
  config: SimulatorConfig,
  message: string,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string,
  runtimeContext?: {
    business_brain?: BusinessBrain
    agent_narrative?: AgentNarrative
    agent_runtime_context?: AgentRuntimeContext
  }
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const { businessBrain, agentRuntimeContext } = resolveNarrativeArtifacts({
    config,
    businessBrain: runtimeContext?.business_brain,
    agentNarrative: runtimeContext?.agent_narrative,
    agentRuntimeContext: runtimeContext?.agent_runtime_context,
  })
  const businessName = businessBrain.business_name || "a empresa"
  const primaryStaff = businessBrain.staff?.[0]?.name
  const assistantLabel = primaryStaff?.trim() || "assistente virtual"
  const contactName = senderDisplayName?.trim() || null
  const historyText =
    history.length > 0
      ? history
          .slice(-4)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem historico)"

  const systemPrompt = `Voce escreve a PRIMEIRA resposta de atendimento via WhatsApp.
Negocio: ${businessName}
Quem atende: ${assistantLabel}
Contato do WhatsApp: ${contactName || "desconhecido"}
Contexto do agente:
${agentRuntimeContext.identity_context}
${agentRuntimeContext.booking_context}

Regras:
- Responda em portugues do Brasil.
- Espelhe o TOM do cliente: informal com informal, formal com formal.
- Se houver saudacao ("oi", "e ai", "boa tarde", etc.), responda a saudacao naturalmente.
- Se o nome do contato estiver disponivel, USE esse nome na resposta.
- Identifique a empresa explicitamente quando o nome do negocio estiver disponivel.
- Apresente quem esta falando usando o nome de quem atende quando disponivel.
- Se o cliente sinalizar interesse em agendar, conduza suavemente para o agendamento.
- Se o cliente so cumprimentar ou puxar assunto, responda educadamente e abra espaco para ajudar.
- Nao invente promessas, horarios ou servicos fora do contexto.
- Responda em 1 ou 2 frases, no maximo 240 caracteres.`

  const userPrompt = `Historico recente:
${historyText}

Mensagem do cliente: "${message}"

Gere a resposta inicial do WhatsApp:`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 140,
        temperature: 0.7,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const normalizedContent = normalizeText(content)
    const normalizedContact = normalizeText(contactName || "")
    const normalizedBusiness = normalizeText(config.business_name || "")
    const informalCustomer = /\b(opa|fala|salve|e ai|e ai\?|suave|tranquilo|man)\b/.test(normalizeText(message))
    let finalContent = content

    const hasContactName = Boolean(normalizedContact) && normalizedContent.includes(normalizedContact)
    const hasBusinessName =
      Boolean(normalizedBusiness) &&
      (normalizedContent.includes(normalizedBusiness) || normalizedContent.includes(`da ${normalizedBusiness}`))

    if (!hasContactName || !hasBusinessName) {
      const greetingLead = informalCustomer ? "Opa" : "Ola"
      const contactPart = contactName ? ` ${contactName}` : ""
      const companyPart = config.business_name ? ` da ${config.business_name}` : ""
      const agentPart = primaryStaff?.trim() ? ` Aqui e ${primaryStaff?.trim()}${companyPart}.` : ` Aqui e a assistente${companyPart}.`
      const supportPart = /agend/.test(normalizeText(message))
        ? " Vou te ajudar com o agendamento."
        : " Estou a disposicao para ajudar no que precisar."
      finalContent = `${greetingLead}${contactPart}! Tudo bem por aqui, e voce?${agentPart}${supportPart}`
    }

    return finalContent
  } catch {
    return null
  }
}

export async function generateInformationalReplyWithAI(params: {
  config: SimulatorConfig
  message: string
  history?: Array<{ role: string; content: string }>
  action:
    | "reply_identity"
    | "reply_faq"
    | "reply_price"
    | "reply_service_detail"
    | "reply_service_list"
    | "reply_closing"
    | "reply_open_context"
  businessName?: string
  serviceNames?: string[]
  selectedServiceName?: string
  selectedServicePrice?: number
  selectedServiceDescription?: string
  faqAnswer?: string
  runtimeContext?: {
    business_brain?: BusinessBrain
    agent_narrative?: AgentNarrative
    agent_runtime_context?: AgentRuntimeContext
  }
}): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const { businessBrain, agentRuntimeContext, businessContext } = resolveNarrativeArtifacts({
    config: params.config,
    businessBrain: params.runtimeContext?.business_brain,
    agentNarrative: params.runtimeContext?.agent_narrative,
    agentRuntimeContext: params.runtimeContext?.agent_runtime_context,
  })

  const nowAvailabilityContext = getNowAndTodayAvailabilityContext(params.config)
  const now = new Date()
  const todayIso = getTodayIsoBusinessTz(now)
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)
  const holidaysContext = await getHolidaysContextForPrompt(params.config, todayIso, tomorrowIso)

  const historyText =
    (params.history || []).length > 0
      ? (params.history || [])
          .slice(-8)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histÃ³rico)"

  const businessName = params.businessName || businessBrain.business_name || "o negÃ³cio"
  const serviceNames = Array.isArray(params.serviceNames) ? params.serviceNames.filter(Boolean) : []
  const serviceListText = serviceNames.length > 0 ? serviceNames.join(", ") : "(nenhum serviÃ§o configurado)"
  const actionGuidance: Record<string, string> = {
    reply_identity:
      "Explique quem estÃ¡ falando de forma cordial, situada no negÃ³cio, e ofereÃ§a ajuda de forma natural. NÃ£o soe como mensagem institucional dura.",
    reply_faq:
      "Responda diretamente a dÃºvida do cliente com base na resposta disponÃ­vel. Depois ofereÃ§a continuidade com naturalidade, sem parecer script.",
    reply_price:
      "Responda primeiro e claramente o preÃ§o do serviÃ§o perguntado. Se houver nome e preÃ§o, diga isso de forma cordial e natural. Depois ofereÃ§a ajuda para agendar, sem repetir pergunta desnecessÃ¡ria.",
    reply_service_detail:
      "Explique o serviÃ§o citado com linguagem humana e natural. Depois ofereÃ§a continuidade para agendamento, sem soar robÃ³tico.",
    reply_service_list:
      "Apresente os serviÃ§os do negÃ³cio de forma conversacional, como recepÃ§Ã£o real. NÃ£o use tom burocrÃ¡tico nem uma enumeraÃ§Ã£o fria se nÃ£o for necessÃ¡rio.",
    reply_closing:
      "Encerre a conversa com educaÃ§Ã£o, naturalidade e abertura cordial para retorno futuro.",
  }

  const systemPrompt = `VocÃª Ã© a assistente virtual de ${businessName}.

${nowAvailabilityContext}

${holidaysContext}

DOSSIE DO NEGÃ“CIO:
${businessContext}

REGRAS:
- Responda em portuguÃªs do Brasil.
- Soe como alguÃ©m do negÃ³cio atendendo o cliente de verdade.
- Seja cordial, contextual e natural. NÃ£o escreva como fluxo tÃ©cnico.
- Use o contexto do negÃ³cio jÃ¡ conhecido; nÃ£o peÃ§a de novo algo que o cliente acabou de dizer.
- NÃ£o transforme uma pergunta objetiva em triagem desnecessÃ¡ria.
- Se o cliente jÃ¡ citou um serviÃ§o especÃ­fico, use essa informaÃ§Ã£o.
- Se houver preÃ§o configurado para o serviÃ§o citado, informe o valor diretamente.
- ENDEREÃ‡O/LOCALIZAÃ‡ÃƒO: Se perguntarem onde ficam, endereÃ§o ou localizaÃ§Ã£o, use APENAS o endereÃ§o do DOSSIE. NUNCA invente rua, nÃºmero ou endereÃ§o; se nÃ£o houver no dossiÃª, diga que nÃ£o tem o endereÃ§o cadastrado.
- Depois da resposta principal, vocÃª pode conduzir com suavidade para o prÃ³ximo passo, mas sem soar insistente nem genÃ©rico.
- Diretriz de atendimento: ${agentRuntimeContext.booking_context}
- Diretriz de triagem: ${agentRuntimeContext.triage_context}

OBJETIVO DESTA RESPOSTA:
${actionGuidance[params.action]}`

  const userPrompt = `HistÃ³rico recente:
${historyText}

Mensagem atual do cliente:
"${params.message}"

Contexto estrutural do turno:
- action: ${params.action}
- business_name: ${businessName}
- selected_service_name: ${params.selectedServiceName || ""}
- selected_service_price: ${typeof params.selectedServicePrice === "number" ? `R$ ${params.selectedServicePrice}` : ""}
- selected_service_description: ${params.selectedServiceDescription || ""}
- faq_answer: ${params.faqAnswer || ""}
- service_list: ${serviceListText}

Responda apenas com a mensagem final ao cliente.`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 180,
        temperature: 0.7,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    return content || null
  } catch {
    return null
  }
}

export async function generateBookingReplyWithAI(params: {
  config: SimulatorConfig
  message: string
  history?: Array<{ role: string; content: string }>
  action:
    | "ask_audience_confirmation"
    | "ask_attendee_name"
    | "ask_service"
    | "offer_sequence_template"
    | "ask_date"
    | "ask_time"
    | "ask_contact"
    | "confirm_booking"
    | "offer_calendar"
  attendeeName?: string
  serviceNames?: string[]
  dateIso?: string
  time?: string
  runtimeContext?: {
    business_brain?: BusinessBrain
    agent_narrative?: AgentNarrative
    agent_runtime_context?: AgentRuntimeContext
  }
}): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const { businessBrain, agentRuntimeContext, businessContext } = resolveNarrativeArtifacts({
    config: params.config,
    businessBrain: params.runtimeContext?.business_brain,
    agentNarrative: params.runtimeContext?.agent_narrative,
    agentRuntimeContext: params.runtimeContext?.agent_runtime_context,
  })

  const nowAvailabilityContext = getNowAndTodayAvailabilityContext(params.config)

  const historyText =
    (params.history || []).length > 0
      ? (params.history || [])
          .slice(-10)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histÃ³rico)"

  const businessName = businessBrain.business_name || "o negÃ³cio"
  const now = new Date()
  const todayIso = getTodayIsoBusinessTz(now)
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)
  const todayDdMm = formatDatePt(todayIso)
  const tomorrowDdMm = formatDatePt(tomorrowIso)
  const bookingDateContext = `DATA: Hoje Ã© ${todayDdMm}. AmanhÃ£ Ã© ${tomorrowDdMm}. Use APENAS estas datas; nunca invente dia ou mÃªs. Se o cliente disse amanhÃ£, amanhÃ£ Ã© ${tomorrowDdMm}.`
  const holidaysContext = await getHolidaysContextForPrompt(params.config, todayIso, tomorrowIso)

  const actionGuidance: Record<string, string> = {
    ask_audience_confirmation:
      "Confirme o encaixe no pÃºblico de forma natural (ex.: 'SÃ³ para confirmar: atendemos [pÃºblico]. VocÃªs se encaixam?'). NUNCA pergunte idade (ex.: 'tem mais de 6 anos?') nem peÃ§a que o cliente se classifique por idade.",
    ask_attendee_name:
      "PeÃ§a o nome da pessoa de forma humana e situada no atendimento. Se parecer single booking, nÃ£o sugira mÃºltiplos atendidos Ã  toa.",
    ask_service:
      "Conduza a escolha do serviÃ§o de forma natural, sem soar formulÃ¡rio. Se jÃ¡ houver contexto suficiente, reconheÃ§a isso.",
    offer_sequence_template:
      "OfereÃ§a a continuaÃ§Ã£o do prÃ³ximo atendimento de forma natural e acolhedora.",
    ask_date:
      "PeÃ§a data ou preferÃªncia de dia/turno de forma fluida, como recepÃ§Ã£o real. Consulte o bloco AGORA/Expediente: se hoje jÃ¡ encerrou, nÃ£o ofereÃ§a hoje; sugira amanhÃ£ ou outro dia.",
    ask_time:
      "PeÃ§a o horÃ¡rio ou preferÃªncia de horÃ¡rio de forma natural. Consulte o bloco AGORA/Expediente: se o cliente pediu horÃ¡rio para hoje e o expediente de hoje jÃ¡ encerrou, NÃƒO diga que tem horÃ¡rios; diga que jÃ¡ encerramos e sugira amanhÃ£ ou outro dia.",
    ask_contact:
      "PeÃ§a o contato necessÃ¡rio de forma leve e contextual, explicando isso com naturalidade quando fizer sentido.",
    confirm_booking:
      "Confirme o que foi entendido do agendamento de forma clara, cordial e humana, preparando a confirmaÃ§Ã£o final.",
    offer_calendar:
      "OfereÃ§a adicionar ao calendÃ¡rio de forma simples e natural, sem linguagem tÃ©cnica.",
  }

  const systemPrompt = `VocÃª Ã© a assistente virtual de ${businessName}.

${bookingDateContext}

${nowAvailabilityContext}

${holidaysContext}

DOSSIE DO NEGÃ“CIO:
${businessContext}

REGRAS:
- Responda em portuguÃªs do Brasil.
- Soe como recepÃ§Ã£o real do estabelecimento.
- Seja cordial, natural e contextual.
- NÃ£o escreva como um fluxo tÃ©cnico ou formulÃ¡rio.
- Use o que jÃ¡ foi dito na conversa; nÃ£o repita pergunta desnecessÃ¡ria.
- Se existir nome, serviÃ§o, data ou horÃ¡rio no contexto, use isso naturalmente.
- Se o cliente JÃ disse que quer amanhÃ£ (ou outro dia), NÃƒO repita que "o expediente de hoje encerrou"; vÃ¡ direto ao ponto.
- NUNCA invente data ou mÃªs; use sÃ³ as datas do bloco DATA acima.
- Se a data que o cliente quer for feriado e nÃ³s nÃ£o atendemos nesse feriado, diga com naturalidade e sugira outro dia (use o bloco Feriados acima).
- INTERRUPÃ‡ÃƒO NO MEIO DO AGENDAMENTO: Se a mensagem atual do cliente for uma pergunta informativa (ex.: "Onde vocÃªs ficam?", "Qual o horÃ¡rio?", "Quanto custa o X?", "Tem estacionamento?"), responda Ã  pergunta usando o dossiÃª e, na MESMA mensagem, retome o fluxo: recapitule em uma frase o que jÃ¡ temos (nome, serviÃ§o, data, horÃ¡rio, etc.) e peÃ§a o prÃ³ximo dado que falta (ex.: contato). Uma Ãºnica mensagem: resposta Ã  dÃºvida + recap + pergunta do prÃ³ximo slot.
- Diretriz de atendimento: ${agentRuntimeContext.booking_context}
- Diretriz de triagem: ${agentRuntimeContext.triage_context}

OBJETIVO DESTA RESPOSTA:
${actionGuidance[params.action]}`

  const userPrompt = `HistÃ³rico recente:
${historyText}

Mensagem atual do cliente:
"${params.message}"

Contexto estrutural do turno:
- action: ${params.action}
- attendee_name: ${params.attendeeName || ""}
- service_names: ${(params.serviceNames || []).join(", ")}
- date: ${params.dateIso || ""}
- time: ${params.time || ""}

Responda apenas com a mensagem final ao cliente.`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 180,
        temperature: 0.7,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    return content || null
  } catch {
    return null
  }
}

export async function interpretFlowWithAI(
  message: string,
  history: Array<{ role: string; content: string }>,
  state: SimulatorState,
  config: SimulatorConfig,
  semanticContext?: SemanticContinuationContext
): Promise<FlowOrchestratorOutput | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  const { businessBrain, agentRuntimeContext } = resolveNarrativeArtifacts({ config })
  const servicesList = resolveServiceNames({ config, businessBrain })
  const businessType = resolveBusinessType({ config, businessBrain })
  const servicesJson = servicesList.length ? JSON.stringify(servicesList) : "[]"

  const historyText =
    history.length > 0
      ? history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histÃ³rico)"

  const systemPrompt = `VocÃª Ã© um orquestrador de fluxo para assistente virtual de negÃ³cios.
O negÃ³cio pode ser de QUALQUER ramo (barbearia, advocacia, manicure, personal organizer, etc.) - NUNCA assuma ramo especÃ­fico.
VocÃª recebe a config do negÃ³cio (tipo, serviÃ§os) e deve mapear a intenÃ§Ã£o do cliente aos fluxos disponÃ­veis.

Fluxos disponÃ­veis:
1. answer_price - Cliente quer saber preÃ§o/valor. DEVE responder o preÃ§o ANTES de qualquer outra aÃ§Ã£o.
2. list_services - Cliente quer saber o que oferecemos.
3. start_booking - Cliente quer agendar/marcar.
4. service_detail - Cliente quer detalhes de um serviÃ§o especÃ­fico.
5. ask_clarification - Mensagem ambÃ­gua; sugerir pergunta de clarificaÃ§Ã£o.
6. no_match_fallback - NÃ£o conseguiu mapear a mensagem a nenhum fluxo. Use quando nÃ£o houver encaixe.

REGRAS:
- Se o cliente PERGUNTOU preÃ§o (quanto custa, valor, etc.), retorne suggested_action: "answer_price". NUNCA pule para start_booking.
- Se o cliente fez pergunta DIRETA sobre serviÃ§o que nÃ£o oferecemos (ex: "nÃ£o tem X?", "tem Y?") NUNCA retorne ask_clarification com "nÃ£o ficou claro". Use no_match_fallback ou considere que a intenÃ§Ã£o Ã© saber se oferecemos - a resposta deve explicar o que oferecemos.
- PEDIDO GENÃ‰RICO vs ESPECÃFICO (muito importante):
  * Se o cliente expressou vontade de forma GENÃ‰RICA (ex: "quero um atendimento", "preciso de um serviÃ§o", "quero agendar algo") sem citar o nome exato de um serviÃ§o da lista, retorne suggested_action: "list_services" e NÃƒO preencha inferred_service. O sistema vai mostrar todas as opÃ§Ãµes para o cliente ESCOLHER.
  * SÃ³ retorne suggested_action: "start_booking" com inferred_service quando o cliente tiver mencionado um serviÃ§o ESPECÃFICO da lista. NUNCA assuma um serviÃ§o especÃ­fico sÃ³ porque o cliente usou termo genÃ©rico da Ã¡rea.
- inferred_service: use apenas quando a mensagem citar claramente um serviÃ§o da lista (nome exato ou variaÃ§Ã£o direta). Para pedidos genÃ©ricos (categoria/tema sem escolha explÃ­cita), retorne list_services sem inferred_service.
- Se o histÃ³rico indica que o cliente perguntou sobre X antes e agora pede Y para outra(s) pessoa(s), considere inferred_attendees: "other_person" ou "multiple".
- Se nÃ£o conseguir mapear, retorne suggested_action: "no_match_fallback".
- MENSAGENS VAGAS OU INCOMPLETAS: Se a mensagem for muito curta, incompleta ou nÃ£o transmitir intenÃ§Ã£o clara (ex: letra solta, "a", "o", "kk", fragmento), retorne suggested_action: "ask_clarification" com clarification_question amigÃ¡vel como "NÃ£o entendi, pode repetir? Como posso ajudar?" â€” NUNCA assuma serviÃ§o ou intenÃ§Ã£o em mensagens ambÃ­guas.
- Contexto de triagem do negocio: ${agentRuntimeContext.triage_context}
- Retorne APENAS JSON vÃ¡lido.`

  const style = resolveInteractionStyle({ config, businessBrain })
  const styleNote =
    style === "conversational"
      ? " Estilo: CONVERSA NATURAL â€” priorize interpretar intenÃ§Ã£o em texto livre; retorne start_booking quando o cliente manifestar vontade de agendar/marcar em QUALQUER redaÃ§Ã£o (nÃ£o exija palavras como 'agendar' ou 'marcar')."
      : style === "hybrid"
        ? " Estilo: MISTO â€” interpre contexto; em dÃºvida, aceite formas naturais de pedir agendamento como start_booking."
        : " Estilo: OPÃ‡Ã•ES NUMERADAS â€” cliente pode responder por nÃºmero em alguns momentos."

  const continuationPrompt = buildSemanticContinuationPrompt(semanticContext, [
    'Se continuation_kind = "price_followup", priorize "answer_price" em vez de "start_booking".',
    'Se continuation_kind = "audience_confirmation", nao volte para um fluxo generico.',
  ])

  const userPrompt = `Mensagem atual do cliente: "${message}"

HistÃ³rico recente:
${historyText}

Config do negÃ³cio:
- Tipo: ${businessType}
- ServiÃ§os oferecidos: ${servicesJson}
- Radar do negocio: ${agentRuntimeContext.service_context}
- Publico e elegibilidade: ${agentRuntimeContext.audience_context}
-${styleNote}
${continuationPrompt}

Retorne JSON com: intent, inferred_service (o que o cliente pediu ou nome exato da lista se houver match), inferred_attendees (single|multiple|other_person ou null), suggested_action, clarification_question (string ou null), confidence (0-1).`

  try {
    const content = await requestOpenAIChat({
      apiKey,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 200,
      temperature: 0.2,
      response_format: { type: "json_object" },
    })
    if (!content) return null
    const parsed = JSON.parse(content)
    const action = parsed.suggested_action
    const validActions = ["answer_price", "start_booking", "list_services", "ask_clarification", "no_match_fallback", "service_detail"]
    if (!validActions.includes(action)) return null
    const inferredService =
      parsed.inferred_service && typeof parsed.inferred_service === "string"
        ? servicesList.find((s) => normalizeText(s) === normalizeText(parsed.inferred_service)) || parsed.inferred_service
        : undefined
    return {
      intent: parsed.intent || "no_match",
      inferred_service: inferredService,
      inferred_attendees: ["single", "multiple", "other_person"].includes(parsed.inferred_attendees) ? parsed.inferred_attendees : undefined,
      suggested_action: action,
      clarification_question: typeof parsed.clarification_question === "string" ? parsed.clarification_question : undefined,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    }
  } catch {
    return null
  }
}

/** ExtraÃ§Ã£o de slots a partir de mensagem livre. Usa IA para interpretar contexto. */
export type SlotsInterpretation = {
  /** Nome da pessoa que receberÃ¡ o agendamento. NÃƒO incluir termos de parentesco. */
  attendee_name?: string | null
  /** Cliente citou apenas parentesco sem nome (ex: "meu filho") â€” perguntar o nome. */
  relationship_only?: boolean
  /** Parentesco citado (ex: "filho", "marido") para contexto. */
  relationship?: string | null
  /** ServiÃ§o da lista que corresponde ao pedido. */
  service?: string | null
  /** Data em ISO (YYYY-MM-DD) ou dia da semana. */
  date?: string | null
  /** HorÃ¡rio no formato HH:MM. */
  time?: string | null
  /** Cliente quer saber se hÃ¡ horÃ¡rio disponÃ­vel â€” consultar agenda antes de responder. */
  needs_availability_check?: boolean
}

export type SemanticTurnAIInterpretation = {
  flow: FlowOrchestratorOutput | null
  booking_request: BookingRequestInterpretation | null
  slots: SlotsInterpretation | null
}

function normalizeSemanticTurnInterpretation(
  parsed: Record<string, unknown>,
  servicesList: string[],
  message?: string
): SemanticTurnAIInterpretation {
  const validActions = ["answer_price", "start_booking", "list_services", "ask_clarification", "no_match_fallback", "service_detail"]
  const action =
    typeof parsed.suggested_action === "string" && validActions.includes(parsed.suggested_action)
      ? parsed.suggested_action
      : "no_match_fallback"
  const inferredService =
    typeof parsed.inferred_service === "string" && parsed.inferred_service.trim()
      ? servicesList.find((s) => normalizeText(s) === normalizeText(parsed.inferred_service as string)) || String(parsed.inferred_service).trim()
      : undefined
  const flow: FlowOrchestratorOutput = {
    intent: typeof parsed.intent === "string" ? parsed.intent as any : "no_match",
    inferred_service: inferredService,
    inferred_attendees:
      typeof parsed.inferred_attendees === "string" &&
      ["single", "multiple", "other_person"].includes(parsed.inferred_attendees)
        ? parsed.inferred_attendees as "single" | "multiple" | "other_person"
        : undefined,
    suggested_action: action as FlowOrchestratorOutput["suggested_action"],
    clarification_question:
      typeof parsed.clarification_question === "string" ? parsed.clarification_question : undefined,
    confidence:
      typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
  }

  const attendeeNames = Array.isArray(parsed.attendee_names)
    ? parsed.attendee_names
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => String(value).trim())
    : []
  const matchedServices = Array.isArray(parsed.service_names)
    ? parsed.service_names
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => servicesList.find((svc) => normalizeText(svc) === normalizeText(String(value))) || String(value).trim())
    : inferredService ? [inferredService] : []
  const booking_request: BookingRequestInterpretation = {
    booking_intent: parsed.booking_intent === true,
    includes_self: parsed.includes_self === true,
    attendee_names: Array.from(new Set(attendeeNames)),
    additional_count:
      typeof parsed.additional_count === "number" && parsed.additional_count >= 0
        ? parsed.additional_count
        : attendeeNames.length > 1
          ? attendeeNames.length - 1
          : 0,
    for_whom:
      typeof parsed.for_whom === "string" && parsed.for_whom.trim()
        ? parsed.for_whom.trim()
        : null,
    service_names: Array.from(new Set(matchedServices.filter(Boolean))),
  }

  const normalizedRelationship =
    typeof parsed.relationship === "string" && parsed.relationship.trim()
      ? normalizeText(String(parsed.relationship).trim())
      : ""
  const shouldDiscardSelfRelationship =
    normalizedRelationship === "self" ||
    normalizedRelationship === "eu" ||
    normalizedRelationship === "mim" ||
    normalizedRelationship === "me" ||
    normalizedRelationship === "titular" ||
    normalizedRelationship === "cliente"
  const deterministicDate = message ? parseDateOrWeekday(message) : null
  const deterministicTime = message ? parseTime(message) : null

  const slots: SlotsInterpretation = {
    attendee_name:
      typeof parsed.attendee_name === "string" && parsed.attendee_name.trim()
        ? parsed.attendee_name.trim()
        : null,
    relationship_only: shouldDiscardSelfRelationship ? false : parsed.relationship_only === true,
    relationship:
      !shouldDiscardSelfRelationship && typeof parsed.relationship === "string" && parsed.relationship.trim()
        ? parsed.relationship.trim()
        : null,
    service:
      typeof parsed.service === "string" && parsed.service.trim()
        ? servicesList.find((s) => normalizeText(s) === normalizeText(parsed.service as string)) || String(parsed.service).trim()
        : null,
    date: deterministicDate || (typeof parsed.date === "string" ? parsed.date : null),
    time:
      deterministicTime ||
      (typeof parsed.time === "string" && parsed.time.trim()
        ? (String(parsed.time).includes(":")
          ? String(parsed.time)
          : `${String(parseInt(String(parsed.time), 10)).padStart(2, "0")}:00`)
        : null),
    needs_availability_check: parsed.needs_availability_check === true,
  }

  return {
    flow,
    booking_request,
    slots,
  }
}

export async function interpretSemanticTurnWithAI(
  message: string,
  context: {
    history?: Array<{ role: string; content: string }>
    state?: SimulatorState
    sender_display_name?: string
    waiting_for?: "attendee_name" | "service" | "date" | "time" | "contact"
    current_slots?: { attendee_name?: string; service?: string; date?: string; time?: string }
    services?: Array<{ name: string }>
    last_assistant_message?: string
    continuation?: SemanticContinuationContext
    business_brain?: BusinessBrain
    agent_narrative?: AgentNarrative
    agent_runtime_context?: AgentRuntimeContext
  },
  config: SimulatorConfig
): Promise<SemanticTurnAIInterpretation | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  const servicesList = (context.services || resolveConfiguredServicesFromConfig(config)).map((s) => s.name).filter(Boolean)
  const { agentRuntimeContext, businessContext } = resolveNarrativeArtifacts({
    config,
    businessBrain: context.business_brain,
    agentNarrative: context.agent_narrative,
    agentRuntimeContext: context.agent_runtime_context,
  })
  const servicesJson = servicesList.length ? JSON.stringify(servicesList) : "[]"
  const historyText =
    context.history && context.history.length > 0
      ? context.history
          .slice(-8)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem historico)"
  const continuationPrompt = buildSemanticContinuationPrompt(context.continuation, [
    'Se continuation_kind = "price_followup", isso sozinho nao significa booking_intent.',
  ])
  const slotsDesc = context.current_slots
    ? `Slots atuais: attendee=${context.current_slots.attendee_name || "-"}, service=${context.current_slots.service || "-"}, date=${context.current_slots.date || "-"}, time=${context.current_slots.time || "-"}`
    : "Slots atuais: attendee=-, service=-, date=-, time=-"
  const senderLine = context.sender_display_name?.trim()
    ? `Nome do remetente atual: "${context.sender_display_name.trim()}".`
    : "Nome do remetente atual: desconhecido."
  const todayIso = getTodayIsoBusinessTz()
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)
  const temporalReference = `Referencia temporal obrigatoria: hoje = ${todayIso}; amanha = ${tomorrowIso}. Se o cliente disser "hoje", use exatamente ${todayIso}. Se disser "amanha", use exatamente ${tomorrowIso}. Nunca invente ano/data fora dessa referencia.`

  const systemPrompt = `Voce interpreta um turno conversacional completo para um assistente virtual de negocios.
Retorne APENAS JSON valido.

Voce deve produzir uma leitura semantica unica do turno atual, cobrindo ao mesmo tempo:
- fluxo principal (price, booking, list_services, service_detail, clarification, fallback)
- pedido de booking (booking_intent, includes_self, attendee_names, additional_count, for_whom, service_names)
- slots estruturados (attendee_name, relationship_only, relationship, service, date, time, needs_availability_check)

Regras criticas:
- Se o cliente perguntou preco, priorize suggested_action = "answer_price".
- Se continuation_kind = "price_followup", trate a mensagem como continuidade da selecao do servico para responder preco. Isso sozinho nao significa booking_intent.
- Se continuation_kind = "audience_confirmation", trate a mensagem como continuidade de booking ja iniciado.
- Nao dependa de frases fixas; use historico, pergunta anterior e estado atual.
- Contexto identitario e operacional do negocio:
${businessContext}
- Diretriz de atendimento e booking: ${agentRuntimeContext.booking_context}
- Diretriz de multiagendamento: ${agentRuntimeContext.multi_booking_context}
- Diretriz de triagem: ${agentRuntimeContext.triage_context}
- Servicos validos: ${servicesJson}
- ${temporalReference}
- Quando houver servico citado, normalize para o nome mais proximo da lista.
- Quando a mensagem for vaga, use ask_clarification somente se nao houver continuidade suficiente no contexto.`

  const userPrompt = `Mensagem atual: "${message}"
Historico recente:
${historyText}

${senderLine}
${slotsDesc}
waiting_for: ${context.waiting_for || "attendee_name"}
${continuationPrompt}

Retorne JSON com os campos:
intent, inferred_service, inferred_attendees, suggested_action, clarification_question, confidence,
booking_intent, includes_self, attendee_names, additional_count, for_whom, service_names,
attendee_name, relationship_only, relationship, service, date, time, needs_availability_check.`

  try {
    const content = await requestOpenAIChat({
      apiKey,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.1,
      response_format: { type: "json_object" },
    })
    if (!content) return null
    return normalizeSemanticTurnInterpretation(JSON.parse(content), servicesList, message)
  } catch {
    return null
  }
}

/** ParÃ¢metros para a IA decidir a prÃ³xima aÃ§Ã£o de booking (sem ordem fixa). */
export interface GetBookingNextActionParams {
  message: string
  history?: Array<{ role: string; content: string }>
  /** Resumo dos slots atuais (estado + extraÃ§Ã£o deste turno). */
  slotsSummary: string
  hasAttendee: boolean
  hasService: boolean
  hasDate: boolean
  hasTime: boolean
  hasContact: boolean
  audienceRequiresConfirmation: boolean
  shouldOfferSequenceTemplate: boolean
  businessContext: string
  runtimeContext?: AgentRuntimeContext
  /** ServiÃ§os do estabelecimento (nome de cada um) para a IA conhecer o negÃ³cio. */
  servicesList?: string[]
}

const BOOKING_ACTIONS = [
  "ask_audience_confirmation",
  "ask_attendee_name",
  "ask_service",
  "offer_sequence_template",
  "ask_date",
  "ask_time",
  "ask_contact",
  "confirm_booking",
  "offer_calendar",
] as const

/**
 * IA decide a prÃ³xima aÃ§Ã£o de booking como atendente do estabelecimento.
 * Conhece o negÃ³cio (config do onboarding), preenche o que o cliente disse e pergunta o que ainda falta â€” sem ordem fixa.
 */
export async function getBookingNextActionFromAI(
  params: GetBookingNextActionParams
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const historyText =
    (params.history || []).length > 0
      ? (params.history || [])
          .slice(-8)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histÃ³rico)"

  const servicesLine =
    Array.isArray(params.servicesList) && params.servicesList.length > 0
      ? `ServiÃ§os oferecidos: ${params.servicesList.join(", ")}.`
      : ""

  const systemPrompt = `VocÃª Ã© o ATENDENTE do estabelecimento. VocÃª conhece o negÃ³cio pelas configuraÃ§Ãµes do onboarding e Ã© responsÃ¡vel por agendar o cliente.

Seu papel:
- Saber o que preencher: nome da pessoa, serviÃ§o, data, horÃ¡rio, contato para confirmaÃ§Ã£o.
- Preencher com o que o cliente jÃ¡ disse (nesta mensagem ou no histÃ³rico). O estado dos slots abaixo jÃ¡ reflete o que foi extraÃ­do; use-o como verdade.
- Perguntar apenas o que AINDA FALTA, na ordem que fizer sentido para a conversa â€” nÃ£o hÃ¡ ordem fixa. Pense como um humano preenchendo o agendamento na frente do computador: vocÃª pergunta o prÃ³ximo dado que falta, atÃ© ter tudo.
- Se o pÃºblico-alvo do estabelecimento exige confirmaÃ§Ã£o (audience_requires_confirmation = true), primeiro confirme que o cliente se encaixa (ask_audience_confirmation).
- Se hÃ¡ segundo agendamento e faz sentido oferecer mesmo dia/outro dia/prÃ³ximo horÃ¡rio, use offer_sequence_template.
- Quando todos os dados necessÃ¡rios estiverem preenchidos, retorne confirm_booking.

REGRAS:
- Decida UMA aÃ§Ã£o por vez: a que faz sentido AGORA dado o estado e a mensagem do cliente.
- NÃ£o invente ordem rÃ­gida: a aÃ§Ã£o Ã© a que um atendente humano faria neste momento (perguntar o que falta ou confirmar o agendamento).
- AÃ§Ãµes vÃ¡lidas (retorne exatamente uma): ${BOOKING_ACTIONS.join(", ")}

${servicesLine}

Contexto do negÃ³cio (vocÃª conhece o estabelecimento):
${params.businessContext}
${params.runtimeContext?.booking_context ? `\nDiretriz de booking: ${params.runtimeContext.booking_context}` : ""}`

  const userPrompt = `Estado atual do agendamento (o que jÃ¡ estÃ¡ preenchido):
${params.slotsSummary}
- has_attendee: ${params.hasAttendee}
- has_service: ${params.hasService}
- has_date: ${params.hasDate}
- has_time: ${params.hasTime}
- has_contact: ${params.hasContact}
- audience_requires_confirmation: ${params.audienceRequiresConfirmation}
- should_offer_sequence_template: ${params.shouldOfferSequenceTemplate}

Mensagem atual do cliente: "${params.message}"

HistÃ³rico recente:
${historyText}

Retorne APENAS um JSON: { "action": "<uma das aÃ§Ãµes vÃ¡lidas>" }`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 80,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const action = typeof parsed?.action === "string" ? parsed.action.trim() : null
    if (!action || !BOOKING_ACTIONS.includes(action as (typeof BOOKING_ACTIONS)[number])) return null
    return action
  } catch {
    return null
  }
}

export async function interpretSlotsFromMessageWithAI(
  message: string,
  context: {
    waiting_for?: "attendee_name" | "service" | "date" | "time" | "contact"
    current_slots?: { attendee_name?: string; service?: string; date?: string; time?: string }
    services?: Array<{ name: string }>
    history?: Array<{ role: string; content: string }>
    last_assistant_message?: string
    /** Nome do remetente (ex: pushName WhatsApp). Nunca usar como attendee_name. */
    sender_display_name?: string
    continuation?: SemanticContinuationContext
    business_brain?: BusinessBrain
    agent_narrative?: AgentNarrative
    agent_runtime_context?: AgentRuntimeContext
  },
  config: SimulatorConfig
): Promise<SlotsInterpretation | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const { businessBrain, agentRuntimeContext } = resolveNarrativeArtifacts({
    config,
    businessBrain: context.business_brain,
    agentNarrative: context.agent_narrative,
    agentRuntimeContext: context.agent_runtime_context,
  })
  const servicesList = resolveServiceNames({
    config,
    businessBrain,
    overrideServices: context.services,
  })
  const servicesJson = servicesList.length ? JSON.stringify(servicesList) : "[]"
  const historyText =
    context.history && context.history.length > 0
      ? context.history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histÃ³rico)"
  const lastAssistant = context.last_assistant_message || ""
  const waitingFor = context.waiting_for || "attendee_name"
  const interactionStyle = resolveInteractionStyle({ config, businessBrain })
  const slotsDesc = context.current_slots
    ? `Slots atuais: attendee=${context.current_slots.attendee_name || "-"}, service=${context.current_slots.service || "-"}, date=${context.current_slots.date || "-"}, time=${context.current_slots.time || "-"}`
    : ""
  const continuationPrompt = buildSemanticContinuationPrompt(context.continuation, [
    'Se continuation_kind = "price_followup" e a mensagem atual selecionar um servico exibido nas opcoes anteriores, extraia esse servico mesmo que o texto seja curto ou apenas uma variacao do nome.',
  ])
  const todayIso = getTodayIsoBusinessTz()
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)

  const senderNote =
    context.sender_display_name && context.sender_display_name.trim()
      ? `\nIDENTIDADE DO REMETENTE: A pessoa que ESCREVE pode ter o nome "${context.sender_display_name.trim()}".
- Use "${context.sender_display_name.trim()}" como attendee_name QUANDO a mensagem indica que ELA MESMA quer o serviÃ§o: "quero agendar meu corte", "pra mim", "para mim", "agendar para mim".
- NUNCA use "${context.sender_display_name.trim()}" como attendee_name QUANDO a mensagem indica agendamento PARA OUTRA PESSOA: "meu marido", "meu filho", "pro meu marido", "agenda para o meu filho", etc. Nestes casos, use relationship_only + relationship ou o nome da outra pessoa.`
      : ""

  const systemPrompt = `VocÃª extrai informaÃ§Ãµes estruturadas de mensagens livres do cliente em um fluxo de agendamento.
${senderNote}

REGRAS para attendee_name:
- attendee_name = a pessoa que VAI RECEBER o serviÃ§o (a persona do agendamento). Quem escreve pode estar agendando para si ou para outro (filho, marido, etc.).
- Use compreensÃ£o de linguagem natural: leia a frase no contexto da Ãºltima pergunta do assistente e identifique a persona (quem recebe o agendamento). Extraia o nome prÃ³prio dessa pessoa, independentemente de como o cliente se expressou â€” sÃ³ o nome, nome na frase, parentesco + nome, referÃªncia a si + nome, etc.
- Se a Ãºltima pergunta foi "De quem serÃ¡ o primeiro/prÃ³ximo agendamento?" ou "Qual o nome dele(a)?", a resposta do cliente pode ser imprevisÃ­vel. Sua tarefa Ã© interpretar o texto e extrair o nome da pessoa que receberÃ¡ o agendamento. NÃ£o espere formato fixo.
- relationship_only: true apenas quando o cliente menciona parentesco ou relaÃ§Ã£o (filho, marido, etc.) e NÃƒO informa o nome prÃ³prio. Se houver nome prÃ³prio na mensagem, extraia em attendee_name e relationship_only: false.
- Se o cliente indicar que Ã© para ele mesmo mas nÃ£o disser o nome, use sender_display_name se disponÃ­vel no contexto; caso contrÃ¡rio deixe attendee_name null e relationship_only conforme o caso.
- Nome = substantivo prÃ³prio da pessoa (nÃ£o cargo, nÃ£o profissÃ£o, nÃ£o sÃ³ "meu filho" sem nome). Se sÃ³ hÃ¡ relaÃ§Ã£o sem nome, relationship_only + relationship.

REGRAS para service, date, time:
- Extraia serviÃ§o apenas se corresponder Ã  lista: ${servicesJson}
- Datas: "hoje", "pra hoje", "para hoje" â†’ date: YYYY-MM-DD de hoje. "amanhÃ£", "pra amanhÃ£", "para amanhÃ£" â†’ date: YYYY-MM-DD de amanhÃ£. "segunda", "terÃ§a", etc. â†’ a prÃ³xima ocorrÃªncia.
- Referencia temporal obrigatoria: hoje = ${todayIso}; amanha = ${tomorrowIso}. Use exatamente essas datas quando o cliente disser "hoje" ou "amanha".
- HorÃ¡rios: "Ã s 14", "14h", "as 14" â†’ time: "14:00"
- "tem horÃ¡rio Ã s 14?" ou "tem disponibilidade Ã s 14?" â†’ needs_availability_check: true, time: "14:00"
- "quero agendar pra amanhÃ£", "pra hoje ainda tem vaga?" â†’ extraia a data (hoje/amanhÃ£) em YYYY-MM-DD.
${(interactionStyle === "conversational" || interactionStyle === "hybrid") ? " Estilo conversacional/hÃ­brido: o cliente pode indicar serviÃ§o, data e horÃ¡rio de qualquer forma; use o histÃ³rico e a mensagem para extrair, mesmo que seja indireto ou coloquial." : ""}
- Escopo de servicos e elegibilidade do negocio:
${agentRuntimeContext.service_context}
${agentRuntimeContext.audience_context}

${continuationPrompt}

Retorne APENAS JSON: attendee_name (string ou null), relationship_only (boolean), relationship (string ou null), service (string da lista ou null), date (YYYY-MM-DD ou null), time (HH:MM ou null), needs_availability_check (boolean).`

  const userPrompt = `Ãšltima pergunta do assistente: "${lastAssistant}"

${slotsDesc}

Mensagem atual do cliente: "${message}"

${historyText ? `HistÃ³rico:\n${historyText}` : ""}

Extraia as informaÃ§Ãµes. Retorne JSON.`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 150,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    let attendee =
      parsed.attendee_name != null && typeof parsed.attendee_name === "string" && parsed.attendee_name.trim()
        ? parsed.attendee_name.trim()
        : undefined
    let relOnly = parsed.relationship_only === true
    let rel = parsed.relationship && typeof parsed.relationship === "string" ? parsed.relationship.trim() : null

    // SÃ³ rejeitar attendee=remetente quando hÃ¡ evidÃªncia de que estÃ¡ agendando para OUTRA pessoa (marido, filho, etc.)
    const sender = context.sender_display_name?.trim()
    const schedulingForOther = relOnly || (rel && !/^(eu|mesm[ao]|mim)$/i.test(rel))
    if (attendee && sender && normalizeText(attendee) === normalizeText(sender) && schedulingForOther) {
      attendee = undefined
      relOnly = true
      rel = rel || "pessoa"
    }
    const svc =
      parsed.service && typeof parsed.service === "string"
        ? servicesList.find((s) => normalizeText(s) === normalizeText(parsed.service)) || parsed.service
        : context.continuation?.kind === "price_followup" && context.continuation?.matched_option
          ? servicesList.find((s) => normalizeText(s) === normalizeText(context.continuation?.matched_option || ""))
          : undefined
    const time =
      parsed.time && typeof parsed.time === "string"
        ? parsed.time.includes(":")
          ? parsed.time
          : `${String(parseInt(parsed.time, 10)).padStart(2, "0")}:00`
        : undefined
    return {
      attendee_name: attendee ?? null,
      relationship_only: relOnly,
      relationship: rel ?? null,
      service: svc ?? null,
      date: parsed.date && typeof parsed.date === "string" ? parsed.date : null,
      time: time ?? null,
      needs_availability_check: parsed.needs_availability_check === true,
    }
  } catch {
    return null
  }
}

/**
 * Extrai o nome do atendido quando o contexto Ã© "De quem serÃ¡ o primeiro/prÃ³ximo agendamento?".
 * A IA interpreta o texto livre e identifica a persona que receberÃ¡ o agendamento, sem depender de exemplos fixos.
 */
export async function extractAttendeeNameForMultiBooking(
  message: string,
  context: { lastAssistantMessage?: string }
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const trimmed = (message || "").trim()
  if (trimmed.length < 2 || trimmed.length > 300) return null

  const lastMsg = (context.lastAssistantMessage || "").trim()
  const prompt = `Contexto: o assistente perguntou quem serÃ¡ o primeiro ou o prÃ³ximo agendamento.

Resposta do cliente: "${trimmed}"
${lastMsg ? `Ãšltima pergunta do assistente: "${lastMsg}"` : ""}

Tarefa: a partir da resposta do cliente, identifique a pessoa que vai receber o agendamento (a persona do atendimento) e extraia apenas o nome prÃ³prio dessa pessoa. Use compreensÃ£o de linguagem natural: o cliente pode escrever sÃ³ o nome, uma frase com parentesco e nome, referÃªncia a si mesmo e nome, ou qualquer outra forma. Interprete o contexto e extraia o nome.

Se nÃ£o for possÃ­vel identificar um nome prÃ³prio (pessoa que recebe o serviÃ§o), retorne null.
Retorne APENAS um JSON: { "attendee_name": "Nome" } ou { "attendee_name": null }.`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "VocÃª Ã© um extrator de entidades. Dada a pergunta do assistente e a resposta do cliente, identifique a persona que receberÃ¡ o agendamento e extraia apenas o nome prÃ³prio. Interprete o texto; nÃ£o dependa de formato fixo. Retorne apenas JSON com attendee_name (string ou null)." },
          { role: "user", content: prompt },
        ],
        max_tokens: 60,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const name = parsed?.attendee_name
    if (name != null && typeof name === "string" && name.trim().length >= 2 && name.length <= 120) {
      return name.trim()
    }
    return null
  } catch {
    return null
  }
}

/**
 * Gera resposta fluida quando o cliente pergunta sobre disponibilidade.
 * Ex: cliente pergunta se tem horÃ¡rio Ã s 14 â†’ consulta agenda â†’ confirma e pergunta se pode confirmar.
 */
export async function generateAvailabilityResponseWithAI(
  config: SimulatorConfig,
  context: {
    attendee_name?: string
    requested_time: string
    date_iso: string
    is_available: boolean
    available_slots?: string[]
    service?: string
    /** Motivo real (ex.: pausa, fora do expediente). Quando informado, a IA DEVE usar esse motivo e nÃ£o inventar "intervalo entre atendimentos". */
    unavailable_reason?: string
    /** Quando o horÃ¡rio pedido estÃ¡ ocupado, sugira este prÃ³ximo horÃ¡rio livre no estilo: "As X jÃ¡ estÃ¡ preenchido, mas posso agendar as Y, que tal?" */
    suggested_next_slot?: string
  },
  history: Array<{ role: string; content: string }> = []
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  const fallbackUnavailable = `Infelizmente as ${context.requested_time} nao esta disponivel. Temos: ${(context.available_slots || []).slice(0, 6).join(", ")}. Qual prefere?`
  if (!apiKey) {
    return context.is_available
      ? `Claro! Temos horario as ${context.requested_time}. Posso confirmar?`
      : fallbackUnavailable
  }

  const historyText =
    history.length > 0
      ? history
          .slice(-4)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : ""
  const attendeePart = context.attendee_name ? ` para ${context.attendee_name}` : ""
  const servicePart = context.service ? ` (${context.service})` : ""

  const suggestNextPhrase =
    context.suggested_next_slot
      ? ` Se houver suggested_next_slot, use exatamente: "As [horario solicitado] ja esta preenchido, mas posso agendar as ${context.suggested_next_slot}, que tal?"`
      : ""
  const reasonInstruction =
    context.unavailable_reason?.trim()
      ? `MOTIVO REAL (use exatamente isso, nao invente "intervalo entre atendimentos"): ${context.unavailable_reason}. Sugira apenas horarios da lista Horarios livres.${suggestNextPhrase}`
      : "Informe que aquele horario nao esta livre e sugira alternativas da lista available_slots."

  const systemPrompt = `Voce gera mensagens curtas e naturais para atendimento via chat.
O cliente perguntou se ha horario disponivel. Voce ja consultou a agenda.

Se is_available=true: confirme que temos o horario e pergunte se pode confirmar o agendamento. Seja cordial.
Se is_available=false: ${reasonInstruction} Convide a escolher.

Mantenha 1-2 frases. Retorne apenas o texto, sem markdown.`

  const userPrompt = `Contexto:
- Cliente quer agendar${attendeePart}${servicePart}
- Horario solicitado: ${context.requested_time}
- Data: ${context.date_iso}
- Disponivel: ${context.is_available ? "sim" : "nao"}
${!context.is_available && context.available_slots?.length ? `- Horarios livres (sugira apenas estes): ${context.available_slots.slice(0, 10).join(", ")}` : ""}
${!context.is_available && context.unavailable_reason ? `- Motivo: ${context.unavailable_reason}` : ""}
${!context.is_available && context.suggested_next_slot ? `- Sugira este proximo horario: ${context.suggested_next_slot} (frase: "As [horario pedido] ja esta preenchido, mas posso agendar as ${context.suggested_next_slot}, que tal?")` : ""}
${historyText ? `\nHistorico:\n${historyText}` : ""}

Gere a resposta fluida:`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 150,
        temperature: 0.5,
      }),
    })
    if (!response.ok) throw new Error()
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (content) {
      // Blindagem: evitar "jÃ¡ temos" (soa como preencheu antes).
      // Queremos confirmaÃ§Ã£o direta: "Temos horÃ¡rio Ã s 14:00."
      if (context.is_available) {
        return content
          .replace(/\bj[aÃ¡]\s+temos\b/gi, "Temos")
          .replace(/\bj[aÃ¡]\s+temos\s+um\s+hor[aÃ¡]rio\s+dispon[iÃ­]vel\b/gi, "Temos horÃ¡rio disponÃ­vel")
          .replace(/^\s*(o?timo|Ã³timo)!\s*/i, "")
          .replace(/\btenho\s+um\s+hor[aÃ¡]rio\s+dispon[iÃ­]vel\b/gi, "Temos horÃ¡rio disponÃ­vel")
          .replace(/\btenho\s+hor[aÃ¡]rio\s+dispon[iÃ­]vel\b/gi, "Temos horÃ¡rio disponÃ­vel")
      }
      return content
    }
  } catch {
    // fallback
  }
  return context.is_available
    ? `Claro! Temos horario as ${context.requested_time}. Posso confirmar?`
    : `Infelizmente as ${context.requested_time} nao esta disponivel. Temos: ${(context.available_slots || []).slice(0, 6).join(", ")}. Qual prefere?`
}

/** Retorno da anÃ¡lise de agendamentos: Ãºnico vs mÃºltiplos e para quem. */
export type AdditionalBookingsInterpretation = {
  count?: number
  has_additional?: boolean
  /** Quando Ã© um ÃšNICO agendamento para outra pessoa (ex: "quero agendar para meu marido"). */
  for_whom?: string | null
}


export type BookingRequestInterpretation = {
  booking_intent?: boolean
  includes_self?: boolean
  attendee_names?: string[]
  additional_count?: number
  for_whom?: string | null
  service_names?: string[]
}
export async function interpretAdditionalBookingsWithAI(
  text: string,
  context?: { has_completed_booking?: boolean; history?: Array<{ role: string; content: string }> }
): Promise<AdditionalBookingsInterpretation | null> {
  const normalized = normalizeText(text || "")
  if (normalized) {
    const explicitMultiplePeople =
      /\b(pra|para|pro)\s+mim\s+e\s+(pro|pra|para)?\s*meu\s+(filho|irmao|irmÃ£o|marido|pai|primo|amigo)\b/.test(normalized) ||
      /\b(eu)\s+e\s+(meu|minha)\s+(filho|filha|irmao|irmÃ£o|irma|irmÃ£|marido|esposa|pai|mae|mÃ£e|primo|prima|amigo|amiga)\b/.test(normalized) ||
      /\bum\s+pra\s+mim\s+e\s+outro\b/.test(normalized) ||
      /\bdois\s+agendamentos\b/.test(normalized)
    if (explicitMultiplePeople) {
      return { has_additional: true, count: 1, for_whom: null }
    }
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return null

  const historyText =
    context?.history && context.history.length > 0
      ? context.history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : ""

  const systemPrompt =
    "Voce interpreta pedidos de agendamento em linguagem natural. " +
    "Use o historico da conversa quando fornecido: o cliente pode ter feito perguntas antes (endereco, horarios, precos) e SO AGORA expressar o pedido. " +
    "Retorne apenas JSON valido com os campos: count (numero de agendamentos adicionais, inteiro >=0), " +
    "has_additional (true/false) e for_whom (string ou null). Nao invente dados."
  const userPrompt =
    (historyText ? `Historico recente:\n${historyText}\n\n` : "") +
    `Mensagem atual: "${text}"\n` +
    `Contexto: ${context?.has_completed_booking ? "ja existe um agendamento finalizado" : "nao ha agendamento finalizado"}\n` +
    "REGRAS:\n" +
    "- VARIOS SERVICOS para a MESMA pessoa (ex: 'corte e barba', 'corte de cabelo e barba', 'quero os dois') = UM so agendamento. Retorne has_additional FALSE e count 0.\n" +
    "- Um UNICO agendamento PARA outra pessoa (ex.: 'quero agendar para meu marido', 'agendar para minha esposa', 'para [nome]') = UM sÃ³ agendamento. Retorne has_additional FALSE, count 0 e for_whom com a menÃ§Ã£o (parentesco ou nome).\n" +
    "- MÃºltiplos agendamentos: sÃ³ quando o cliente quer MAIS DE UMA PESSOA/horÃ¡rio (ex.: 'pra mim e pro meu filho', 'dois agendamentos', 'um pra mim e outro pra outra pessoa'). " +
    "Retorne has_additional true e count com a quantidade de PESSOAS adicionais.\n" +
    "- Se nao houver mencao a outra pessoa nem multiplos, retorne count 0, has_additional false e for_whom null."

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 80,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const count = typeof parsed.count === "number" ? parsed.count : null
    const hasAdditional = typeof parsed.has_additional === "boolean" ? parsed.has_additional : null
    const forWhom =
      parsed.for_whom === null || parsed.for_whom === undefined
        ? undefined
        : typeof parsed.for_whom === "string" && parsed.for_whom.trim()
          ? parsed.for_whom.trim()
          : undefined
    if (count === null && hasAdditional === null && forWhom === undefined) return null
    return {
      count: count ?? undefined,
      has_additional: hasAdditional ?? undefined,
      for_whom: forWhom ?? null,
    }
  } catch {
    return null
  }
}


export async function interpretBookingRequestWithAI(
  text: string,
  context: {
    history?: Array<{ role: string; content: string }>
    sender_display_name?: string
    continuation?: SemanticContinuationContext
    business_brain?: BusinessBrain
    agent_narrative?: AgentNarrative
    agent_runtime_context?: AgentRuntimeContext
  },
  config: SimulatorConfig
): Promise<BookingRequestInterpretation | null> {
  const normalized = normalizeText(text || "")
  const { businessBrain, agentRuntimeContext } = resolveNarrativeArtifacts({
    config,
    businessBrain: context.business_brain,
    agentNarrative: context.agent_narrative,
    agentRuntimeContext: context.agent_runtime_context,
  })
  const servicesList = resolveServiceNames({ config, businessBrain })
  const heuristicServices = findServicesFromText(text, businessBrain.services || [])
  const explicitCountMatch =
    normalized.match(/\bnos?\s+(\d+)\b/) ||
    normalized.match(/\b(\d+)\s+(pessoas|agendamentos|cortes?)\b/)
  const explicitTotal = explicitCountMatch ? Number(explicitCountMatch[1]) : null
  if (explicitTotal && explicitTotal >= 2) {
    return {
      booking_intent: true,
      includes_self: /\b(pra|para|pro)\s+mim\b|\beu\b|\bnos\b|\bn[o?]s\b/.test(normalized),
      attendee_names: [],
      additional_count: explicitTotal - 1,
      for_whom: null,
      service_names: heuristicServices,
    }
  }

  const openaiKey = getOpenAIApiKey()
  if (!openaiKey) {
    return heuristicServices.length > 0
      ? {
          booking_intent: true,
          includes_self: /\b(pra|para|pro)\s+mim\b|\beu\b/.test(normalized),
          attendee_names: [],
          additional_count: 0,
          for_whom: null,
          service_names: heuristicServices,
        }
      : null
  }

  const historyText =
    context.history && context.history.length > 0
      ? context.history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem historico)"
  const servicesJson = servicesList.length ? JSON.stringify(servicesList) : "[]"
  const senderLine = context.sender_display_name?.trim()
    ? `Nome do remetente atual: "${context.sender_display_name.trim()}".`
    : "Nome do remetente atual: desconhecido."
  const continuationPrompt = buildSemanticContinuationPrompt(context.continuation, [
    'Se continuation_kind = "price_followup", a mensagem atual pode ser apenas selecao do servico para responder preco, e isso sozinho NAO significa novo booking_intent.',
  ])

  const systemPrompt =
    "Voce extrai um pedido de agendamento em estrutura semantica. " +
    "Interprete linguagem natural, variacoes informais, nomes, parentescos e quantidade de pessoas. " +
    "Nao dependa de frases fixas. Retorne apenas JSON valido."

  const userPrompt =
    `Mensagem atual: "${text}"\n` +
    `Historico recente:\n${historyText}\n` +
    `${senderLine}\n` +
    `${continuationPrompt}\n` +
    `Servicos do negocio: ${servicesJson}\n` +
    `Conducao de multiagendamento: ${agentRuntimeContext.multi_booking_context}\n` +
    `Triagem e escopo: ${agentRuntimeContext.triage_context}\n\n` +
    "Retorne JSON com:\n" +
    '- booking_intent (boolean): true quando a mensagem quer marcar/agendar atendimento.\n' +
    '- includes_self (boolean): true quando a pessoa inclui a si mesma no pedido ("pra mim", "eu", "nos").\n' +
    '- attendee_names (array de strings): nomes proprios de pessoas citadas que vao receber atendimento. Nao inclua parentesco sem nome. Nao invente nome.\n' +
    '- additional_count (numero inteiro >= 0): quantidade de pessoas adicionais apos o primeiro agendamento.\n' +
    '- for_whom (string ou null): quando for um unico agendamento para outra pessoa sem multiagendamento claro.\n' +
    '- service_names (array de strings): servicos citados que existam na lista do negocio.\n\n' +
    "Regras criticas:\n" +
    '- "pra mim e meu irmao", "eu e meu amigo", "nos 3", "cabelo dos muleque Davi, Carlos, Joao" = booking_intent true e additional_count correto.\n' +
    '- Quando a mensagem citar 2 ou mais pessoas pelo nome, considere multiagendamento.\n' +
    '- "quero agendar um corte pro Gustavo" = booking_intent true, attendee_names ["Gustavo"], additional_count 0.\n' +
    '- "quero agendar pro Elisa e o Malaquias" = booking_intent true, attendee_names ["Elisa","Malaquias"], additional_count 1.\n' +
    '- Varios servicos para a mesma pessoa NAO significam multiagendamento.\n' +
    '- Se houver duvida entre uma ou varias pessoas, prefira refletir a mensagem literal do cliente.\n'

  try {
    const content = await requestOpenAIChat({
      apiKey: openaiKey,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 220,
      temperature: 0,
      response_format: { type: "json_object" },
    })
    if (!content) return null
    const parsed = JSON.parse(content)
    const attendeeNames = Array.isArray(parsed.attendee_names)
      ? parsed.attendee_names
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => value.trim())
      : []
    const matchedServices = Array.isArray(parsed.service_names)
      ? parsed.service_names
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => servicesList.find((svc) => normalizeText(svc) === normalizeText(value)) || value.trim())
      : heuristicServices
    const additionalCountRaw =
      typeof parsed.additional_count === "number" && parsed.additional_count >= 0
        ? parsed.additional_count
        : null
    return {
      booking_intent: parsed.booking_intent === true,
      includes_self: parsed.includes_self === true,
      attendee_names: Array.from(new Set(attendeeNames)),
      additional_count:
        additionalCountRaw ??
        (attendeeNames.length > 1 ? attendeeNames.length - 1 : 0),
      for_whom:
        typeof parsed.for_whom === "string" && parsed.for_whom.trim()
          ? parsed.for_whom.trim()
          : null,
      service_names: Array.from(new Set(matchedServices.filter(Boolean))),
    }
  } catch {
    return null
  }
}

/**
 * Extrai preferÃªncia de contato (celular, email ou ambos) a partir de texto livre.
 * Usa IA para entender respostas como "pode ser pelo meu celular", "telefone", "por email", etc.
 * Retorna "phone" | "email" | "both" | null.
 */
export async function extractContactPreferenceFromText(
  message: string,
  history: Array<{ role: string; content: string }> = []
): Promise<"phone" | "email" | "both" | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const historyText =
    history.length > 0
      ? history
          .slice(-4)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : ""

  const systemPrompt = `VocÃª extrai a preferÃªncia de contato do cliente. O assistente perguntou como prefere ser contatado para confirmar o agendamento (opÃ§Ãµes: sÃ³ celular/telefone, sÃ³ email, ou os dois).
O cliente respondeu em texto livre. Sua tarefa: identificar se ele quer ser contatado por CELULAR/TELEFONE, por EMAIL, ou pelos DOIS.
Retorne APENAS uma das palavras: phone, email, both. Se nÃ£o der para identificar, retorne: unknown.
Exemplos: "pode ser pelo meu celular" -> phone. "celular" -> phone. "telefone" -> phone. "por email" -> email. "no meu email" -> email. "os dois" -> both. "tanto faz" -> unknown.`

  const userPrompt = historyText
    ? `HistÃ³rico recente:\n${historyText}\n\nResposta atual do cliente: "${message}"\n\nPreferÃªncia (phone/email/both/unknown):`
    : `Resposta do cliente: "${message}"\n\nPreferÃªncia (phone/email/both/unknown):`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 20,
        temperature: 0.1,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = (data.choices?.[0]?.message?.content?.trim() || "").toLowerCase()
    if (content === "phone") return "phone"
    if (content === "email") return "email"
    if (content === "both") return "both"
    return null
  } catch {
    return null
  }
}




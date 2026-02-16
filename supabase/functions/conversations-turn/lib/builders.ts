// @ts-nocheck
import { pickVariant, formatDatePt, formatTimePeriod } from "./utils.ts"
import { buildStaffDayOptions } from "./staff.ts"
import type { SimulatorConfig } from "./types.ts"

function formatDaysListForMessage(days: string[]): string {
  const labels = buildStaffDayOptions(days)
  if (labels.length <= 1) return labels[0] || ""
  const last = labels.pop()
  return `${labels.join(", ")} e ${last}`
}

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "segundas",
  tuesday: "terças",
  wednesday: "quartas",
  thursday: "quintas",
  friday: "sextas",
  saturday: "sábados",
  sunday: "domingos",
}

/** Mensagem empática quando o cliente escolhe dia sem expediente (ex: fim de semana). */
export function buildDayNotServedMessage(
  requestedWeekday: string,
  allowedDays: string[],
  _schedule?: SimulatorConfig["schedule"]
): { message: string; action_options: string[] } {
  const daysLabel = formatDaysListForMessage(allowedDays)
  const requestedLabel = WEEKDAY_LABELS[requestedWeekday] || "nesse dia"
  const isWeekend = requestedWeekday === "saturday" || requestedWeekday === "sunday"
  const reason = isWeekend
    ? "Infelizmente nao atendemos nos finais de semana."
    : `Lamento! Mas nao temos atendimento nas ${requestedLabel}.`
  const message = `${reason} Quer agendar outro dia? Nossos dias sao ${daysLabel}.`
  const options = allowedDays.length > 0 ? buildStaffDayOptions(allowedDays) : ["Outro dia"]
  return { message, action_options: options }
}

/** Mensagem quando o cliente escolhe data bloqueada (feriado ou período de férias). */
export function buildDateBlockedMessage(reason: string): string {
  return `${reason} Gostaria de agendar em outro dia?`
}

export function getCordialPrefix(config: SimulatorConfig, isFirst: boolean): string {
  if (!isFirst) return ""
  const name = config.business_name ? ` da ${config.business_name}` : ""
  return `Oi! Sou a assistente${name}. Obrigado por entrar em contato. `
}

/** Mensagem clara quando não entendeu a mensagem do cliente (respeita tom, sem redundância). Sem artigo antes do nome da empresa. */
export function buildClarificationMessage(config: SimulatorConfig): string {
  const tone = config.tone || "profissional"
  const biz = config.business_name ? ` com ${config.business_name}` : ""
  const byTone: Record<string, string> = {
    formal: `Obrigado por entrar em contato${biz}. Não compreendi sua mensagem. Poderia repetir? Como podemos ajudá-lo?`,
    profissional: `Olá, não entendi sua mensagem. Pode repetir? Como posso ajudar?`,
    amigavel: "Oi! Não entendi, pode repetir? Como posso ajudar?",
    engracado: "Opa, não pegou! Pode repetir? Como posso ajudar?",
  }
  return byTone[tone] || byTone.profissional
}

/** Saudação inicial conforme o tom configurado (fluida, não robótica). */
export function getGreetingMessage(config: SimulatorConfig): string {
  const tone = config.tone || "profissional"
  const biz = config.business_name || "nossa empresa"
  const byTone: Record<string, string> = {
    amigavel: `Olá! Obrigado por entrar em contato, somos da ${biz}. Como posso ajudar?`,
    formal: `Olá. Agradecemos o contato. Somos da ${biz}. Como podemos ajudá-lo?`,
    profissional: `Olá, obrigado por entrar em contato. Somos da ${biz}. Como posso ajudar?`,
    engracado: `Oi! Que bom te ver por aqui, somos da ${biz}. Em que posso ajudar?`,
  }
  return byTone[tone] || byTone.profissional
}

/** Intro antes da lista de serviços quando o cliente expressou desejo genérico. */
export function buildListServicesIntro(config: SimulatorConfig): string {
  const tone = config.tone || "profissional"
  const byTone: Record<string, string> = {
    amigavel: "Certo! Será um prazer te receber no nosso estabelecimento, me conta, o que você quer fazer?",
    formal: "Com prazer. Será um prazer recebê-lo em nosso estabelecimento. O que deseja realizar?",
    profissional: "Claro! Será um prazer atendê-lo. O que você gostaria de fazer?",
    engracado: "Show! Vai ser um prazer te receber. O que você quer fazer?",
  }
  return byTone[tone] || byTone.profissional
}

/** Confirmação curta ao iniciar o agendamento (cliente já escolheu o serviço). */
export function buildBookingConfirmationIntro(config: SimulatorConfig): string {
  const tone = config.tone || "profissional"
  const byTone: Record<string, string> = {
    amigavel: "Beleza! Vamos agendar agora!",
    formal: "Perfeito. Vamos prosseguir com o agendamento.",
    profissional: "Ótimo! Vamos agendar.",
    engracado: "Bora! Vamos agendar.",
  }
  return byTone[tone] || byTone.profissional
}

export function buildPriceNotAvailableMessage(
  config: SimulatorConfig,
  _serviceName?: string | null
): { message: string; action_options?: string[] } {
  const mode = config.when_client_asks_price_no_value || "offer_handoff_or_booking"
  const tone = config.tone || "professional"
  const baseByTone: Record<string, string> = {
    formal: "No momento os valores não estão disponíveis neste canal. ",
    amigavel: "No momento os valores não estão disponíveis aqui. ",
    profissional: "Os valores não estão disponíveis neste canal no momento. ",
    engracado: "Por aqui os valores ainda não estão disponíveis. ",
  }
  const base = baseByTone[tone] || baseByTone.profissional
  if (mode === "handoff") {
    return {
      message: base + "Vou te colocar em contato com nossa equipe para te passar os valores e te atender melhor.",
    }
  }
  return {
    message: base + "Quer que eu avise a equipe para te passar os valores, ou prefere agendar uma visita?",
    action_options: ["Avise a equipe", "Quero agendar"],
  }
}

export function buildServicesListWithPrices(config: SimulatorConfig): string {
  const services = config.services || []
  if (services.length === 0) return "No momento não temos a lista de serviços cadastrada. Posso te ajudar com algo mais?"
  const lines = services.map((s, idx) => {
    const price = s.base_price != null ? ` — R$ ${Number(s.base_price).toFixed(2).replace(".", ",")}` : ""
    return `${idx + 1} - ${s.name}${price}`
  })
  return (
    "Confira a nossa lista de serviços e preços:\n\n" +
    lines.join("\n") +
    "\n\nGostaria de agendar um serviço, só escolher um número ou escrever o serviço desejado."
  )
}

/** Lista de serviços com intro opcional (quando o cliente expressou desejo genérico). Respeita o tom. */
export function buildListServicesMessage(
  config: SimulatorConfig,
  options?: { intro?: "default" | "after_generic" }
): string {
  const list = buildServicesListWithPrices(config)
  if (options?.intro === "after_generic") {
    return buildListServicesIntro(config) + "\n\n" + list
  }
  return list
}

export function buildGenericFallback(config: SimulatorConfig): string {
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  if (servicesList.length > 0) {
    const list = servicesList.join(", ")
    return `Não entendi exatamente o que deseja. Nós trabalhamos com: ${list}. Podemos te ajudar com algum dos nossos serviços?`
  }
  return "Não entendi exatamente o que deseja. Pode me contar com mais detalhes o que precisa?"
}

export function buildServiceOptions(services: Array<{ name: string }> = []): string[] {
  const opts = services.map((s) => s.name).filter(Boolean)
  opts.push("Quero agendar uma visita")
  return opts
}

export function buildServicePrompt(
  config: SimulatorConfig,
  seed: string,
  context?: { date?: string; time?: string; time_period?: "morning" | "afternoon" | "evening"; attendee_name?: string }
): { message: string; action_options: string[] } {
  const parts: string[] = []
  if (!context?.attendee_name) {
    const intro = pickVariant(seed, [
      "Em que eu posso te ajudar?",
      "Como posso te ajudar hoje?",
      "O que voce precisa hoje?",
    ])
    parts.push(intro)
  }
  if (context?.date) {
    parts.push(`Para ${formatDatePt(context.date)}.`)
  }
  if (context?.time) {
    parts.push(`No horario ${context.time}.`)
  } else if (context?.time_period) {
    parts.push(`No periodo ${formatTimePeriod(context.time_period)}.`)
  }
  if (context?.attendee_name) {
    parts.push(`Certo, qual servico voce quer agendar para ${context.attendee_name}?`)
  } else {
    const canSequence = config.allow_sequence_booking && (config.sequence_eligible_services?.length ?? 0) > 0
    parts.push(canSequence ? "Qual servico voce quer agendar? (Pode escolher mais de um, ex: banho e tosa)" : "Qual servico voce quer agendar?")
  }
  return {
    message: parts.join(" "),
    action_options: buildServiceOptions(config.services || []),
  }
}

export function buildMultiBookingIntro(): string {
  return "Ah que legal! Vai ser um prazer receber voces por aqui. Vamos fazer um agendamento por vez, tudo bem?"
}

export function buildAdditionalBookingAfterCompletePrompt(): string {
  return "Que otimo! Ficaremos felizes em receber voces. Qual o nome da pessoa que vamos agendar agora?"
}

export function buildSingleAdditionalPrompt(): string {
  return "Que otimo! Qual o nome da pessoa que vamos agendar agora?"
}

export function buildMultiBookingSummary(
  bookings: Array<{ attendee_name?: string; service?: string; date?: string; time?: string }>
): string {
  const lines = bookings
    .filter((b) => b?.attendee_name && b?.service && b?.date && b?.time)
    .map((b) => `${b.attendee_name} - ${formatDatePt(b.date || "")}, às ${b.time} - ${b.service}`)
  if (lines.length === 0) return "Otimo! Os agendamentos foram preparados."
  if (lines.length === 2) return `Otimo! Os dois estao agendados:\n${lines.join(" e \n")}.`
  return `Otimo! Agendamentos preparados:\n${lines.join(" e \n")}.`
}

export function buildFinalThanksMessage(
  businessName: string | undefined,
  bookings: Array<{ attendee_name?: string }>
): string {
  const names = bookings.map((b) => b.attendee_name).filter(Boolean) as string[]
  const unique = Array.from(new Set(names))
  const first = unique[0] || "vocês"
  const second = unique[1]
  const company = businessName ? `da ${businessName}` : "da nossa empresa"
  if (second) {
    return `Obrigado ${first} por agendar conosco ${company}, espero que você e o ${second} sejam bem atendidos! Faz um esforço para chegar uns 5 minutos mais cedo, ok? Até mais!`
  }
  return `Obrigado ${first} por agendar conosco ${company}! Faz um esforço para chegar uns 5 minutos mais cedo, ok? Até mais!`
}

export function buildRejectionMessage(
  inferredArea: string | undefined,
  config: SimulatorConfig,
  isFirst: boolean,
  hasContext: boolean = true
): string {
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  const hasServices = servicesList.length > 0

  if (inferredArea && inferredArea !== "indefinido") {
    const empathyPrefix = (isFirst && hasContext) ? "Obrigado pelo contato! " : ""
    if (hasServices) {
      const list = servicesList.join(", ")
      return `${empathyPrefix}Entendi, você precisa de ajuda com ${inferredArea}. Infelizmente não atendemos essa área. Trabalhamos com: ${list}. Posso te ajudar com alguma dessas áreas?`
    }
    return `${empathyPrefix}Entendi, você precisa de ajuda com ${inferredArea}. Infelizmente não atendemos essa área. Posso te ajudar com mais alguma coisa?`
  }

  const customMessage = config.lead_policy?.rejection_message
  if (customMessage && hasContext) {
    const empathyPrefix = isFirst ? "Obrigado pelo contato! " : ""
    return `${empathyPrefix}${customMessage}`
  }

  if (!hasContext) {
    return "Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor."
  }

  if (hasServices) {
    const list = servicesList.join(", ")
    const empathyPrefix = isFirst ? "Obrigado pelo contato! " : ""
    return `${empathyPrefix}Entendi. No momento não atendemos esse tipo de caso. Trabalhamos com: ${list}. Posso te ajudar com alguma dessas áreas?`
  }

  const empathyPrefix = isFirst ? "Obrigado pelo contato! " : ""
  return `${empathyPrefix}Entendi. No momento não atendemos esse tipo de caso. Se precisar de algo dentro das nossas áreas, fico à disposição.`
}

export async function generateRejectionMessageWithAI(
  inferredArea: string | undefined,
  config: SimulatorConfig,
  isFirst: boolean,
  hasContext: boolean
): Promise<string> {
  if (!hasContext) {
    return "Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor."
  }
  const customMessage = config.lead_policy?.rejection_message
  if (customMessage) {
    const empathyPrefix = isFirst ? "Obrigado pelo contato! " : ""
    return `${empathyPrefix}${customMessage}`
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return buildRejectionMessage(inferredArea, config, isFirst, hasContext)

  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  const businessType = config.business_type || "empresa"

  const systemPrompt =
    "Você gera mensagens curtas e naturais de atendimento via chat, em português brasileiro. " +
    "Use quando o cliente pediu qualquer serviço/área que NÃO está na lista de serviços oferecidos pelo negócio. " +
    "Diferencie: (1) negócio não atua na área; (2) atua na área mas não tem aquela variação (ex.: cliente pediu X, lista tem só A, B, C). " +
    "Seja natural, explique o que o negócio oferece e liste os serviços quando fizer sentido. Mantenha 1-3 frases. Retorne apenas o texto, sem markdown."

  const empathyHint = isFirst ? "Pode começar com 'Obrigado pelo contato! ' se fizer sentido. " : ""
  const userPrompt =
    `Cliente pediu: "${inferredArea || "algo que não oferecemos"}"\n` +
    `Tipo de negócio: ${businessType}\n` +
    `Serviços oferecidos: ${servicesList.length ? servicesList.join(", ") : "nenhum cadastrado"}\n` +
    `${empathyHint}IMPORTANTE: NUNCA mencione que não oferecemos algo que o cliente NÃO pediu. Ex: se o cliente pediu "corte para meu filho e marido" (ambos masculinos), NÃO diga "não temos corte feminino" - ele não pediu feminino. Liste apenas o que oferecemos.` +
    `\nGere uma mensagem educada que explique o que oferecemos e convide a escolher.`

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
        max_tokens: 150,
        temperature: 0.5,
      }),
    })
    if (!response.ok) return buildRejectionMessage(inferredArea, config, isFirst, hasContext)
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return buildRejectionMessage(inferredArea, config, isFirst, hasContext)
    return content
  } catch {
    return buildRejectionMessage(inferredArea, config, isFirst, hasContext)
  }
}

// @ts-nocheck
import { normalizeText } from "../utils.ts"
import type { AgentNarrative, BusinessBrain, BusinessBrainService } from "./types.ts"

const DAY_NAMES: Record<string, string> = {
  monday: "segunda",
  tuesday: "terça",
  wednesday: "quarta",
  thursday: "quinta",
  friday: "sexta",
  saturday: "sábado",
  sunday: "domingo",
}

function joinNatural(items: string[]): string {
  const filtered = items.filter(Boolean)
  if (filtered.length === 0) return ""
  if (filtered.length === 1) return filtered[0]
  if (filtered.length === 2) return `${filtered[0]} e ${filtered[1]}`
  return `${filtered.slice(0, -1).join(", ")} e ${filtered[filtered.length - 1]}`
}

function describeSchedule(brain: BusinessBrain): string {
  const schedule = brain.schedule
  if (!schedule?.days_of_week?.length || !schedule.start_time || !schedule.end_time) {
    return "Os horários de atendimento devem seguir a agenda configurada do estabelecimento."
  }

  const days = joinNatural(schedule.days_of_week.map((day) => DAY_NAMES[day] || day))
  const parts = [`O negócio funciona ${days ? `de ${days}` : "nos dias configurados"}, das ${schedule.start_time} às ${schedule.end_time}.`]

  if (schedule.breaks?.length) {
    parts.push(
      `Existem pausas em ${schedule.breaks.map((item) => `${item.start} às ${item.end}`).join("; ")}.`
    )
  }
  if (schedule.interval_minutes) {
    parts.push(`Considere intervalos operacionais de ${schedule.interval_minutes} minutos entre atendimentos quando isso for relevante.`)
  }

  return parts.join(" ")
}

function describeService(service: BusinessBrainService): string {
  const price = typeof service.base_price === "number" ? `por R$ ${service.base_price}` : "com valor sob consulta"
  const duration = typeof service.duration_minutes === "number" ? ` em ${service.duration_minutes} minutos` : ""
  return `${service.name} ${price}${duration}`.trim()
}

function describeServices(brain: BusinessBrain): string {
  if (!brain.services.length) {
    return "Use apenas os serviços explicitamente configurados no negócio. Se o cliente pedir algo fora disso, explique com naturalidade o que o estabelecimento realmente oferece."
  }

  const serviceLines = brain.services.map(describeService)
  const sequenceEligible = brain.services.filter((service) => service.sequence_eligible).map((service) => service.name)
  const parts = [
    `Os serviços principais do negócio são ${joinNatural(brain.services.map((service) => service.name))}.`,
    `Detalhes operacionais: ${serviceLines.join("; ")}.`,
  ]

  if (sequenceEligible.length > 0) {
    parts.push(`Quando fizer sentido, os serviços ${joinNatural(sequenceEligible)} podem participar de atendimentos em sequência.`)
  }

  return parts.join(" ")
}

function describeAudience(brain: BusinessBrain): string {
  const modes = brain.audience?.modes || ["all"]
  if (modes.includes("all")) {
    return "O negócio atende público geral, salvo restrições operacionais explicitamente configuradas."
  }
  if (modes.includes("custom") && brain.audience?.note) {
    return `O público atendido segue esta orientação: ${brain.audience.note}.`
  }

  const labels: Record<string, string> = {
    men_only: "homens",
    women_only: "mulheres",
    kids_only: brain.audience?.kids_age_min
      ? `crianças a partir de ${brain.audience.kids_age_min} anos`
      : "crianças",
  }

  const audiences = modes.map((mode) => labels[mode] || mode).filter(Boolean)
  return `O negócio atende ${joinNatural(audiences)}. Se o cliente pedir atendimento para público fora desse perfil, explique isso com naturalidade e redirecione para o que o negócio realmente cobre.`
}

function describeTone(brain: BusinessBrain): string {
  const tone = normalizeText(String(brain.tone || ""))
  if (!tone) {
    return "Fale como recepção real do estabelecimento: natural, cordial, objetiva e contextual."
  }
  if (tone.includes("formal")) {
    return "Mantenha um tom profissional, educado e claro, sem parecer robótico."
  }
  if (tone.includes("informal")) {
    return "Mantenha um tom leve, humano e próximo, sem perder clareza operacional."
  }
  return "Mantenha um tom humano, natural e coerente com o negócio configurado."
}

function describeBooking(brain: BusinessBrain): string {
  const parts = [
    "Conduza agendamentos como recepção real: entenda a intenção primeiro e só depois organize os dados operacionais.",
    "A ordem das informações não importa; você deve montar internamente o plano do atendimento a partir do contexto da conversa.",
  ]

  if (brain.policies.sequence_enabled) {
    parts.push("Quando houver mais de uma pessoa, priorize sequência natural entre horários quando isso fizer sentido operacionalmente.")
  }

  return parts.join(" ")
}

function describeMultiBooking(brain: BusinessBrain): string {
  if (!brain.policies.sequence_enabled) {
    return "Se surgirem múltiplas pessoas na conversa, trate isso com naturalidade, mas respeite as políticas do negócio para agendamento em sequência."
  }

  return "Multiagendamento é parte natural do atendimento. Expressões como 'pra mim e pro Pedro', 'um depois do outro' e 'meu irmão também' devem ser entendidas como montagem de um plano com vários atendidos. Confirme nomes, serviços e contato adicional de forma humana."
}

function describeTriage(brain: BusinessBrain): string {
  const scopeText = brain.services.length
    ? `Atue somente dentro do escopo dos serviços configurados: ${joinNatural(brain.services.map((service) => service.name))}.`
    : "Atue somente dentro do escopo explicitamente configurado para este negócio."

  return [
    scopeText,
    "Se o cliente pedir algo fora do escopo, não finja que atende: reconheça a necessidade, diga com clareza que isso não faz parte do que o negócio oferece e redirecione para o que realmente faz.",
    "Se o serviço existir, mas o público estiver fora do perfil atendido, explique o limite de forma humana, sem soar como bloqueio técnico.",
    "Se houver restrição operacional legítima, explique o motivo e ofereça a alternativa disponível mais próxima.",
  ].join(" ")
}

function describeOperationalRules(brain: BusinessBrain): string {
  const rules = [
    describeSchedule(brain),
    brain.staff.length > 0
      ? `A equipe configurada inclui ${joinNatural(brain.staff.map((staff) => staff.name))}.`
      : "",
    brain.faq.length > 0
      ? `Use também as respostas de FAQ configuradas quando o cliente fizer perguntas informativas.`
      : "",
    brain.policies.reject_unlisted_services
      ? "Pedidos por serviços não listados devem ser recusados com naturalidade, sem inventar exceções."
      : "",
  ].filter(Boolean)

  return rules.join(" ")
}

export function buildAgentNarrative(brain: BusinessBrain): AgentNarrative {
  const businessLabel = brain.business_name || "o negócio"
  const businessType = brain.business_type ? ` do ramo de ${brain.business_type}` : ""
  const summary = `Você atende ${businessLabel}${businessType}. Sua função é agir como alguém que conhece o estabelecimento por dentro, conduz a conversa com naturalidade e usa o sistema apenas para registrar o que foi entendido.`
  const serviceOverview = describeServices(brain)
  const audienceRules = describeAudience(brain)
  const operationalRules = describeOperationalRules(brain)
  const toneGuidance = describeTone(brain)
  const bookingGuidance = describeBooking(brain)
  const multiBookingGuidance = describeMultiBooking(brain)
  const triageGuidance = describeTriage(brain)

  return {
    summary,
    service_overview: serviceOverview,
    audience_rules: audienceRules,
    operational_rules: operationalRules,
    tone_guidance: toneGuidance,
    booking_guidance: bookingGuidance,
    multi_booking_guidance: multiBookingGuidance,
    triage_guidance: triageGuidance,
    prompt_context: [
      summary,
      serviceOverview,
      audienceRules,
      operationalRules,
      toneGuidance,
      bookingGuidance,
      multiBookingGuidance,
      triageGuidance,
    ].join("\n\n"),
  }
}

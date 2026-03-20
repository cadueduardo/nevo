// @ts-nocheck
import type {
  BusinessBrain,
  SemanticCompletedBookingDraft,
  SemanticPostConfirmationPlan,
} from "../types.ts"
import { formatDatePt } from "../../utils.ts"

export function formatAudienceLabel(modes: string[] = []): string {
  if (modes.includes("men_only") && modes.includes("kids_only")) return "homens e crianças"
  if (modes.includes("men_only")) return "homens"
  if (modes.includes("women_only")) return "mulheres"
  if (modes.includes("kids_only")) return "crianças"
  return "todos os públicos"
}

export function buildGreetingFallbackMessage(
  businessName: string | undefined,
  contactName: string | undefined,
  informal: boolean
): string {
  const company = businessName || "a empresa"
  const lead = informal ? "Opa" : "Oi"
  if (contactName) {
    return `${lead} ${contactName}! Tudo bem por aqui, e você? Aqui é da ${company}. Estou à disposição para ajudar no que precisar!`
  }
  return `${lead}! Tudo bem por aqui, e você? Aqui é da ${company}. Estou à disposição para ajudar no que precisar!`
}

export function buildIdentityMessage(businessName?: string): string {
  return `Aqui é da ${businessName || "a empresa"}. Vou te ajudar no que precisar.`
}

export function buildFaqFallbackMessage(businessName?: string): string {
  return `Posso te ajudar com informações sobre ${businessName || "a empresa"} e, se quiser, já seguimos para o agendamento.`
}

export function buildServiceListMessage(businessName: string | undefined): string {
  return `Estes são os serviços disponíveis em ${businessName || "a empresa"}. Qual você quer agendar?`
}

export function buildOutOfScopeServiceRedirectMessage(businessName?: string): string {
  return `Entendi. Esse pedido não faz parte do que oferecemos em ${businessName || "a empresa"}. Posso te mostrar os serviços com que trabalhamos por aqui.`
}

export function shouldUsePluralAudienceCopy(params?: {
  additional_count?: number
  attendee_names?: string[]
  people_count?: number
}): boolean {
  const additionalCount = Number(params?.additional_count || 0)
  const attendeeCount = Array.isArray(params?.attendee_names) ? params.attendee_names.filter(Boolean).length : 0
  const peopleCount = Number(params?.people_count || 0)
  return additionalCount > 0 || attendeeCount > 1 || peopleCount > 1
}

export function buildAudienceConfirmationMessage(
  brain: BusinessBrain,
  params?: { plural?: boolean }
): string {
  const pronoun = params?.plural ? "Vocês se encaixam" : "Você se encaixa"
  return `Só para confirmar: aqui atendemos ${formatAudienceLabel(brain.audience?.modes)}. ${pronoun} nesse perfil?`
}

export function adjustAudiencePromptPerson(prompt: string, params?: { plural?: boolean }): string {
  const text = String(prompt || "").trim()
  if (!text) return text
  if (params?.plural) {
    return text
      .replace(/\bVocê\b/g, "Vocês")
      .replace(/\bVoce\b/g, "Vocês")
      .replace(/\bvoce\b/g, "vocês")
      .replace(/\bse encaixa\b/gi, "se encaixam")
  }
  return text
    .replace(/\bVocês\b/g, "Você")
    .replace(/\bVoces\b/g, "Você")
    .replace(/\bvoces\b/g, "você")
    .replace(/\bse encaixam\b/gi, "se encaixa")
}

export function buildAudienceRestrictionMessage(brain: BusinessBrain): string {
  const audienceLabel = formatAudienceLabel(brain.audience?.modes)
  const businessLabel = brain.business_name ? ` em ${brain.business_name}` : ""
  return `Ah, infelizmente aqui atendemos ${audienceLabel}${businessLabel}. Se quiser, posso te mostrar como funciona o atendimento dentro desse perfil.`
}

export function buildAttendeeQuestion(params: {
  is_additional: boolean
  is_explicit_multi: boolean
}): string {
  if (params.is_additional) return "Qual é o nome da próxima pessoa?"
  if (params.is_explicit_multi) return "Qual é o nome da primeira pessoa?"
  return "Para quem será o agendamento?"
}

export function buildServiceQuestion(attendeeName?: string, params?: { allowSequence?: boolean }): string {
  const allow = params?.allowSequence === true
  const suffix = allow ? " Pode escolher mais de um." : ""
  return attendeeName
    ? `Perfeito! Vamos agendar para ${attendeeName}. Qual serviço você gostaria?${suffix}`
    : `Qual serviço você gostaria de agendar?${suffix}`
}

export function buildSequenceOfferQuestion(attendeeName?: string): string {
  return `Você gostaria de agendar ${attendeeName || "a próxima pessoa"} logo após o atendimento anterior? O próximo horário está disponível. Prefere esse horário, outro horário no mesmo dia ou em outro dia?`
}

export function buildDateQuestion(): string {
  return "Qual dia você prefere agendar? (ex.: Hoje, amanhã ou dia da semana)"
}

export function buildTimeQuestion(): string {
  return "Qual horário você prefere?"
}

export function buildContactQuestion(): string {
  return "Qual contato você prefere usar para confirmar o agendamento?"
}

export function buildSecondaryContactQuestion(params: { attendeeName?: string }): string {
  const name = String(params.attendeeName || "").trim()
  const who = name ? `do ${name}` : "da segunda pessoa"
  return `Perfeito. Quer que eu envie a confirmação do agendamento ${who} por WhatsApp? Se sim, me passe o telefone. Se não, diga “não”.`
}

export function buildWhatsAppPrimaryPhoneConfirmQuestion(phoneDigits?: string): string {
  const digits = String(phoneDigits || "").replace(/\D+/g, "")
  const masked = digits.length >= 4 ? `****${digits.slice(-4)}` : "este número"
  return `Perfeito! Posso usar esse mesmo número (${masked}) como contato? Se sim, responda “sim”. Se quiser outro, me envie o telefone.`
}

export function buildPrimaryPhoneQuestion(): string {
  return "Perfeito. Qual telefone devo usar como contato?"
}
function formatBookingDateForDisplay(dateValue?: string): string | undefined {
  if (!dateValue) return undefined
  const normalized = String(dateValue).trim()
  if (!normalized) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return formatDatePt(normalized)
  return normalized
}

export function resolveSemanticPromptText(params: {
  next_question?: string
  fallback: string
  brain?: BusinessBrain
  audiencePlural?: boolean
}): string {
  const nextQuestion = String(params.next_question || "").trim()
  if (!nextQuestion) return params.fallback

  const promptMap: Record<string, string> = {
    confirm_audience_fit: params.brain
      ? buildAudienceConfirmationMessage(params.brain, { plural: params.audiencePlural })
      : params.fallback,
    confirm_audience_fit_before_booking: params.brain
      ? buildAudienceConfirmationMessage(params.brain, { plural: params.audiencePlural })
      : params.fallback,
    ask_attendee_name: "Para quem será o agendamento?",
    ask_first_attendee_name: "Para quem será o agendamento?",
    ask_next_attendee_name: "Qual é o nome da próxima pessoa?",
    ask_service: "Qual serviço você gostaria de agendar?",
    ask_service_selection: "Qual serviço você gostaria de agendar?",
    ask_date: buildDateQuestion(),
    ask_date_preference: buildDateQuestion(),
    ask_time: buildTimeQuestion(),
    ask_time_preference: buildTimeQuestion(),
    ask_contact: buildContactQuestion(),
    ask_contact_preference: buildContactQuestion(),
  }

  if (promptMap[nextQuestion]) return promptMap[nextQuestion]
  if (/^[a-z0-9_]+$/i.test(nextQuestion)) return params.fallback
  return adjustAudiencePromptPerson(nextQuestion, { plural: params.audiencePlural })
}

export function buildBookingConfirmationMessage(
  services: string[],
  attendeeName?: string,
  dateIso?: string,
  time?: string
): string {
  const serviceLabel = services.join(", ") || "o atendimento"
  const dateLabel = formatBookingDateForDisplay(dateIso)
  return `Perfeito! Vou confirmar ${serviceLabel}${attendeeName ? ` para ${attendeeName}` : ""}${dateLabel ? ` em ${dateLabel}` : ""}${time ? ` às ${time}` : ""}.`
}

export function buildCalendarOfferMessage(): string {
  return "Gostaria de adicionar este compromisso no seu calendário?"
}

export function buildCalendarConfirmedMessage(): string {
  return "Perfeito. Pode adicionar no calendário. Se precisar de mais alguma coisa, sigo por aqui."
}

export function buildCalendarDeclinedMessage(): string {
  return "Perfeito, sem problemas. Se precisar de mais alguma coisa, sigo por aqui."
}

export function buildClosingMessage(): string {
  return "Perfeito. Se precisar de algo depois, sigo por aqui."
}

export function buildBookingConfirmedMessage(draft: SemanticCompletedBookingDraft): string {
  const serviceLabel = draft.service || draft.service_names.join(", ") || "o atendimento"
  const attendeeLabel = draft.attendee_name ? ` de ${draft.attendee_name}` : ""
  const dateLabel = draft.date ? ` para ${formatBookingDateForDisplay(draft.date)}` : ""
  const timeLabel = draft.time ? ` às ${draft.time}` : ""
  return `Perfeito! O agendamento${attendeeLabel} de ${serviceLabel} ficou confirmado${dateLabel}${timeLabel}.`
}

export function buildNextAttendeePrompt(plan: SemanticPostConfirmationPlan): string {
  const suggestionLine =
    plan.suggested_next_time && plan.suggested_next_date
      ? `Posso te sugerir ${plan.suggested_next_time} em ${plan.suggested_next_date} para seguir na sequência.`
      : ""
  if (plan.next_attendee_name && plan.should_offer_sequence_template) {
    const base = buildSequenceOfferQuestion(plan.next_attendee_name)
    return suggestionLine ? `${base} ${suggestionLine}` : base
  }
  if (plan.next_attendee_name) {
    const base = `Vamos seguir com o próximo agendamento de ${plan.next_attendee_name}. Qual serviço você gostaria de agendar? Pode escolher mais de um.`
    return suggestionLine ? `${base} ${suggestionLine}` : base
  }
  return `Vamos seguir com o próximo agendamento. Qual é o nome da próxima pessoa?${suggestionLine ? ` ${suggestionLine}` : ""}`
}

export function buildPriceGuidanceMessage(): string {
  return "Posso te informar os valores certinhos e te ajudar a agendar. Qual serviço você quer consultar?"
}

export function buildServiceDetailMessage(serviceName?: string, description?: string): string {
  if (serviceName && description) {
    return `${serviceName}: ${description} Se quiser, já posso seguir com o agendamento.`
  }
  return "Posso te explicar melhor esse serviço e, se quiser, já seguimos para o agendamento."
}

export function buildServicePriceMessage(serviceName?: string, basePrice?: number): string {
  if (serviceName && typeof basePrice === "number") {
    return `O valor de ${serviceName} é R$ ${basePrice}. Se quiser, já posso seguir com o agendamento.`
  }
  return buildPriceGuidanceMessage()
}

export function buildQuoteMeasurementsMessage(serviceName?: string): string {
  return `Para te passar uma estimativa de ${serviceName || "esse serviço"}, preciso das medidas (ex.: largura x altura em metros). Pode me informar?`
}

export function buildQuoteEstimateMessage(message?: string): string {
  return message || "Posso te passar uma estimativa e, se fizer sentido, seguimos para a visita."
}

export function buildFallbackClarificationMessage(): string {
  return "Pode me dar mais detalhes sobre o que você precisa? Assim, consigo te ajudar melhor."
}

// @ts-nocheck
import type {
  BusinessBrain,
  SemanticCompletedBookingDraft,
  SemanticPostConfirmationPlan,
} from "../types.ts"

export function formatAudienceLabel(modes: string[] = []): string {
  if (modes.includes("men_only") && modes.includes("kids_only")) return "homens e criancas"
  if (modes.includes("men_only")) return "homens"
  if (modes.includes("women_only")) return "mulheres"
  if (modes.includes("kids_only")) return "criancas"
  return "todos os publicos"
}

export function buildGreetingFallbackMessage(
  businessName: string | undefined,
  contactName: string | undefined,
  informal: boolean
): string {
  const company = businessName || "a empresa"
  const lead = informal ? "Opa" : "Oi"
  if (contactName) {
    return `${lead} ${contactName}! Tudo bem por aqui, e voce? Aqui e da ${company}. Estou a disposicao para ajudar no que precisar!`
  }
  return `${lead}! Tudo bem por aqui, e voce? Aqui e da ${company}. Estou a disposicao para ajudar no que precisar!`
}

export function buildIdentityMessage(businessName?: string): string {
  return `Aqui e da ${businessName || "a empresa"}. Vou te ajudar no que precisar.`
}

export function buildServiceListMessage(businessName: string | undefined): string {
  return `Estes sao os servicos disponiveis em ${businessName || "a empresa"}. Qual voce quer agendar?`
}

export function buildAudienceConfirmationMessage(brain: BusinessBrain): string {
  return `So para confirmar: aqui atendemos ${formatAudienceLabel(brain.audience?.modes)}. Voces se encaixam nesse perfil?`
}

export function buildAttendeeQuestion(isAdditional: boolean): string {
  return isAdditional ? "Qual e o nome da proxima pessoa?" : "De quem sera o primeiro agendamento?"
}

export function buildServiceQuestion(attendeeName?: string): string {
  return attendeeName
    ? `Perfeito! Vamos agendar para ${attendeeName}. Qual servico voce gostaria? Pode escolher mais de um.`
    : "Qual servico voce gostaria de agendar? Pode escolher mais de um."
}

export function buildSequenceOfferQuestion(attendeeName?: string): string {
  return `Voce gostaria de agendar ${attendeeName || "a proxima pessoa"} logo apos o atendimento anterior? O proximo horario esta disponivel. Prefere esse horario, outro horario no mesmo dia ou em outro dia?`
}

export function buildDateQuestion(): string {
  return "Qual dia voce prefere agendar? (ex: Hoje, Amanha ou dia da semana)"
}

export function buildTimeQuestion(): string {
  return "Qual horario voce prefere?"
}

export function buildContactQuestion(): string {
  return "Como prefere ser contatado para confirmar o agendamento?"
}

export function buildBookingConfirmationMessage(
  services: string[],
  attendeeName?: string,
  dateIso?: string,
  time?: string
): string {
  const serviceLabel = services.join(", ") || "o atendimento"
  return `Perfeito! Vou confirmar ${serviceLabel}${attendeeName ? ` para ${attendeeName}` : ""}${dateIso ? ` em ${dateIso}` : ""}${time ? ` as ${time}` : ""}.`
}

export function buildCalendarOfferMessage(): string {
  return "Gostaria de adicionar este compromisso no seu calendario?"
}

export function buildBookingConfirmedMessage(draft: SemanticCompletedBookingDraft): string {
  const serviceLabel = draft.service || draft.service_names.join(", ") || "o atendimento"
  const attendeeLabel = draft.attendee_name ? ` de ${draft.attendee_name}` : ""
  const dateLabel = draft.date ? ` para ${draft.date}` : ""
  const timeLabel = draft.time ? ` as ${draft.time}` : ""
  return `Perfeito! O agendamento${attendeeLabel} de ${serviceLabel} ficou confirmado${dateLabel}${timeLabel}.`
}

export function buildNextAttendeePrompt(plan: SemanticPostConfirmationPlan): string {
  const suggestionLine =
    plan.suggested_next_time && plan.suggested_next_date
      ? `Posso te sugerir ${plan.suggested_next_time} em ${plan.suggested_next_date} para seguir na sequencia.`
      : ""
  if (plan.next_attendee_name && plan.should_offer_sequence_template) {
    const base = buildSequenceOfferQuestion(plan.next_attendee_name)
    return suggestionLine ? `${base} ${suggestionLine}` : base
  }
  if (plan.next_attendee_name) {
    const base = `Vamos seguir com o proximo agendamento de ${plan.next_attendee_name}. Qual servico voce gostaria de agendar? Pode escolher mais de um.`
    return suggestionLine ? `${base} ${suggestionLine}` : base
  }
  return `Vamos seguir com o proximo agendamento. Qual e o nome da proxima pessoa?${suggestionLine ? ` ${suggestionLine}` : ""}`
}

export function buildPriceGuidanceMessage(): string {
  return "Posso te informar os valores certinhos e te ajudar a agendar. Qual servico voce quer consultar?"
}

export function buildServiceDetailMessage(): string {
  return "Posso te explicar melhor esse servico e, se quiser, ja seguimos para o agendamento."
}

export function buildFallbackClarificationMessage(): string {
  return "Pode me dar mais detalhes sobre o que voce precisa? Assim, consigo te ajudar melhor."
}

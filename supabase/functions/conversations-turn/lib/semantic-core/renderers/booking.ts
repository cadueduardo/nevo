// @ts-nocheck
import type { SemanticRuntimeResult } from "../runtime.ts"
import { formatAudienceLabel } from "./shared.ts"

function getAttendeeName(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.slot_updates?.attendee_name || semantic.decision.slot_updates?.attendee_name
}

function getServiceNames(semantic: SemanticRuntimeResult): string[] {
  return (
    semantic.execution?.metadata?.service_names ||
    semantic.snapshot.service_candidates.map((service) => service.name)
  )
}

function getDate(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.date || semantic.snapshot.date_candidate?.iso_date
}

function getTime(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.time || semantic.snapshot.time_candidate?.hhmm
}

export function renderBooking(semantic: SemanticRuntimeResult): { message: string; action_options?: string[] } {
  const attendeeName = getAttendeeName(semantic)
  const serviceNames = getServiceNames(semantic)
  const dateIso = getDate(semantic)
  const time = getTime(semantic)
  const decision = semantic.decision
  const execution = semantic.execution
  const brain = semantic.business_brain

  switch (decision.action) {
    case "ask_audience_confirmation":
      return {
        message: `So para confirmar: aqui atendemos ${formatAudienceLabel(brain.audience?.modes)}. Voces se encaixam nesse perfil?`,
        action_options: decision.action_options,
      }
    case "ask_attendee_name":
      return {
        message: semantic.context.state.pending_additional_booking
          ? "Qual e o nome da proxima pessoa?"
          : "De quem sera o primeiro agendamento?",
      }
    case "ask_service":
      return {
        message: attendeeName
          ? `Perfeito! Vamos agendar para ${attendeeName}. Qual servico voce gostaria? Pode escolher mais de um.`
          : "Qual servico voce gostaria de agendar? Pode escolher mais de um.",
        action_options: execution?.action_options || brain.services.map((service) => service.name),
      }
    case "offer_sequence_template":
      return {
        message: `Voce gostaria de agendar ${attendeeName || "a proxima pessoa"} logo apos o atendimento anterior? O proximo horario esta disponivel. Prefere esse horario, outro horario no mesmo dia ou em outro dia?`,
        action_options: decision.action_options,
      }
    case "ask_date":
      return {
        message: "Qual dia voce prefere agendar? (ex: Hoje, Amanha ou dia da semana)",
      }
    case "ask_time":
      return {
        message: "Qual horario voce prefere?",
      }
    case "ask_contact":
      return {
        message: "Como prefere ser contatado para confirmar o agendamento?",
        action_options: ["So celular", "So email", "Celular e email"],
      }
    case "confirm_booking":
      return {
        message: `Perfeito! Vou confirmar ${serviceNames.join(", ") || "o atendimento"}${attendeeName ? ` para ${attendeeName}` : ""}${dateIso ? ` em ${dateIso}` : ""}${time ? ` as ${time}` : ""}.`,
        action_options: ["Confirmar agendamento"],
      }
    case "offer_calendar":
      return {
        message: "Gostaria de adicionar este compromisso no seu calendario?",
        action_options: decision.action_options,
      }
    default:
      return {
        message: "Pode me dar mais detalhes sobre o que voce precisa? Assim, consigo te ajudar melhor.",
        action_options: ["Quero agendar"],
      }
  }
}

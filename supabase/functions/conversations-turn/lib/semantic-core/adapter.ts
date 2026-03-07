// @ts-nocheck
import { buildResult } from "../state.ts"
import type { SimulatorResult, SimulatorState } from "../types.ts"
import type { SemanticRuntimeResult } from "./runtime.ts"

function mergeSemanticState(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult
): SimulatorState {
  const execution = semantic.execution
  const slotUpdates = execution?.slot_updates || semantic.decision.slot_updates || {}
  const statePatch = execution?.state_patch || {}
  return {
    ...baseState,
    ...statePatch,
    slots: {
      ...(baseState.slots || {}),
      ...(statePatch.slots || {}),
      ...slotUpdates,
    },
  }
}

function formatAudienceLabel(modes: string[] = []): string {
  if (modes.includes("men_only") && modes.includes("kids_only")) return "homens e criancas"
  if (modes.includes("men_only")) return "homens"
  if (modes.includes("women_only")) return "mulheres"
  if (modes.includes("kids_only")) return "criancas"
  return "todos os publicos"
}

function buildSemanticMessage(semantic: SemanticRuntimeResult): { message: string; action_options?: string[] } {
  const brain = semantic.business_brain
  const decision = semantic.decision
  const execution = semantic.execution
  const attendeeName = execution?.slot_updates?.attendee_name || decision.slot_updates?.attendee_name
  const serviceNames = execution?.metadata?.service_names || semantic.snapshot.service_candidates.map((service) => service.name)
  const dateIso = execution?.metadata?.date || semantic.snapshot.date_candidate?.iso_date
  const time = execution?.metadata?.time || semantic.snapshot.time_candidate?.hhmm
  const businessName = brain.business_name || "a empresa"
  const contactName = semantic.context.sender_display_name || ""

  switch (decision.action) {
    case "reply_greeting":
      return {
        message: contactName
          ? `Oi ${contactName}! Tudo bem por aqui. Aqui e da ${businessName}. Estou a disposicao para ajudar no que precisar.`
          : `Oi! Tudo bem por aqui. Aqui e da ${businessName}. Estou a disposicao para ajudar no que precisar.`,
        action_options: ["Quero agendar"],
      }
    case "reply_identity":
      return {
        message: `Aqui e da ${businessName}. Vou te ajudar no que precisar.`,
        action_options: ["Quero agendar"],
      }
    case "reply_price":
      return {
        message: "Posso te informar os valores certinhos e te ajudar a agendar. Qual servico voce quer consultar?",
        action_options: brain.services.map((service) => service.name),
      }
    case "reply_service_detail":
      return {
        message: "Posso te explicar melhor esse servico e, se quiser, ja seguimos para o agendamento.",
        action_options: ["Quero agendar"],
      }
    case "reply_service_list":
      return {
        message: `Estes sao os servicos disponiveis em ${businessName}. Qual voce quer agendar?`,
        action_options: brain.services.map((service) => service.name),
      }
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
        action_options: undefined,
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
        message: `Quer agendar ${attendeeName || "a proxima pessoa"} logo depois do atendimento anterior?`,
        action_options: decision.action_options,
      }
    case "ask_date":
      return {
        message: "Qual dia voce prefere agendar? (ex: Hoje, Amanha ou dia da semana)",
        action_options: undefined,
      }
    case "ask_time":
      return {
        message: "Qual horario voce prefere?",
        action_options: undefined,
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

export function buildSemanticSimulatorResult(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult
): SimulatorResult {
  const mergedState = mergeSemanticState(baseState, semantic)
  const rendered = buildSemanticMessage(semantic)
  return buildResult(rendered.message, mergedState, rendered.action_options)
}

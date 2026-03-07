// @ts-nocheck
import type { SemanticRuntimeResult } from "../runtime.ts"
import { deriveBookingContext } from "../booking-context.ts"
import {
  buildAttendeeQuestion,
  buildAudienceConfirmationMessage,
  buildBookingConfirmationMessage,
  buildBookingConfirmedMessage,
  buildCalendarOfferMessage,
  buildContactQuestion,
  buildDateQuestion,
  buildFallbackClarificationMessage,
  buildNextAttendeePrompt,
  buildSequenceOfferQuestion,
  buildServiceQuestion,
  buildTimeQuestion,
} from "./prompt-library.ts"
import type { RenderedSemanticMessage } from "./shared.ts"

function getAttendeeName(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.slot_updates?.attendee_name || semantic.decision.slot_updates?.attendee_name
}

function getServiceNames(semantic: SemanticRuntimeResult): string[] {
  return (
    semantic.execution?.metadata?.service_names ||
    semantic.snapshot.entities.services.map((service) => service.name)
  )
}

function getDate(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.date || semantic.snapshot.entities.date?.iso_date
}

function getTime(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.time || semantic.snapshot.entities.time?.hhmm
}

export function renderBooking(semantic: SemanticRuntimeResult): RenderedSemanticMessage {
  const booking = deriveBookingContext(semantic.snapshot, semantic.context)
  const attendeeName = getAttendeeName(semantic) || booking.current_attendee_name
  const serviceNames = getServiceNames(semantic)
  const dateIso = getDate(semantic)
  const time = getTime(semantic)
  const decision = semantic.decision
  const execution = semantic.execution
  const brain = semantic.business_brain

  switch (decision.action) {
    case "ask_audience_confirmation":
      return {
        message: decision.next_question || buildAudienceConfirmationMessage(brain),
        action_options: decision.action_options,
      }
    case "ask_attendee_name":
      return {
        message: buildAttendeeQuestion(booking.is_additional_booking),
      }
    case "ask_service":
      if (booking.template_choice === "same_next") {
        return {
          message: `Perfeito. Antes de sugerir o proximo horario em sequencia para ${attendeeName || "a proxima pessoa"}, preciso confirmar o servico.`,
          action_options: execution?.action_options || booking.service_options,
        }
      }
      return {
        message: buildServiceQuestion(attendeeName),
        action_options: execution?.action_options || booking.service_options,
      }
    case "offer_sequence_template":
      return {
        message: buildSequenceOfferQuestion(attendeeName),
        action_options: decision.action_options,
      }
    case "ask_date":
      if (booking.template_choice === "same_next" && booking.sequence_suggestion && !booking.sequence_suggestion.available) {
        return {
          message:
            "Nao encontrei um proximo horario livre na sequencia desse atendimento. Vamos escolher outro dia ou outro horario para continuar.",
          action_options: execution?.action_options,
        }
      }
      return {
        message: buildDateQuestion(),
        action_options: execution?.action_options,
      }
    case "ask_time":
      return {
        message: buildTimeQuestion(),
        action_options: execution?.action_options,
      }
    case "ask_contact":
      return {
        message: buildContactQuestion(),
        action_options: execution?.action_options || booking.contact_options,
      }
    case "confirm_booking":
      if (execution?.metadata?.completed_booking) {
        const confirmed = execution.metadata.completed_booking as any
        const postPlan = execution.metadata.post_confirmation_plan as any
        const lines = [buildBookingConfirmedMessage(confirmed)]
        if (postPlan?.has_more_people) {
          lines.push(buildNextAttendeePrompt(postPlan))
        } else if ((postPlan?.outbound_notifications || []).length > 0) {
          lines.push(
            `Enviei a confirmacao dos outros agendamentos para ${(postPlan.outbound_notifications || []).length} contato(s) via WhatsApp.`
          )
        }
        return {
          message: lines.join("\n\n"),
          action_options:
            postPlan?.has_more_people
              ? postPlan?.next_action_options || ["Continuar agendamento"]
              : ["Adicionar no calendario", "Nao, obrigado"],
        }
      }
      return {
        message: buildBookingConfirmationMessage(serviceNames, attendeeName, dateIso, time),
        action_options: ["Confirmar agendamento"],
      }
    case "offer_calendar":
      return {
        message: buildCalendarOfferMessage(),
        action_options: decision.action_options,
      }
    default:
      return {
        message: buildFallbackClarificationMessage(),
        action_options: ["Quero agendar"],
      }
  }
}

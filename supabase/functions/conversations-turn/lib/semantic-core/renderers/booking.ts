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
    semantic.snapshot.service_candidates.map((service) => service.name)
  )
}

function getDate(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.date || semantic.snapshot.date_candidate?.iso_date
}

function getTime(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.time || semantic.snapshot.time_candidate?.hhmm
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
        message: buildAudienceConfirmationMessage(brain),
        action_options: decision.action_options,
      }
    case "ask_attendee_name":
      return {
        message: buildAttendeeQuestion(booking.is_additional_booking),
      }
    case "ask_service":
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
      return {
        message: buildDateQuestion(),
      }
    case "ask_time":
      return {
        message: buildTimeQuestion(),
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
        }
        return {
          message: lines.join("\n\n"),
          action_options: postPlan?.has_more_people ? ["Continuar agendamento"] : ["Confirmar agendamento"],
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

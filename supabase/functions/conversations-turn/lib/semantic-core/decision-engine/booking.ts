// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"

export function decideBooking(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult | null {
  if (snapshot.intents.primary !== "booking" && snapshot.intents.primary !== "booking_sequence") {
    return null
  }

  const interactionStyle = context.business_brain.policies.interaction_style
  const preferNumberedOptions = interactionStyle !== "conversational"
  const booking = deriveBookingContext(snapshot, context)

  if (booking.missing_step === "audience") {
    return {
      action: "ask_audience_confirmation",
      reason: snapshot.risks.audience?.reason || "audience_requires_confirmation",
      confidence: snapshot.intents.confidence,
      action_options: ["Sim, nos encaixamos", "Quero agendar"],
      next_question: "confirm_audience_fit_before_booking",
      channel_hints: { prefer_numbered_options: true, prefer_multi_select: false },
    }
  }

  if (booking.missing_step === "attendee") {
    return {
      action: "ask_attendee_name",
      reason: "missing_attendee_name",
      confidence: snapshot.intents.confidence,
      semantic_people_queue: booking.people_queue,
      next_question: context.state.pending_additional_booking ? "ask_next_attendee_name" : "ask_first_attendee_name",
      channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
    }
  }

  if (booking.missing_step === "service") {
    return {
      action: "ask_service",
      reason: "missing_service_selection",
      confidence: snapshot.intents.confidence,
      semantic_people_queue: booking.people_queue,
      next_question: "ask_service_selection",
      channel_hints: {
        prefer_numbered_options: preferNumberedOptions,
        prefer_multi_select: Boolean(context.business_brain.policies.sequence_enabled),
      },
    }
  }

  if (booking.should_offer_sequence_template) {
    return {
      action: "offer_sequence_template",
      reason: "sequence_requested_or_detected",
      confidence: snapshot.intents.confidence,
      slot_updates: booking.slot_updates,
      semantic_people_queue: booking.people_queue,
      action_options: [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
      ],
      next_question: "offer_sequential_booking_options",
      channel_hints: { prefer_numbered_options: true, prefer_multi_select: false },
    }
  }

  if (booking.missing_step === "date") {
    return {
      action: "ask_date",
      reason: "missing_date_preference",
      confidence: snapshot.intents.confidence,
      slot_updates: booking.slot_updates,
      semantic_people_queue: booking.people_queue,
      next_question: "ask_date_preference",
      channel_hints: {
        prefer_numbered_options: interactionStyle !== "conversational",
        prefer_multi_select: false,
      },
    }
  }

  if (booking.missing_step === "time") {
    return {
      action: "ask_time",
      reason: "missing_time_preference",
      confidence: snapshot.intents.confidence,
      slot_updates: booking.slot_updates,
      semantic_people_queue: booking.people_queue,
      next_question: "ask_time_preference",
      channel_hints: { prefer_numbered_options: true, prefer_multi_select: false },
    }
  }

  if (booking.missing_step === "contact") {
    return {
      action: "ask_contact",
      reason: "missing_contact_preference",
      confidence: snapshot.intents.confidence,
      slot_updates: booking.slot_updates,
      semantic_people_queue: booking.people_queue,
      action_options: booking.contact_options,
      next_question: "ask_contact_preference",
      channel_hints: { prefer_numbered_options: true, prefer_multi_select: false },
    }
  }

  return {
    action: "confirm_booking",
    reason: "booking_ready_for_confirmation",
    confidence: snapshot.intents.confidence,
    slot_updates: booking.slot_updates,
    semantic_people_queue: booking.people_queue,
    next_question: "confirm_booking_summary",
    channel_hints: { prefer_numbered_options: true, prefer_multi_select: false },
  }
}

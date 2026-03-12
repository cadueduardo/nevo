// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"

function buildBookingChannelHints(
  preferNumberedOptions: boolean,
  preferMultiSelect = false
): SemanticDecisionResult["channel_hints"] {
  return {
    prefer_numbered_options: preferNumberedOptions,
    prefer_multi_select: preferMultiSelect,
  }
}

function buildBookingDecision(params: {
  snapshot: TurnSemanticSnapshot
  booking: ReturnType<typeof deriveBookingContext>
  action: SemanticDecisionResult["action"]
  reason: string
  next_question: string
  action_options?: string[]
  slot_updates?: SemanticDecisionResult["slot_updates"]
  channel_hints: SemanticDecisionResult["channel_hints"]
}): SemanticDecisionResult {
  const { snapshot, booking, action, reason, next_question, action_options, slot_updates, channel_hints } = params
  return {
    action,
    reason,
    confidence: snapshot.intents.confidence,
    semantic_people_queue: booking.people_queue,
    ...(slot_updates ? { slot_updates } : {}),
    ...(action_options ? { action_options } : {}),
    next_question,
    channel_hints,
  }
}

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
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_audience_confirmation",
      reason: snapshot.risks.audience?.reason || "audience_requires_confirmation",
      action_options: ["Sim, nos encaixamos", "Quero agendar"],
      next_question:
        snapshot.risks.audience?.prompt || "confirm_audience_fit_before_booking",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  if (booking.missing_step === "attendee") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_attendee_name",
      reason: "missing_attendee_name",
      next_question: context.state.pending_additional_booking ? "ask_next_attendee_name" : "ask_first_attendee_name",
      channel_hints: buildBookingChannelHints(false),
    })
  }

  if (booking.should_offer_sequence_template) {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "offer_sequence_template",
      reason: "sequence_requested_or_detected",
      slot_updates: booking.slot_updates,
      action_options: [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
      ],
      next_question: "offer_sequential_booking_options",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  if (booking.missing_step === "service") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_service",
      reason: "missing_service_selection",
      slot_updates:
        booking.template_choice === "same_next" || booking.template_choice === "same_day"
          ? booking.slot_updates
          : undefined,
      next_question: "ask_service_selection",
      channel_hints: buildBookingChannelHints(
        preferNumberedOptions,
        Boolean(context.business_brain.policies.sequence_enabled)
      ),
    })
  }

  if (booking.missing_step === "date") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_date",
      reason:
        booking.template_choice === "same_next" && booking.sequence_suggestion && !booking.sequence_suggestion.available
          ? "sequence_same_next_unavailable"
          : "missing_date_preference",
      slot_updates: booking.slot_updates,
      next_question: "ask_date_preference",
      channel_hints: buildBookingChannelHints(interactionStyle !== "conversational"),
    })
  }

  if (booking.missing_step === "time") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_time",
      reason: "missing_time_preference",
      slot_updates: booking.slot_updates,
      next_question: "ask_time_preference",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  if (booking.missing_step === "contact") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_contact",
      reason: "missing_contact_preference",
      slot_updates: booking.slot_updates,
      action_options: booking.contact_options,
      next_question: "ask_contact_preference",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  return buildBookingDecision({
    snapshot,
    booking,
    action: "confirm_booking",
    reason: "booking_ready_for_confirmation",
    slot_updates: booking.slot_updates,
    next_question: "confirm_booking_summary",
    channel_hints: buildBookingChannelHints(true),
  })
}

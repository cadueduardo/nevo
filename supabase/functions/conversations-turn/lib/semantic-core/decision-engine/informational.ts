// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { deriveInformationalContext } from "../informational-context.ts"

function prefersNumberedOptions(context: SemanticTurnContext): boolean {
  return context.business_brain.policies.interaction_style !== "conversational"
}

function buildInformationalDecision(params: {
  snapshot: TurnSemanticSnapshot
  action: SemanticDecisionResult["action"]
  reason: string
  next_question: string
  slot_updates?: SemanticDecisionResult["slot_updates"]
  channel_hints: SemanticDecisionResult["channel_hints"]
}): SemanticDecisionResult {
  const { snapshot, action, reason, next_question, slot_updates, channel_hints } = params
  return {
    action,
    reason,
    confidence: snapshot.intents.confidence,
    ...(slot_updates ? { slot_updates } : {}),
    next_question,
    channel_hints,
  }
}

export function decideInformational(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult | null {
  const booking = deriveBookingContext(snapshot, context)
  const informational = deriveInformationalContext(snapshot, context)

  switch (snapshot.intents.primary) {
    case "faq":
      return buildInformationalDecision({
        snapshot,
        action: "reply_faq",
        reason: "primary_intent_faq",
        next_question: informational.answer ? "answer_faq_with_business_context" : "answer_faq_and_offer_next_step",
        channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
      })
    case "identity":
      return buildInformationalDecision({
        snapshot,
        action: "reply_identity",
        reason: "primary_intent_identity",
        next_question: "introduce_business_and_assistant",
        channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
      })
    case "price":
      return buildInformationalDecision({
        snapshot,
        action: "reply_price",
        reason: "primary_intent_price",
        slot_updates: booking.slot_updates,
        next_question: "answer_price_and_offer_next_step",
        channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
      })
    case "quote":
      return buildInformationalDecision({
        snapshot,
        action: informational.quote?.missing_keys?.length ? "ask_quote_measurements" : "reply_quote_estimate",
        reason: informational.quote?.missing_keys?.length ? "primary_intent_quote_missing_measurements" : "primary_intent_quote",
        next_question: informational.quote?.missing_keys?.length ? "ask_quote_measurements" : "reply_quote_estimate_and_offer_visit",
        channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
      })
    case "service_detail":
      return buildInformationalDecision({
        snapshot,
        action: "reply_service_detail",
        reason: "primary_intent_service_detail",
        slot_updates: booking.slot_updates,
        next_question: "explain_service_and_offer_booking",
        channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
      })
    case "service_list":
      return buildInformationalDecision({
        snapshot,
        action: "reply_service_list",
        reason: "primary_intent_service_list",
        next_question: "list_services_and_invite_selection",
        channel_hints: {
          prefer_numbered_options: prefersNumberedOptions(context),
          prefer_multi_select: Boolean(context.business_brain.policies.sequence_enabled),
        },
      })
    default:
      return null
  }
}

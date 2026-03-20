// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { shouldRedirectOutOfScopeServiceRequest } from "../service-scope-triage.ts"

function shouldOfferCalendarOnClosing(snapshot: TurnSemanticSnapshot, context: SemanticTurnContext): boolean {
  return snapshot.intents.primary === "closing" && Boolean(context.state.pending_calendar_offer)
}

export function decideFallback(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult {
  if (snapshot.signals.calendar_response === "accept") {
    return {
      action: "reply_calendar_confirmed",
      reason: "calendar_offer_accepted",
      confidence: snapshot.intents.confidence,
      next_question: "calendar_offer_accepted",
      channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
    }
  }

  if (snapshot.signals.calendar_response === "decline") {
    return {
      action: "reply_calendar_declined",
      reason: "calendar_offer_declined",
      confidence: snapshot.intents.confidence,
      next_question: "calendar_offer_declined",
      channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
    }
  }

  if (shouldOfferCalendarOnClosing(snapshot, context)) {
    return {
      action: "offer_calendar",
      reason: "customer_is_closing_after_booking",
      confidence: snapshot.intents.confidence,
      action_options: ["Adicionar no calendário", "Não, obrigado"],
      next_question: "offer_calendar_link",
      channel_hints: { prefer_numbered_options: true, prefer_multi_select: false },
    }
  }

  if (snapshot.intents.primary === "closing") {
    return {
      action: "reply_closing",
      reason: "customer_is_closing_conversation",
      confidence: snapshot.intents.confidence,
      next_question: "reply_polite_closing",
      channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
    }
  }

  if (shouldRedirectOutOfScopeServiceRequest(snapshot, context)) {
    return {
      action: "reply_service_list",
      reason: "service_out_of_scope_redirect",
      confidence: snapshot.intents.confidence,
      next_question: "service_out_of_scope_redirect",
      channel_hints: {
        prefer_numbered_options: context.business_brain.policies.interaction_style !== "conversational",
        prefer_multi_select: Boolean(context.business_brain.policies.sequence_enabled),
      },
    }
  }

  return {
    action: "handoff_fallback",
    reason: "semantic_snapshot_fallback",
    confidence: snapshot.intents.confidence,
    next_question: "handoff_or_clarify",
    channel_hints: { prefer_numbered_options: false, prefer_multi_select: false },
  }
}

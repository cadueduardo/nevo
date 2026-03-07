// @ts-nocheck
import type { SemanticDecisionResult, TurnSemanticSnapshot } from "../types.ts"

export function decideFallback(snapshot: TurnSemanticSnapshot): SemanticDecisionResult {
  if (snapshot.intents.primary === "closing") {
    return {
      action: "offer_calendar",
      reason: "customer_is_closing_after_booking",
      confidence: snapshot.intents.confidence,
      action_options: ["Adicionar no calendario", "Nao, obrigado"],
      next_question: "offer_calendar_link",
      channel_hints: { prefer_numbered_options: true, prefer_multi_select: false },
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

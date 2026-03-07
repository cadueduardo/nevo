// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"

export function decideGreeting(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult {
  return {
    action: "reply_greeting",
    reason: "primary_intent_greeting",
    confidence: snapshot.intents.confidence,
    next_question: "greet_customer_naturally",
    channel_hints: {
      prefer_numbered_options: false,
      prefer_multi_select: false,
    },
  }
}

// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { decideBooking } from "./booking.ts"
import { decideFallback } from "./fallback.ts"
import { decideGreeting } from "./greeting.ts"
import { decideInformational } from "./informational.ts"

export function decideNextSemanticAction(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult {
  if (snapshot.risks.audience?.blocked) {
    return {
      action: "ask_clarification",
      reason: snapshot.risks.audience.reason || "target_audience_blocked",
      confidence: snapshot.intents.confidence,
      next_question: snapshot.risks.audience.prompt,
      channel_hints: {
        prefer_numbered_options: false,
        prefer_multi_select: false,
      },
    }
  }

  if (snapshot.intents.primary === "greeting") {
    return decideGreeting(snapshot, context)
  }

  const informational = decideInformational(snapshot, context)
  if (informational) return informational

  const booking = decideBooking(snapshot, context)
  if (booking) return booking

  return decideFallback(snapshot)
}

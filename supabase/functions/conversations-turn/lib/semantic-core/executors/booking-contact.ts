// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingContact(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const booking = deriveBookingContext(snapshot, context)
  return buildExecutorResult({
    executor: "booking-contact",
    decision,
    state_patch: {
      pending_contact_field: "contact_preference",
    },
    action_options: decision.action_options || booking.contact_options,
  })
}

// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingSequence(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const booking = deriveBookingContext(snapshot, context)
  return buildExecutorResult({
    executor: "booking-sequence",
    decision,
    slot_updates: decision.slot_updates,
    state_patch: {
      pending_template_choice: true,
      pending_second_service_choice: snapshot.service_candidates.length === 0,
      last_template_options: decision.action_options,
    },
    action_options: decision.action_options,
    metadata: {
      sequence_request: snapshot.sequence_request === true,
      completed_bookings_count: context.state.completed_bookings?.length || 0,
      sequence_anchor_booking: booking.sequence_anchor_booking || null,
    },
  })
}

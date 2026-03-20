// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { buildExecutorResult, buildBookingQueueState } from "./shared.ts"

export function executeBookingAttendee(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const queueState = buildBookingQueueState(decision, snapshot, context)

  return buildExecutorResult({
    executor: "booking-attendee",
    decision,
    slot_updates:
      queueState.attendee_name || decision.slot_updates
        ? {
            ...(decision.slot_updates || {}),
            ...(queueState.attendee_name ? { attendee_name: queueState.attendee_name } : {}),
          }
        : undefined,
    state_patch: {
      ...(snapshot.signals.contact_preference || decision.slot_updates?.customer_phone || decision.slot_updates?.customer_email
        ? {
            pending_contact_field: undefined,
            contact_preference: snapshot.signals.contact_preference || context.state.contact_preference,
          }
        : {}),
      pending_attendee_name: !queueState.attendee_name,
      pending_attendee_queue: queueState.remaining_queue,
    },
    metadata: {
      attendee_name: queueState.attendee_name || null,
      queue_size: decision.semantic_people_queue?.length || 0,
      remaining_queue_size: queueState.remaining_queue.length,
    },
  })
}

// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingAttendee(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const attendeeName = snapshot.attendee_names?.[0] || decision.slot_updates?.attendee_name
  const queue = decision.semantic_people_queue || snapshot.attendee_names || []

  return buildExecutorResult({
    executor: "booking-attendee",
    decision,
    slot_updates: attendeeName ? { attendee_name: attendeeName } : undefined,
    state_patch: {
      pending_attendee_name: !attendeeName,
      pending_attendee_queue: queue.length > 1 ? queue.slice(1) : context.state.pending_attendee_queue,
    },
    metadata: {
      attendee_name: attendeeName || null,
      queue_size: queue.length,
    },
  })
}

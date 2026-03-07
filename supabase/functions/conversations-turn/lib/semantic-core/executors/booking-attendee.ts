// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { deriveBookingContext, shiftCurrentAttendeeFromQueue } from "../booking-context.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingAttendee(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const booking = deriveBookingContext(snapshot, context)
  const attendeeName = booking.current_attendee_name || decision.slot_updates?.attendee_name
  const queue = decision.semantic_people_queue || booking.people_queue || []
  const remainingQueue = shiftCurrentAttendeeFromQueue(queue, attendeeName)

  return buildExecutorResult({
    executor: "booking-attendee",
    decision,
    slot_updates: attendeeName ? { attendee_name: attendeeName } : undefined,
    state_patch: {
      pending_attendee_name: !attendeeName,
      pending_attendee_queue: remainingQueue,
    },
    metadata: {
      attendee_name: attendeeName || null,
      queue_size: queue.length,
      remaining_queue_size: remainingQueue.length,
    },
  })
}

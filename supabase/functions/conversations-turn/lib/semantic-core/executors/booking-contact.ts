// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { buildExecutorResult, buildBookingQueueState } from "./shared.ts"

export function executeBookingContact(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const booking = deriveBookingContext(snapshot, context)
  const queueState = buildBookingQueueState(decision, snapshot, context)
  return buildExecutorResult({
    executor: "booking-contact",
    decision,
    slot_updates: queueState.attendee_name
      ? {
          attendee_name: queueState.attendee_name,
          ...(decision.slot_updates?.service ? { service: decision.slot_updates.service } : {}),
          ...(decision.slot_updates?.date ? { date: decision.slot_updates.date } : {}),
          ...(decision.slot_updates?.time ? { time: decision.slot_updates.time } : {}),
        }
      : decision.slot_updates,
    state_patch: {
      pending_contact_field: "contact_preference",
      pending_attendee_queue: queueState.remaining_queue,
    },
    action_options: decision.action_options || booking.contact_options,
  })
}

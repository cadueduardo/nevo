// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { getSemanticDayOptions } from "../availability-planner.ts"
import { buildExecutorResult, buildBookingQueueState } from "./shared.ts"

export function executeBookingDate(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const isoDate = snapshot.entities.date?.iso_date || decision.slot_updates?.date
  const queueState = buildBookingQueueState(decision, snapshot, context)
  const dayOptions = getSemanticDayOptions(
    context.business_brain,
    context.state.slots?.staff_name
  )
  return buildExecutorResult({
    executor: "booking-date",
    decision,
    slot_updates: {
      ...(queueState.attendee_name ? { attendee_name: queueState.attendee_name } : {}),
      ...(decision.slot_updates?.service ? { service: decision.slot_updates.service } : {}),
      ...(isoDate ? { date: isoDate } : {}),
    },
    state_patch: {
      pending_date_confirmation: isoDate || undefined,
      pending_attendee_queue: queueState.remaining_queue,
    },
    action_options: dayOptions,
    metadata: {
      attendee_name: queueState.attendee_name || null,
      iso_date: isoDate || null,
      raw_text: snapshot.entities.date?.raw_text || null,
      day_options: dayOptions,
    },
  })
}

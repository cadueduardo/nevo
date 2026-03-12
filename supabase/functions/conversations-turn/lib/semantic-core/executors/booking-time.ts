// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { getSemanticTimeOptions } from "../availability-planner.ts"
import { buildExecutorResult, buildBookingQueueState } from "./shared.ts"

export function executeBookingTime(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const hhmm = snapshot.entities.time?.hhmm || decision.slot_updates?.time
  const queueState = buildBookingQueueState(decision, snapshot, context)
  const date =
    snapshot.entities.date?.iso_date ||
    decision.slot_updates?.date ||
    context.state.slots?.date
  const staffName = context.state.slots?.staff_name
  const service = context.state.slots?.service
  const timeOptions = getSemanticTimeOptions(context.business_brain, context.state, {
    date,
    staff_name: staffName,
    service,
  })
  return buildExecutorResult({
    executor: "booking-time",
    decision,
    slot_updates: {
      ...(queueState.attendee_name ? { attendee_name: queueState.attendee_name } : {}),
      ...(decision.slot_updates?.service ? { service: decision.slot_updates.service } : {}),
      ...(decision.slot_updates?.date ? { date: decision.slot_updates.date } : {}),
      ...(hhmm ? { time: hhmm } : {}),
    },
    state_patch: {
      last_time_options: timeOptions,
      last_time_options_date: date,
      last_time_options_staff: staffName,
      pending_attendee_queue: queueState.remaining_queue,
    },
    action_options: timeOptions,
    metadata: {
      attendee_name: queueState.attendee_name || null,
      time: hhmm || null,
      time_options: timeOptions,
    },
  })
}

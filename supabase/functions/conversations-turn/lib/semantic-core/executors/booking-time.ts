// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { getSemanticTimeOptions } from "../availability-planner.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingTime(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const hhmm = snapshot.entities.time?.hhmm || decision.slot_updates?.time
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
    slot_updates: hhmm ? { time: hhmm } : undefined,
    state_patch: {
      last_time_options: timeOptions,
      last_time_options_date: date,
      last_time_options_staff: staffName,
    },
    action_options: timeOptions,
    metadata: {
      time: hhmm || null,
      time_options: timeOptions,
    },
  })
}

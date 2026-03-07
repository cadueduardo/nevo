// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { getSemanticDayOptions } from "../availability-planner.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingDate(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const isoDate = snapshot.entities.date?.iso_date || decision.slot_updates?.date
  const dayOptions = getSemanticDayOptions(
    context.business_brain,
    context.state.slots?.staff_name
  )
  return buildExecutorResult({
    executor: "booking-date",
    decision,
    slot_updates: isoDate ? { date: isoDate } : undefined,
    state_patch: {
      pending_date_confirmation: isoDate || undefined,
    },
    action_options: dayOptions,
    metadata: {
      iso_date: isoDate || null,
      raw_text: snapshot.entities.date?.raw_text || null,
      day_options: dayOptions,
    },
  })
}

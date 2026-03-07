// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  TurnSemanticSnapshot,
} from "../types.ts"

export function executeBookingTime(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot
): SemanticExecutorResult {
  const hhmm = snapshot.time_candidate?.hhmm || decision.slot_updates?.time
  return {
    executor: "booking-time",
    slot_updates: hhmm ? { time: hhmm } : undefined,
    state_patch: {
      last_prompt: decision.next_question || "ask_time_preference",
    },
    prompt_key: decision.next_question || "ask_time_preference",
    metadata: {
      time: hhmm || null,
    },
  }
}

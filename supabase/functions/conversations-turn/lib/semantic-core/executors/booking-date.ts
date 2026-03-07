// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  TurnSemanticSnapshot,
} from "../types.ts"

export function executeBookingDate(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot
): SemanticExecutorResult {
  const isoDate = snapshot.date_candidate?.iso_date || decision.slot_updates?.date
  return {
    executor: "booking-date",
    slot_updates: isoDate ? { date: isoDate } : undefined,
    state_patch: {
      pending_date_confirmation: isoDate || undefined,
      last_prompt: decision.next_question || "ask_date_preference",
    },
    prompt_key: decision.next_question || "ask_date_preference",
    metadata: {
      iso_date: isoDate || null,
      raw_text: snapshot.date_candidate?.raw_text || null,
    },
  }
}

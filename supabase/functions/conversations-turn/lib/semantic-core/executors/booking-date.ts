// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  TurnSemanticSnapshot,
} from "../types.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingDate(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot
): SemanticExecutorResult {
  const isoDate = snapshot.entities.date?.iso_date || decision.slot_updates?.date
  return buildExecutorResult({
    executor: "booking-date",
    decision,
    slot_updates: isoDate ? { date: isoDate } : undefined,
    state_patch: {
      pending_date_confirmation: isoDate || undefined,
    },
    metadata: {
      iso_date: isoDate || null,
      raw_text: snapshot.entities.date?.raw_text || null,
    },
  })
}

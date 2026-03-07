// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  TurnSemanticSnapshot,
} from "../types.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingTime(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot
): SemanticExecutorResult {
  const hhmm = snapshot.entities.time?.hhmm || decision.slot_updates?.time
  return buildExecutorResult({
    executor: "booking-time",
    decision,
    slot_updates: hhmm ? { time: hhmm } : undefined,
    metadata: {
      time: hhmm || null,
    },
  })
}

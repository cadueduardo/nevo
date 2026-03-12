// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeCalendarOffer(
  decision: SemanticDecisionResult,
  _snapshot: TurnSemanticSnapshot,
  _context: SemanticTurnContext
): SemanticExecutorResult {
  return buildExecutorResult({
    executor: "calendar-offer",
    decision,
    state_patch: {
      pending_calendar_offer: false,
      pending_final_confirmation: false,
    },
    action_options: decision.action_options,
  })
}

// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult } from "../types.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingContact(decision: SemanticDecisionResult): SemanticExecutorResult {
  return buildExecutorResult({
    executor: "booking-contact",
    decision,
    state_patch: {
      pending_contact_field: "contact_preference",
    },
    action_options: decision.action_options,
  })
}

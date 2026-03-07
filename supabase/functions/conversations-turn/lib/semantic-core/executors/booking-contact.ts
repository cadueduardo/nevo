// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult } from "../types.ts"

export function executeBookingContact(decision: SemanticDecisionResult): SemanticExecutorResult {
  return {
    executor: "booking-contact",
    state_patch: {
      pending_contact_field: "contact_preference",
      last_prompt: decision.next_question || "ask_contact_preference",
    },
    action_options: decision.action_options,
    prompt_key: decision.next_question || "ask_contact_preference",
  }
}

// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"

export function executeBookingService(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const selectedServices = snapshot.service_candidates?.map((service) => service.name).filter(Boolean) || []
  const serviceValue = selectedServices.length > 0 ? selectedServices.join(", ") : decision.slot_updates?.service
  const options = context.business_brain.services.map((service) => service.name)
  const multiSelect = Boolean(context.business_brain.policies.sequence_enabled)

  return {
    executor: "booking-service",
    slot_updates: serviceValue ? { service: serviceValue } : undefined,
    state_patch: {
      last_service_options: options,
      service_selection_multi: multiSelect,
      pending_second_service_choice: context.state.pending_second_service_choice && !serviceValue,
      last_prompt: decision.next_question || "ask_service_selection",
    },
    action_options: options,
    prompt_key: decision.next_question || "ask_service_selection",
    metadata: {
      service_names: selectedServices,
      multi_select: multiSelect,
    },
  }
}

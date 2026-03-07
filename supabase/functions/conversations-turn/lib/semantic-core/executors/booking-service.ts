// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingService(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const booking = deriveBookingContext(snapshot, context)
  const selectedServices = snapshot.entities.services?.map((service) => service.name).filter(Boolean) || []
  const serviceValue = selectedServices.length > 0 ? selectedServices.join(", ") : decision.slot_updates?.service
  const multiSelect = Boolean(context.business_brain.policies.sequence_enabled)

  return buildExecutorResult({
    executor: "booking-service",
    decision,
    slot_updates: serviceValue ? { service: serviceValue } : undefined,
    state_patch: {
      last_service_options: booking.service_options,
      service_selection_multi: multiSelect,
      pending_second_service_choice: context.state.pending_second_service_choice && !serviceValue,
    },
    action_options: booking.service_options,
    metadata: {
      service_names: selectedServices,
      multi_select: multiSelect,
    },
  })
}

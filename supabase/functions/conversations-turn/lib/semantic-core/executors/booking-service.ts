// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { buildExecutorResult, buildBookingQueueState } from "./shared.ts"

export function executeBookingService(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const booking = deriveBookingContext(snapshot, context)
  const queueState = buildBookingQueueState(decision, snapshot, context)
  const selectedServices = snapshot.entities.services?.map((service) => service.name).filter(Boolean) || []
  const multiSelect = Boolean(context.business_brain.policies.sequence_enabled)
  const serviceValue =
    selectedServices.length > 0
      ? (multiSelect ? selectedServices.join(", ") : selectedServices[0])
      : decision.slot_updates?.service

  return buildExecutorResult({
    executor: "booking-service",
    decision,
    slot_updates: serviceValue
      ? {
          ...(queueState.attendee_name ? { attendee_name: queueState.attendee_name } : {}),
          ...(decision.slot_updates || {}),
          service: serviceValue,
        }
      : {
          ...(decision.slot_updates || {}),
          ...(queueState.attendee_name ? { attendee_name: queueState.attendee_name } : {}),
        },
    state_patch: {
      ...(snapshot.signals.contact_preference || decision.slot_updates?.customer_phone || decision.slot_updates?.customer_email
        ? {
            pending_contact_field: undefined,
            contact_preference: snapshot.signals.contact_preference || context.state.contact_preference,
          }
        : {}),
      pending_attendee_queue: queueState.remaining_queue,
      last_service_options: booking.service_options,
      service_selection_multi: multiSelect,
      pending_second_service_choice:
        Boolean((context.state.pending_second_service_choice || context.state.pending_template_choice) && !serviceValue),
    },
    action_options: booking.service_options,
    metadata: {
      attendee_name: queueState.attendee_name || null,
      service_names: selectedServices,
      multi_select: multiSelect,
    },
  })
}

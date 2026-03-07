// @ts-nocheck
import { getServicesTotalDurationOrFallback } from "../services.ts"
import { getOtherStaffOptions } from "../staff.ts"
import { planSequentialBooking } from "./sequence-planner.ts"
import type {
  SemanticCompletedBookingDraft,
  SemanticDecisionResult,
  SemanticPostConfirmationPlan,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"

function getServiceNames(
  snapshot: TurnSemanticSnapshot,
  decision: SemanticDecisionResult,
  context: SemanticTurnContext
): string[] {
  const fromSnapshot = snapshot.entities.services?.map((service) => service.name).filter(Boolean) || []
  if (fromSnapshot.length > 0) return fromSnapshot
  const serviceValue = decision.slot_updates?.service || context.state.slots?.service
  if (!serviceValue) return []
  return String(serviceValue)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

export function buildCompletedBookingDraft(
  snapshot: TurnSemanticSnapshot,
  decision: SemanticDecisionResult,
  context: SemanticTurnContext
): SemanticCompletedBookingDraft {
  const serviceNames = getServiceNames(snapshot, decision, context)
  const serviceValue = serviceNames.join(", ") || decision.slot_updates?.service || context.state.slots?.service
  const attendeeName =
    decision.slot_updates?.attendee_name ||
    snapshot.entities.attendee_names?.[0] ||
    context.state.slots?.attendee_name ||
    context.state.slots?.customer_name
  const date = decision.slot_updates?.date || snapshot.entities.date?.iso_date || context.state.slots?.date
  const time = decision.slot_updates?.time || snapshot.entities.time?.hhmm || context.state.slots?.time
  const staffName = context.state.slots?.staff_name
  const durationMinutes = serviceValue
    ? getServicesTotalDurationOrFallback(context.business_brain.raw_config, serviceValue)
    : undefined
  return {
    attendee_name: attendeeName,
    service: serviceValue,
    service_names: serviceNames,
    duration_minutes: durationMinutes ?? undefined,
    date,
    time,
    staff_name: staffName,
    customer_phone: context.state.slots?.customer_phone,
    customer_email: context.state.slots?.customer_email,
    contact_delivery: context.state.contact_preference === "skip_primary" ? "primary" : "own",
  }
}

export function buildPostConfirmationPlan(
  context: SemanticTurnContext,
  snapshot: TurnSemanticSnapshot,
  completedBooking?: SemanticCompletedBookingDraft
): SemanticPostConfirmationPlan {
  const existingCompleted = context.state.completed_bookings?.length || 0
  const remainingQueue = Array.isArray(context.state.pending_attendee_queue)
    ? context.state.pending_attendee_queue.filter(Boolean)
    : []
  const inferredTotal =
    snapshot.signals.additional_count && snapshot.signals.additional_count > 0
      ? snapshot.signals.additional_count + (snapshot.signals.includes_self ? 1 : 0)
      : undefined
  const anchorBooking =
    (Array.isArray(context.state.completed_bookings) && context.state.completed_bookings.length > 0
      ? context.state.completed_bookings[context.state.completed_bookings.length - 1]
      : undefined) ||
    context.state.last_booking ||
    undefined
  const hasOtherStaff = anchorBooking?.staff_name
    ? getOtherStaffOptions(context.business_brain.raw_config, anchorBooking.staff_name).length > 0
    : false
  const nextActionOptions = remainingQueue.length > 0
    ? [
        "Mesmo dia e colaborador (proximo horario)",
        ...(hasOtherStaff ? ["Mesmo horario com outro colaborador"] : []),
        "Outro horario no mesmo dia",
        "Outro dia",
      ]
    : undefined
  const defaultNextService =
    context.state.pending_default_service ||
    completedBooking?.service ||
    context.state.slots?.service
  const sequenceSuggestion =
    remainingQueue.length > 0
      ? planSequentialBooking(
          context.business_brain,
          context.state,
          completedBooking || (anchorBooking as SemanticCompletedBookingDraft | undefined),
          defaultNextService
        )
      : undefined
  return {
    has_more_people: remainingQueue.length > 0 || (context.state.pending_additional_count || 0) > 0,
    next_attendee_name: remainingQueue[0],
    remaining_queue: remainingQueue,
    expected_total_people: inferredTotal,
    completed_count_after_confirmation: existingCompleted + 1,
    next_action_options: nextActionOptions,
    should_offer_sequence_template: Boolean(remainingQueue[0]),
    suggested_next_date: sequenceSuggestion?.suggested_date,
    suggested_next_time: sequenceSuggestion?.suggested_time,
    suggested_next_staff_name: sequenceSuggestion?.suggested_staff_name,
  }
}

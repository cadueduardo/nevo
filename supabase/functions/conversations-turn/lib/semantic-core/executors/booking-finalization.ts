// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { buildCompletedBookingDraft, buildPostConfirmationPlan } from "../booking-lifecycle.ts"
import { addBookedSlot, resetSlotsForNextBooking } from "../../state.ts"
import { getScheduleForStaff } from "../../staff.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingFinalization(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const completedBooking = buildCompletedBookingDraft(snapshot, decision, context)
  const postConfirmationPlan = buildPostConfirmationPlan(context, snapshot, completedBooking)
  const completedBookings = [...(context.state.completed_bookings || []), completedBooking]
  const schedule = getScheduleForStaff(context.business_brain.raw_config, completedBooking.staff_name)
  const intervalMinutes = schedule?.interval_minutes ?? 30
  const bookedSlots = addBookedSlot(
    context.state.booked_slots,
    completedBooking.staff_name,
    completedBooking.date,
    completedBooking.time,
    completedBooking.duration_minutes ?? undefined,
    intervalMinutes
  )
  const baseResetSlots = resetSlotsForNextBooking(context.state)
  const nextSlots = postConfirmationPlan.has_more_people
    ? {
        ...baseResetSlots,
        attendee_name: postConfirmationPlan.next_attendee_name,
        customer_name: context.state.slots?.customer_name,
      }
    : baseResetSlots

  return buildExecutorResult({
    executor: "booking-finalization",
    decision,
    state_patch: {
      completed_bookings: completedBookings,
      booked_slots: bookedSlots,
      last_booking: {
        attendee_name: completedBooking.attendee_name,
        service: completedBooking.service,
        date: completedBooking.date,
        time: completedBooking.time,
        staff_name: completedBooking.staff_name,
      },
      pending_additional_booking: postConfirmationPlan.has_more_people,
      pending_attendee_queue: postConfirmationPlan.remaining_queue.slice(1),
      pending_attendee_name: postConfirmationPlan.has_more_people && !postConfirmationPlan.next_attendee_name,
      pending_template_choice: Boolean(
        postConfirmationPlan.has_more_people && postConfirmationPlan.next_attendee_name
      ),
      pending_second_service_choice: false,
      pending_final_confirmation: !postConfirmationPlan.has_more_people,
      pending_calendar_offer: Boolean(postConfirmationPlan.should_offer_calendar),
      last_confirm_options: postConfirmationPlan.has_more_people
        ? postConfirmationPlan.next_action_options
        : ["Confirmar agendamento"],
      last_template_options: postConfirmationPlan.has_more_people
        ? postConfirmationPlan.next_action_options
        : undefined,
      service_selection_multi: false,
      contact_preference: postConfirmationPlan.has_more_people ? undefined : context.state.contact_preference,
      outbound_notifications: postConfirmationPlan.outbound_notifications,
      slots: nextSlots,
    },
    metadata: {
      attendee_name: completedBooking.attendee_name || null,
      service_names: completedBooking.service_names,
      date: completedBooking.date || null,
      time: completedBooking.time || null,
      completed_booking: completedBooking,
      post_confirmation_plan: postConfirmationPlan,
    },
    action_options: postConfirmationPlan.has_more_people
      ? postConfirmationPlan.next_action_options
      : ["Confirmar agendamento"],
  })
}

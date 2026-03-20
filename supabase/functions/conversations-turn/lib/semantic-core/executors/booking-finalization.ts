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
import { isNo, isYes } from "../../detection.ts"

export function executeBookingFinalization(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const waitingFinalConfirmation = context.state.pending_final_confirmation === true
  const rawMsg = snapshot.meta.raw_user_message || ""
  const explicitConfirmation = isYes(rawMsg) || /\bconfirm(ar|o|ado)?\b/i.test(rawMsg)
  const autoFinalizeFromContactReply = Boolean(
    !waitingFinalConfirmation &&
      context.state.pending_contact_field === "contact_preference" &&
      (snapshot.signals.contact_preference ||
        snapshot.signals.contact_phone ||
        snapshot.signals.contact_email ||
        context.state.contact_preference ||
        context.state.slots?.customer_phone ||
        context.state.slots?.customer_email)
  )
  const pendingDraft = buildCompletedBookingDraft(snapshot, decision, context)
  const pendingSlots = Object.fromEntries(
    Object.entries({
      attendee_name: pendingDraft.attendee_name,
      service: pendingDraft.service,
      date: pendingDraft.date,
      time: pendingDraft.time,
      staff_name: pendingDraft.staff_name,
      customer_phone: pendingDraft.customer_phone,
      customer_email: pendingDraft.customer_email,
    }).filter(([, value]) => value !== undefined)
  )

  // Etapa 1: quando chegamos no "confirm_booking", primeiro perguntamos se o cliente realmente
  // quer confirmar. Só na próxima resposta "sim" é que o agendamento é finalizado.
  if (!waitingFinalConfirmation && !explicitConfirmation && !autoFinalizeFromContactReply) {
    return buildExecutorResult({
      executor: "booking-finalization",
      decision,
      state_patch: {
        pending_final_confirmation: true,
        slots: pendingSlots,
        // Ainda não faz sentido oferecer calendário antes do agendamento ser confirmado.
        pending_calendar_offer: false,
        last_confirm_options: ["Confirmar agendamento"],
      },
      // A UI do simulador usa ação-option para o usuário responder facilmente.
      action_options: ["Confirmar agendamento"],
      metadata: {},
    })
  }

  // Etapa 2: aguardando confirmação do cliente.
  // Se o cliente negar, desfaz a pendência e volta a permitir escolher outro horário/continuidade.
  if (isNo(rawMsg)) {
    return buildExecutorResult({
      executor: "booking-finalization",
      decision,
      state_patch: {
        pending_final_confirmation: false,
        pending_calendar_offer: false,
      },
      action_options: ["Quero agendar"],
      metadata: {},
    })
  }

  // Se o cliente não confirmou claramente, manter o estado pedindo a confirmação.
  if (!explicitConfirmation && !autoFinalizeFromContactReply) {
    return buildExecutorResult({
      executor: "booking-finalization",
      decision,
      state_patch: {
        pending_final_confirmation: true,
        slots: pendingSlots,
      },
      action_options: ["Confirmar agendamento"],
      metadata: {},
    })
  }

  const completedBooking = buildCompletedBookingDraft(snapshot, decision, context)
  const postConfirmationPlan = buildPostConfirmationPlan(context, snapshot, completedBooking)
  const completedBookings = [...(context.state.completed_bookings || []), completedBooking]
  const primaryPhone = String((completedBookings[0] as any)?.customer_phone || "").replace(/\D+/g, "")
  const completedPhone = String((completedBooking as any)?.customer_phone || "").replace(/\D+/g, "")
  const needsSecondaryContact =
    !postConfirmationPlan.has_more_people &&
    completedBookings.length >= 2 &&
    // só faz sentido se o agendamento atual não tem telefone próprio e é para outra pessoa
    !completedPhone &&
    String(completedBooking?.attendee_name || "").trim() &&
    String((completedBookings[0] as any)?.attendee_name || "").trim() &&
    String(completedBooking.attendee_name).trim().toLowerCase() !== String((completedBookings[0] as any)?.attendee_name).trim().toLowerCase() &&
    // se já houve notificação planejada, não pedir de novo
    (postConfirmationPlan.outbound_notifications || []).length === 0 &&
    // se o telefone do titular não existe, primeiro precisa coletar o contato principal
    Boolean(primaryPhone)
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
  const clearedBookingSlots = {
    attendee_name: undefined,
    service: undefined,
    date: undefined,
    time: undefined,
    staff_name: undefined,
  }
  const nextSlots = postConfirmationPlan.has_more_people
    ? {
        ...clearedBookingSlots,
        ...baseResetSlots,
        attendee_name: postConfirmationPlan.next_attendee_name,
        customer_name: context.state.slots?.customer_name,
      }
    : {
        ...clearedBookingSlots,
        ...baseResetSlots,
      }

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
      pending_final_confirmation: false,
      pending_calendar_offer: needsSecondaryContact ? false : Boolean(postConfirmationPlan.should_offer_calendar),
      last_confirm_options: postConfirmationPlan.has_more_people
        ? postConfirmationPlan.next_action_options
        : ["Confirmar agendamento"],
      last_template_options: postConfirmationPlan.has_more_people
        ? postConfirmationPlan.next_action_options
        : undefined,
      service_selection_multi: false,
      contact_preference: postConfirmationPlan.has_more_people ? context.state.contact_preference : undefined,
      outbound_notifications: postConfirmationPlan.outbound_notifications,
      pending_secondary_contact: needsSecondaryContact
        ? {
            attendee_name: completedBooking.attendee_name,
            service: completedBooking.service,
            date: completedBooking.date,
            time: completedBooking.time,
          }
        : undefined,
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

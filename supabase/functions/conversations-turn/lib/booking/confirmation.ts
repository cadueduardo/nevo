// @ts-nocheck
/** Handler: confirmação final e opções último confirm (outro horário, outro dia, trocar colaborador). */
import type { SimulatorResult } from "../types.ts"
import { buildResult, resetSlotsForNextBooking, addBookedSlot } from "../state.ts"
import { buildFinalBookingMessage } from "../calendar.ts"
import { buildFinalThanksMessage } from "../builders.ts"
import { getScheduleForStaff, getStaffList } from "../staff.ts"
import { getMockAvailability } from "../utils.ts"
import { getServicesTotalDuration } from "../services.ts"
import { resolveOptionByNumber } from "../utils.ts"
import { isDonePhrase, isConfirmAction, isYes, isNo } from "../detection.ts"
import type { BookingContext } from "./context.ts"

export async function handleConfirmation(ctx: BookingContext): Promise<SimulatorResult | null> {
  const { config, text, state, nextState, toNumberedOptions, bookingComplete } = ctx

  const isConfirm =
    isDonePhrase(text) ||
    (text.trim() === "1" && Array.isArray(state.last_confirm_options) && state.last_confirm_options.length > 0)

  if (
    !state.pending_template_choice &&
    !state.pending_second_service_choice &&
    !state.pending_final_confirmation &&
    !state.final_thanks_sent &&
    isConfirm &&
    bookingComplete
  ) {
    nextState.booked_slots = addBookedSlot(
      nextState.booked_slots,
      nextState.slots.staff_name,
      nextState.slots.date,
      nextState.slots.time
    )
    if (!nextState.completed_bookings) nextState.completed_bookings = []
    nextState.completed_bookings.push({
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
    })
    const finalResult = await buildFinalBookingMessage({
      config,
      service: nextState.slots.service,
      staffName: nextState.slots.staff_name,
      dateIso: nextState.slots.date,
      time: nextState.slots.time,
    })
    nextState.final_thanks_sent = true
    nextState.slots = resetSlotsForNextBooking(nextState)
    return buildResult(finalResult.message, nextState)
  }

  const isConfirmShort =
    isDonePhrase(text) ||
    (text.trim() === "1" && Array.isArray(state.last_confirm_options) && state.last_confirm_options.length > 0)
  if (
    !state.pending_template_choice &&
    !state.pending_second_service_choice &&
    !state.pending_final_confirmation &&
    !state.final_thanks_sent &&
    isConfirmShort
  ) {
    const bookings = nextState.completed_bookings || []
    if (bookings.length > 0) {
      nextState.final_thanks_sent = true
      nextState.completed_bookings = []
      return buildResult(buildFinalThanksMessage(config.business_name, bookings), nextState)
    }
  }

  if (state.pending_final_confirmation) {
    if (isConfirmAction(text) || isYes(text)) {
      nextState.pending_final_confirmation = false
      nextState.pending_additional_booking = false
      nextState.pending_additional_count = 0
      return buildResult("Perfeito! Agendamentos confirmados. Precisa de mais alguma coisa?", nextState)
    }
    if (isNo(text)) {
      nextState.pending_final_confirmation = false
      return buildResult("Tudo bem! O que voce quer ajustar nos agendamentos?", nextState)
    }
  }

  const lastConfirm = state.last_confirm_options
  if (lastConfirm?.length && bookingComplete) {
    const choiceNum = resolveOptionByNumber(text, lastConfirm)
    if (choiceNum && !choiceNum.startsWith("Sim")) {
      nextState.last_confirm_options = undefined
      const last = nextState.last_booking
      if (choiceNum.includes("Outro horario") && last?.date && last?.staff_name) {
        const schedule = getScheduleForStaff(config, last.staff_name)
        const serviceDuration = getServicesTotalDuration(config, nextState.slots.service)
        const availability = last.date
          ? getMockAvailability(last.date, schedule, nextState.booked_slots, last.staff_name, serviceDuration ?? 30)
          : { available: [] as string[], occupied: [] as string[] }
        if (availability.available.length) {
          nextState.slots.date = last.date
          nextState.slots.staff_name = last.staff_name
          nextState.last_time_options = availability.available.slice(0, 24)
          nextState.last_time_options_date = last.date
          nextState.last_time_options_staff = last.staff_name
          return buildResult(
            "Qual horario voce prefere no mesmo dia?",
            nextState,
            toNumberedOptions(availability.available.slice(0, 24))
          )
        }
      }
      if (choiceNum.includes("Outro dia")) {
        nextState.slots.date = undefined
        nextState.slots.time = undefined
        return buildResult("Qual dia voce prefere?", nextState)
      }
      if (choiceNum.includes("Trocar colaborador") || choiceNum.includes("colaborador")) {
        nextState.slots.staff_name = undefined
        const staffOptions = [...getStaffList(config).map((s) => s.name), "Tanto faz"]
        return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
          ...toNumberedOptions(staffOptions),
        ])
      }
    }
  }

  return null
}

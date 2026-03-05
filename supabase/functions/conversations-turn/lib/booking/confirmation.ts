// @ts-nocheck
/** Handler: confirmação final e opções último confirm (outro horário, outro dia, trocar colaborador). */
import type { SimulatorResult } from "../types.ts"
import { buildResult, resetSlotsForNextBooking, addBookedSlot } from "../state.ts"
import { buildCalendarLinkForBooking, formatEstablishmentAddress } from "../calendar.ts"
import { getScheduleForStaff, getStaffList } from "../staff.ts"
import { getMockAvailability, formatDatePt } from "../utils.ts"
import { getServicesTotalDuration } from "../services.ts"
import { resolveOptionByNumber } from "../utils.ts"
import { isDonePhrase, isConfirmAction, isYes, isNo } from "../detection.ts"
import type { BookingContext } from "./context.ts"

export async function handleConfirmation(ctx: BookingContext): Promise<SimulatorResult | null> {
  const { config, text, state, nextState, toNumberedOptions, bookingComplete } = ctx

  if (state.pending_calendar_offer) {
    const picked = Array.isArray(state.last_action_options)
      ? resolveOptionByNumber(text, state.last_action_options)
      : null
    const norm = String(text || "").toLowerCase()
    const wantsCalendar =
      (picked ? /adicionar.*calend/.test(picked.toLowerCase()) : false) ||
      /adicionar.*calend|quero.*calend|sim\b|^1$/.test(norm)
    const doesntWantCalendar =
      (picked ? /nao|não/.test(picked.toLowerCase()) : false) ||
      /^2$/.test(norm) ||
      isNo(text)
    if (wantsCalendar) {
      const bookings = (nextState.completed_bookings || []).filter((b) => b?.date && b?.time)
      const linkLines: string[] = []
      for (const b of bookings) {
        const link = await buildCalendarLinkForBooking({
          config,
          attendeeName: (b as any).attendee_name,
          service: (b as any).service,
          staffName: (b as any).staff_name,
          dateIso: (b as any).date,
          time: (b as any).time,
        })
        if (link.calendar_url) {
          linkLines.push(`${link.label}: ${link.calendar_url}`)
        }
      }
      nextState.pending_calendar_offer = false
      nextState.final_thanks_sent = true
      nextState.last_action_options = undefined
      nextState.outgoing_assistant_messages = linkLines.map((line) => ({ content: line }))
      if (linkLines.length > 0) {
        return buildResult("Perfeito! Seguem os links para adicionar no calendario:", nextState)
      }
      return buildResult("Nao consegui gerar os links de calendario agora. Posso te ajudar com algo mais?", nextState)
    }
    if (doesntWantCalendar) {
      nextState.pending_calendar_offer = false
      nextState.final_thanks_sent = true
      return buildResult("Perfeito! Se precisar de algo mais, estou a disposicao.", nextState)
    }
    return buildResult(
      "Deseja adicionar no calendario?",
      nextState,
      ["Adicionar no calendario", "Nao, obrigado"]
    )
  }

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
    const confirmDuration = getServicesTotalDuration(config, nextState.slots.service)
    const confirmSchedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const confirmInterval = confirmSchedule?.interval_minutes ?? 30
    nextState.booked_slots = addBookedSlot(
      nextState.booked_slots,
      nextState.slots.staff_name,
      nextState.slots.date,
      nextState.slots.time,
      confirmDuration ?? undefined,
      confirmInterval
    )
    if (!nextState.completed_bookings) nextState.completed_bookings = []
    nextState.completed_bookings.push({
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
      customer_phone: nextState.slots.customer_phone,
      customer_email: nextState.slots.customer_email,
    })
    const dateLabel = nextState.slots.date ? formatDatePt(nextState.slots.date) : ""
    const timeLabel = nextState.slots.time || ""
    const serviceLabel = nextState.slots.service || "atendimento"
    const address = formatEstablishmentAddress(config)
    const addressLine = address ? `\nEndereco: ${address}` : ""
    nextState.pending_calendar_offer = true
    nextState.slots = resetSlotsForNextBooking(nextState)
    return buildResult(
      `Perfeito! Seu agendamento de ${serviceLabel} ficou confirmado para ${dateLabel} as ${timeLabel}.${addressLine}\n\nGostaria de adicionar este compromisso no seu calendario?`,
      nextState,
      ["Adicionar no calendario", "Nao, obrigado"]
    )
  }

  if (state.pending_final_confirmation) {
    if (isConfirmAction(text) || isYes(text)) {
      nextState.pending_final_confirmation = false
      nextState.pending_additional_booking = false
      nextState.pending_additional_count = 0
      nextState.pending_calendar_offer = true
      const address = formatEstablishmentAddress(config)
      const addressLine = address ? `\nEndereco: ${address}` : ""
      return buildResult(
        `Perfeito! Agendamentos confirmados com sucesso.${addressLine}\n\nGostaria de adicionar os compromissos no seu calendario?`,
        nextState,
        ["Adicionar no calendario", "Nao, obrigado"]
      )
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

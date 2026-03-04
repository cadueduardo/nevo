// @ts-nocheck
/** Handler: sequence_booking/service fallbacks (mutate), horário (parseTime, last_time_options), disponibilidade, time_period, pending_suggested_time. */
import type { SimulatorResult } from "../types.ts"
import { buildResult } from "../state.ts"
import { buildAvailabilityForDateMessage, buildDayNotServedMessage } from "../builders.ts"
import { getScheduleForStaff, getOtherStaffOptions } from "../staff.ts"
import {
  parseTime,
  parseTimePeriod,
  parseDateOrWeekday,
  getTodayIsoBusinessTz,
  addDaysToIsoDate,
  formatDatePt,
  getWeekdayKey,
  getMockAvailability,
  isWithinSchedule,
  isTimeTooSoonForDate,
  isBusinessClosedForToday,
  MIN_BOOKING_LEAD_MINUTES,
} from "../utils.ts"
import { isYes, isNo, isAvailabilityQuestion } from "../detection.ts"
import { findServicesFromText, findServiceFromText, getServicesTotalDuration } from "../services.ts"
import { isVisitRequest } from "../detection.ts"
import type { BookingContext } from "./context.ts"

export async function handleTimeAndAvailability(ctx: BookingContext): Promise<SimulatorResult | null> {
  const { config, text, state, nextState, toNumberedOptions, getOtherDayOptions } = ctx

  if (config.allow_sequence_booking) {
    const eligibleForSequence =
      (config.sequence_eligible_services?.length ?? 0) > 0
        ? config.sequence_eligible_services || []
        : (config.services || []).map((s) => s.name).filter(Boolean)
    const mentionedMultiple = findServicesFromText(text, config.services || [], eligibleForSequence)
    if (mentionedMultiple.length >= 2 && (!nextState.slots.date || !nextState.slots.time)) {
      nextState.slots.service = mentionedMultiple.join(", ")
      nextState.just_identified_service = true
    }
  }

  if (!nextState.slots.service) {
    if (isVisitRequest(text)) {
      nextState.slots.service = "Visita"
    } else if (config.services && config.services.length === 1) {
      nextState.slots.service = config.services[0].name
    } else if (config.allow_sequence_booking) {
      const eligibleForSequence =
        (config.sequence_eligible_services?.length ?? 0) > 0
          ? config.sequence_eligible_services || []
          : (config.services || []).map((s) => s.name).filter(Boolean)
      const multiple = findServicesFromText(text, config.services || [], eligibleForSequence)
      if (multiple.length > 0) {
        nextState.slots.service = multiple.join(", ")
      } else {
        const service = findServiceFromText(text, config.services || [])
        if (service) nextState.slots.service = service
      }
    } else {
      const service = findServiceFromText(text, config.services || [])
      if (service) nextState.slots.service = service
    }
  }

  if (!nextState.slots.time) {
    const time = parseTime(text)
    if (time) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const start = schedule?.start_time || "09:00"
      const end = schedule?.end_time || "18:00"
      let options: string[] | undefined =
        Array.isArray(state.last_time_options) && state.last_time_options.length > 0
          ? state.last_time_options
          : undefined
      if (!options && nextState.slots.date) {
        const serviceDuration = getServicesTotalDuration(
          config,
          nextState.slots.service || nextState.pending_default_service
        )
        const availability = getMockAvailability(
          nextState.slots.date,
          schedule,
          nextState.booked_slots,
          nextState.slots.staff_name,
          serviceDuration
        )
        if (availability.available.length > 0) options = availability.available.slice(0, 24)
      }
      const minLead = schedule?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
      if (nextState.slots.date === getTodayIsoBusinessTz() && isTimeTooSoonForDate(nextState.slots.date, time, minLead)) {
        const msg =
          `Este horario nao pode ser agendado agora. Trabalhamos com antecedencia minima de ${minLead} minutos. Qual horario voce prefere?`
        return buildResult(msg, nextState, options ? toNumberedOptions(options) : undefined)
      }
      const within = isWithinSchedule(time, schedule)
      if (!within.ok) {
        const msg =
          `Nosso horário de atendimento é das ${start} às ${end}. Só estão disponíveis as opções que te listei. Qual horário você prefere?`
        return buildResult(msg, nextState, options ? toNumberedOptions(options) : undefined)
      }
      nextState.slots.time = time
    }
  }

  if (!nextState.slots.time_period) {
    const period = parseTimePeriod(text)
    if (period) nextState.slots.time_period = period
  }

  if (state.pending_suggested_time && isYes(text)) {
    nextState.slots.time = state.pending_suggested_time
    nextState.pending_suggested_time = undefined
  } else if (state.pending_suggested_time && isNo(text)) {
    nextState.pending_suggested_time = undefined
  }

  if (isAvailabilityQuestion(text)) {
    if (!nextState.slots.date) {
      const dateFromMsg = parseDateOrWeekday(text)
      if (dateFromMsg) {
        const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
        const allowedDays = schedule?.days_of_week
        if (allowedDays && allowedDays.length > 0 && !allowedDays.includes(getWeekdayKey(dateFromMsg))) {
          const { message, action_options } = buildDayNotServedMessage(
            getWeekdayKey(dateFromMsg),
            allowedDays,
            schedule
          )
          return buildResult(message, nextState, action_options)
        }
        const serviceDuration = getServicesTotalDuration(
          config,
          nextState.slots.service || nextState.pending_default_service
        )
        const availability = getMockAvailability(
          dateFromMsg,
          schedule,
          nextState.booked_slots,
          nextState.slots.staff_name,
          serviceDuration
        )
        const todayIso = getTodayIsoBusinessTz()
        const tomorrowIso = addDaysToIsoDate(todayIso, 1)
        const dateLabel =
          dateFromMsg === todayIso
            ? "hoje"
            : dateFromMsg === tomorrowIso
              ? "amanha"
              : `em ${formatDatePt(dateFromMsg)}`
        if (availability.available.length > 0) {
          nextState.slots.date = dateFromMsg
          nextState.last_time_options = availability.available.slice(0, 24)
          nextState.last_time_options_date = dateFromMsg
          nextState.last_time_options_staff = nextState.slots.staff_name
          const msg = buildAvailabilityForDateMessage(dateLabel, availability.available.slice(0, 24), true)
          return buildResult(msg, nextState, toNumberedOptions(availability.available.slice(0, 24)))
        }
        const msg = buildAvailabilityForDateMessage(dateLabel, [], false)
        const dayOpts = allowedDays && allowedDays.length > 0 ? getOtherDayOptions(schedule) : ["Outro dia"]
        return buildResult(msg, nextState, dayOpts)
      }
      return buildResult("Pra eu ver os horarios, pra qual dia voce prefere?", nextState)
    }
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    )
    const availability = getMockAvailability(
      nextState.slots.date,
      schedule,
      nextState.booked_slots,
      nextState.slots.staff_name,
      serviceDuration
    )
    if (availability.available.length === 0) {
      const otherStaff = getOtherStaffOptions(config, nextState.slots.staff_name)
      const closedToday =
        nextState.slots.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
      const msg = closedToday
        ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : otherStaff.length > 0
          ? `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`
          : `Esse dia esta cheio. Quer tentar outro dia?`
      const options = closedToday
        ? [...getOtherDayOptions(schedule), ...otherStaff]
        : otherStaff.length > 0
          ? [...otherStaff, "Outro dia"]
          : ["Outro dia"]
      return buildResult(msg, nextState, options)
    }
    nextState.last_time_options = availability.available.slice(0, 24)
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    return buildResult(
      `Tenho estes horarios livres em ${formatDatePt(nextState.slots.date)}. Qual voce prefere?`,
      nextState,
      toNumberedOptions(availability.available.slice(0, 24))
    )
  }

  return null
}

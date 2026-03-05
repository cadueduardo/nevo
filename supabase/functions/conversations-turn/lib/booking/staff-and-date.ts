// @ts-nocheck
/** Handler: colaborador, data (parseDateOrWeekday, pending_date_confirmation, getOtherDayOptions, isDateBlocked), preço, "outro dia". */
import type { SimulatorResult } from "../types.ts"
import { buildResult } from "../state.ts"
import {
  getCordialPrefix,
  buildPriceNotAvailableMessage,
  buildDayNotServedMessage,
  buildDateBlockedMessage,
  getGreetingMessage,
} from "../builders.ts"
import {
  getScheduleForStaff,
  getStaffList,
  buildStaffDayOptions,
  resolveStaffFromText,
  isAnyStaffRequest,
} from "../staff.ts"
import {
  normalizeText,
  hasExplicitDate,
  parseDateOrWeekday,
  parseWeekdayDate,
  resolveOptionByNumber,
  formatDatePt,
  getTodayIsoBusinessTz,
  addDaysToIsoDate,
  getWeekdayKey,
  isBusinessClosedForToday,
} from "../utils.ts"
import { isYes, isNo, isGreeting, isPriceQuestion } from "../detection.ts"
import { findServiceFromText, getServiceWithPrice, classifyServiceMatch } from "../services.ts"
import { hasMatchContext } from "../qualification.ts"
import { generateRejectionMessageWithAI } from "../builders.ts"
import { isDateBlocked } from "../holidays.ts"
import { buildServicesListResult } from "../anytime-handlers.ts"
import type { BookingContext } from "./context.ts"

export async function handleStaffAndDate(ctx: BookingContext): Promise<SimulatorResult | null> {
  const { config, text, state, nextState, toNumberedOptions, getOtherDayOptions, waitingFor } = ctx

  const staffList = getStaffList(config)
  if (staffList.length === 1 && !nextState.slots.staff_name) {
    nextState.slots.staff_name = staffList[0].name
  }

  if (staffList.length > 1) {
    if (!nextState.slots.staff_name) {
      const staffOptions = [...staffList.map((s) => s.name), "Tanto faz"]
      const selectedByNumber = resolveOptionByNumber(text, staffOptions)
      const selected = resolveStaffFromText(text, staffList)
      if (selectedByNumber && selectedByNumber !== "Tanto faz") {
        nextState.slots.staff_name = selectedByNumber
      } else if (selected) {
        nextState.slots.staff_name = selected
      } else if (selectedByNumber === "Tanto faz" || isAnyStaffRequest(text)) {
        nextState.slots.staff_name = staffList[0].name
      }
    }

    if (!nextState.slots.staff_name) {
      const staffOptions = [...staffList.map((s) => s.name), "Tanto faz"]
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...toNumberedOptions(staffOptions),
      ])
    }

    if (!state.slots?.staff_name && nextState.slots.staff_name && nextState.slots.service && !nextState.slots.date) {
      if (isGreeting(text)) {
        return buildResult(getGreetingMessage(config), nextState)
      }
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const days = schedule?.days_of_week || []
      if (days.length > 0) {
        const daysLabel = days.map((d) => buildStaffDayOptions([d])[0]).join(", ")
        const dayOptions = buildStaffDayOptions(days)
        const intro =
          nextState.just_identified_service && nextState.slots.service
            ? `Entendi, voce precisa de ${nextState.slots.service}. `
            : ""
        nextState.just_identified_service = false
        return buildResult(
          `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel (${daysLabel}). Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
          nextState,
          toNumberedOptions(dayOptions)
        )
      }
      if (isBusinessClosedForToday(schedule) && (schedule?.days_of_week || []).length > 0) {
        return buildResult(
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
        )
      }
    }
  }

  // Se estamos aguardando data e o cliente informar uma data nova (ex: "amanha"),
  // ela deve sobrescrever qualquer data anterior para evitar loop em "outro dia".
  if (waitingFor === "date") {
    const explicitDateInput = parseDateOrWeekday(text)
    if (explicitDateInput) {
      nextState.slots.date = undefined
      nextState.slots.time = undefined
      nextState.pending_date_confirmation = undefined
    }
  }

  if (state.pending_date_confirmation) {
    const pendingDate = state.pending_date_confirmation
    const pendingDateLabel = formatDatePt(pendingDate)
    const pendingDateOptions = [`Sim, ${pendingDateLabel}`, "Outra data"]
    const dateConfirmationInput = resolveOptionByNumber(text, pendingDateOptions) || text
    const normalizedConfirmation = normalizeText(dateConfirmationInput).trim()
    const parsedDateFromConfirmation = parseDateOrWeekday(dateConfirmationInput)

    if (parsedDateFromConfirmation) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const usedWeekday = !hasExplicitDate(dateConfirmationInput) && parseWeekdayDate(dateConfirmationInput)
      let candidateDate = parsedDateFromConfirmation

      if (
        usedWeekday &&
        candidateDate === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        candidateDate = addDaysToIsoDate(candidateDate, 7)
      } else if (
        !usedWeekday &&
        candidateDate === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
        )
      }

      const blocked = await isDateBlocked(candidateDate, {
        holidays_attend: config.holidays_attend,
        closure_periods: config.closure_periods,
      })
      if (blocked.blocked) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          buildDateBlockedMessage(blocked.reason || "Essa data nao esta disponivel."),
          nextState,
          ["Outro dia"]
        )
      }

      if (usedWeekday) {
        nextState.pending_date_confirmation = candidateDate
        return buildResult(`Voce quis dizer ${formatDatePt(candidateDate)}?`, nextState, [
          `Sim, ${formatDatePt(candidateDate)}`,
          "Outra data",
        ])
      }

      nextState.slots.date = candidateDate
      nextState.pending_date_confirmation = undefined
    }

    if (isYes(dateConfirmationInput) || normalizedConfirmation === "s") {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const confirmedDate = pendingDate
      if (
        confirmedDate === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
        )
      }
      const blocked = await isDateBlocked(confirmedDate, {
        holidays_attend: config.holidays_attend,
        closure_periods: config.closure_periods,
      })
      if (blocked.blocked) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          buildDateBlockedMessage(blocked.reason || "Essa data nao esta disponivel."),
          nextState,
          ["Outro dia"]
        )
      }
      nextState.slots.date = confirmedDate
      nextState.pending_date_confirmation = undefined
    } else if (
      isNo(dateConfirmationInput) ||
      normalizedConfirmation === "n" ||
      normalizeText(dateConfirmationInput).includes("outra")
    ) {
      nextState.pending_date_confirmation = undefined
      return buildResult("Qual dia voce prefere?", nextState)
    }
  }

  if (normalizeText(text).includes("outro dia") || normalizeText(text).includes("outra data")) {
    nextState.slots.date = undefined
    nextState.slots.time = undefined
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    return buildResult("Qual dia voce prefere?", nextState, getOtherDayOptions(schedule))
  }

  if (isPriceQuestion(text)) {
    const cordial = getCordialPrefix(config, false)
    const serviceName = findServiceFromText(text, config.services || [])
    const svc = getServiceWithPrice(config.services || [], serviceName)
    if (serviceName && svc && svc.base_price != null) {
      nextState.slots.service = svc.name
      nextState.just_identified_service = true
      return buildResult(
        cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
        nextState,
        ["Quero agendar", "Só queria saber"]
      )
    }
    if (!serviceName && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }
    const withPrice = (config.services || []).filter((s) => s.base_price != null)
    if (withPrice.length > 0) {
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      nextState.last_service_options = serviceOptions
      return buildServicesListResult(config, nextState, cordial)
    }
    const noPrice = buildPriceNotAvailableMessage(config, serviceName || undefined)
    return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
  }

  const scheduleForDateCandidate = getScheduleForStaff(config, nextState.slots.staff_name)
  const rawDayOptionsForDateCandidate = buildStaffDayOptions(scheduleForDateCandidate?.days_of_week || [])
  const expectsDateInput = waitingFor === "date"
  const lastActionNormalized = (state.last_action_options || []).map((opt) =>
    normalizeText(String(opt || "").replace(/^\d+\s*-\s*/, "").trim())
  )
  const rawDayOptionsNormalized = rawDayOptionsForDateCandidate.map((opt) => normalizeText(opt))
  const isCurrentPromptDayOptions =
    rawDayOptionsForDateCandidate.length > 0 &&
    lastActionNormalized.length === rawDayOptionsNormalized.length &&
    rawDayOptionsNormalized.every((opt, idx) => lastActionNormalized[idx] === opt)
  const dateInputCandidate = expectsDateInput
    ? (isCurrentPromptDayOptions
        ? (resolveOptionByNumber(text, rawDayOptionsForDateCandidate) || text)
        : text)
    : text
  const dateCandidate = !nextState.slots.date ? parseDateOrWeekday(dateInputCandidate) : null

  if (!nextState.slots.date && !dateCandidate && nextState.slots.staff_name && nextState.slots.service) {
    if (isGreeting(text)) {
      return buildResult(getGreetingMessage(config), nextState)
    }
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const days = schedule?.days_of_week || []
    const dayOptions = buildStaffDayOptions(days)
    const daysLabel = days.length > 0 ? days.map((d) => buildStaffDayOptions([d])[0]).join(", ") : "segunda a sabado"
    const intro =
      nextState.just_identified_service && nextState.slots.service
        ? `Entendi, voce precisa de ${nextState.slots.service}. `
        : ""
    nextState.just_identified_service = false
    return buildResult(
      `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel (${daysLabel}). Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
      nextState,
      toNumberedOptions(dayOptions)
    )
  }

  if (!nextState.slots.date) {
    const scheduleForDate = getScheduleForStaff(config, nextState.slots.staff_name)
    const rawDayOptions = buildStaffDayOptions(scheduleForDate?.days_of_week || [])
    const rawDayOptionsNorm = rawDayOptions.map((opt) => normalizeText(opt))
    const isPromptDayOptions =
      rawDayOptions.length > 0 &&
      lastActionNormalized.length === rawDayOptionsNorm.length &&
      rawDayOptionsNorm.every((opt, idx) => lastActionNormalized[idx] === opt)
    const dateInput =
      expectsDateInput && isPromptDayOptions
        ? (resolveOptionByNumber(text, rawDayOptions) || text)
        : text
    const date = parseDateOrWeekday(dateInput)
    if (date) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const usedWeekday = !hasExplicitDate(dateInput) && parseWeekdayDate(dateInput)
      const allowedDays = schedule?.days_of_week

      if (allowedDays && allowedDays.length > 0) {
        const weekday = getWeekdayKey(date)
        if (!allowedDays.includes(weekday)) {
          const { message, action_options } = buildDayNotServedMessage(
            weekday,
            allowedDays,
            schedule
          )
          return buildResult(message, nextState, action_options)
        }
      }

      let resolvedDate = date
      if (
        usedWeekday &&
        date === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        resolvedDate = addDaysToIsoDate(date, 7)
      }
      if (
        !usedWeekday &&
        isBusinessClosedForToday(schedule) &&
        date === getTodayIsoBusinessTz()
      ) {
        nextState.slots.date = undefined
        const dayOptions = buildStaffDayOptions(schedule?.days_of_week || [])
        return buildResult(
          "Nosso expediente de hoje ja encerrou. Quer agendar para amanha ou outro dia?",
          nextState,
          dayOptions.length > 0 ? toNumberedOptions(dayOptions) : ["1 - Amanha", "2 - Outro dia"]
        )
      }
      if (usedWeekday && !state.pending_date_confirmation) {
        nextState.pending_date_confirmation = resolvedDate
        return buildResult(`Voce quis dizer ${formatDatePt(resolvedDate)}?`, nextState, [
          `Sim, ${formatDatePt(resolvedDate)}`,
          "Outra data",
        ])
      }
      const blocked = await isDateBlocked(resolvedDate, {
        holidays_attend: config.holidays_attend,
        closure_periods: config.closure_periods,
      })
      if (blocked.blocked) {
        return buildResult(
          buildDateBlockedMessage(blocked.reason || "Essa data nao esta disponivel."),
          nextState,
          ["Outro dia"]
        )
      }
      nextState.slots.date = resolvedDate
    }
  }

  return null
}

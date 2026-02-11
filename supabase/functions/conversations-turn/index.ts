// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  json,
  corsHeaders,
  createSupabaseAdmin,
  rewriteWithTone,
  normalizeText,
  toMinutes,
  fromMinutes,
  toIsoDate,
  formatDatePt,
  getWeekdayKey,
  hashString,
  pickVariant,
  parseTime,
  parseDate,
  parseWeekdayDate,
  parseTimePeriod,
  parseDateOrWeekday,
  parseEmail,
  parsePhone,
  hasExplicitDate,
  parseTemplateChoice,
  formatTimePeriod,
  buildDailySlots,
  applyBreaks,
  getMockAvailability,
  isWithinSchedule,
  isBusinessClosedForToday,
  getTodayIsoBusinessTz,
  isGreeting,
  isWhoAreYou,
  getGreetingByTime,
  isConfused,
  isFinalizedState,
  isPriceQuestion,
  isListServicesQuestion,
  isServiceDetailQuestion,
  isExplicitBookingIntent,
  isVisitRequest,
  isAvailabilityQuestion,
  isYes,
  isNo,
  isPoliteDecline,
  isDirectServiceInquiry,
  isConfirmAction,
  isDonePhrase,
  isThanksOrClosingPhrase,
  detectModeFromText,
  findServiceByExactMatch,
  findServiceFromText,
  findServicesFromText,
  getServiceWithPrice,
  getServiceDurationMinutes,
  getServicesTotalDuration,
  getServicesTotalPrice,
  getStaffList,
  resolveStaffFromText,
  isAnyStaffRequest,
  getScheduleForStaff,
  getOtherStaffOptions,
  buildStaffDayOptions,
  getNextAvailableSlot,
  getCordialPrefix,
  buildPriceNotAvailableMessage,
  buildDayNotServedMessage,
  buildDateBlockedMessage,
  buildServicesListWithPrices,
  buildGenericFallback,
  buildServiceOptions,
  buildServicePrompt,
  buildMultiBookingIntro,
  buildAdditionalBookingAfterCompletePrompt,
  buildSingleAdditionalPrompt,
  buildMultiBookingSummary,
  buildFinalThanksMessage,
  buildRejectionMessage,
  generateRejectionMessageWithAI,
  interpretFlowWithAI,
  interpretAdditionalBookingsWithAI,
  createSimulatorState,
  buildResult,
  resetSlotsForNextBooking,
  addDaysToIsoDate,
  addBookedSlot,
  buildCalendarIcs,
  uploadCalendarIcs,
  buildFinalBookingMessage,
  classifyServiceMatch,
  hasMatchContext,
  hasAdditionalBookings,
  applyAdditionalBookingState,
  handleShortDecline,
  tryAnswerInformationalQuestion,
  answerWithContextualAI,
  isDateBlocked,
} from "./lib/index.ts"
import type {
  ConversationTurnRequest,
  ConversationTurnResponse,
  SimulatorConfig,
  SimulatorState,
  SimulatorResult,
} from "./lib/index.ts"

// ---- funções movidas para lib/ ----
// Removido dead code: isAdditionalBookingRequest, extractCountFromText

async function resolveBooking(config: SimulatorConfig, text: string, state: SimulatorState): Promise<SimulatorResult> {
  const nextState: SimulatorState = {
    ...state,
    step: "booking",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
    completed_bookings: state.completed_bookings ? [...state.completed_bookings] : [],
  }
  const pref = nextState.contact_preference ?? state.contact_preference ?? "both"
  const hasPhone = Boolean(nextState.slots.customer_phone)
  const hasEmail = Boolean(nextState.slots.customer_email)
  const contactOk =
    pref === "phone"
      ? hasPhone
      : pref === "email"
        ? hasEmail
        : hasPhone && hasEmail
  const bookingComplete =
    Boolean(nextState.slots.service) &&
    Boolean(nextState.slots.date) &&
    Boolean(nextState.slots.time) &&
    Boolean(nextState.slots.customer_name) &&
    contactOk
  if (!state.pending_final_confirmation && !state.final_thanks_sent && isDonePhrase(text) && bookingComplete) {
    const finalResult = await buildFinalBookingMessage({
      config,
      service: nextState.slots.service,
      staffName: nextState.slots.staff_name,
      dateIso: nextState.slots.date,
      time: nextState.slots.time,
    })
    nextState.final_thanks_sent = true
    nextState.slots = resetSlotsForNextBooking(nextState)
    const actionOptions = finalResult.calendar_url
      ? [`open_url|Adicionar ao calendário|${finalResult.calendar_url}`]
      : undefined
    return buildResult(finalResult.message, nextState, actionOptions)
  }
  if (!state.pending_final_confirmation && !state.final_thanks_sent && isDonePhrase(text)) {
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

  const explicitService = findServiceFromText(text, config.services || [])
  const wasAdditionalPending = Boolean(state.pending_additional_booking || state.pending_additional_count)
  const cp = state.contact_preference ?? "both"
  const hasCompletedBooking =
    Boolean(state.slots?.service) &&
    Boolean(state.slots?.date) &&
    Boolean(state.slots?.time) &&
    Boolean(state.slots?.customer_name) &&
    (cp === "phone" ? Boolean(state.slots?.customer_phone) : cp === "email" ? Boolean(state.slots?.customer_email) : Boolean(state.slots?.customer_phone) && Boolean(state.slots?.customer_email))
  const interpretedAdditional = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: hasCompletedBooking })
  const interpretedCountRaw = typeof interpretedAdditional?.count === "number" ? interpretedAdditional.count : null
  const interpretedCount = interpretedCountRaw !== null ? Math.max(0, interpretedCountRaw) : null
  const interpretedHasAdditional =
    interpretedAdditional?.has_additional === true || (interpretedCount !== null && interpretedCount > 0)

  if (!nextState.slots.service) {
    if (explicitService) nextState.slots.service = explicitService
    else if (isVisitRequest(text)) nextState.slots.service = "visita"
    else if (nextState.pending_default_service && nextState.pending_default_service_locked)
      nextState.slots.service = nextState.pending_default_service
  }

  if (!nextState.pending_additional_count && !nextState.pending_additional_booking && interpretedHasAdditional) {
    nextState.pending_additional_booking = true
    nextState.pending_attendee_name = true
    nextState.pending_additional_count = interpretedCount && interpretedCount > 0 ? interpretedCount : 1
    if (nextState.expected_additional_count === undefined) {
      nextState.expected_additional_count = nextState.pending_additional_count
    }
    if (explicitService && !nextState.pending_default_service_locked) {
      nextState.pending_default_service = explicitService
      nextState.pending_default_service_locked = true
    }
  }

  if (nextState.pending_attendee_name) {
    const name = text.trim()
    if (!name || interpretedHasAdditional || isExplicitBookingIntent(text)) {
      return buildResult(`${buildMultiBookingIntro()} De quem sera o primeiro agendamento?`, nextState)
    }
    nextState.slots.attendee_name = name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = name
    nextState.pending_attendee_name = false
    if (nextState.last_booking && !nextState.pending_template_choice) {
      nextState.pending_template_choice = true
      const staffLabel = nextState.last_booking.staff_name ? ` da ${nextState.last_booking.staff_name}` : ""
      const dateLabel = nextState.last_booking.date ? formatDatePt(nextState.last_booking.date) : "esse dia"
      const hasOtherStaff = getOtherStaffOptions(config, nextState.last_booking.staff_name).length > 0
      const options = [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
        ...(hasOtherStaff ? ["Trocar colaborador"] : []),
      ]
      const optsText = hasOtherStaff
        ? "Prefere o proximo horario, outro horario no mesmo dia, outro dia ou trocar colaborador?"
        : "Prefere o proximo horario, outro horario no mesmo dia ou outro dia?"
      return buildResult(`Certo, para ${name}. Quer agendar tambem em ${dateLabel}${staffLabel}? ${optsText}`, nextState, options)
    }
    const staffList = getStaffList(config)
    if (staffList.length > 1) {
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...staffList.map((s) => s.name),
        "Tanto faz",
      ])
    }
    const prompt = buildServicePrompt(config, text, { attendee_name: nextState.slots.attendee_name })
    return buildResult(`Vamos la, ${name}. ${prompt.message}`, nextState, prompt.action_options)
  }

  if (nextState.pending_template_choice) {
    const choice = parseTemplateChoice(text)
    const last = nextState.last_booking
    if (choice && last) {
      nextState.pending_template_choice = false
      if (choice === "same_next") {
        const dateIso = last.date
        const staffName = last.staff_name
        const serviceForSlots = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceDuration = getServicesTotalDuration(config, serviceForSlots)
        const next = dateIso
          ? getNextAvailableSlot(dateIso, config, nextState.booked_slots, staffName, last.time, serviceDuration)
          : null
        if (!dateIso || !next) {
          const hasOtherStaff = getOtherStaffOptions(config, staffName).length > 0
          const msg = hasOtherStaff
            ? "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia ou trocar colaborador?"
            : "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia?"
          return buildResult(msg, nextState, [
            "Outro dia",
            ...(hasOtherStaff ? ["Trocar colaborador"] : []),
          ])
        }
        nextState.slots.date = dateIso
        nextState.slots.time = next
        nextState.slots.staff_name = staffName
        return buildResult(`Perfeito. Sugeri ${next} em ${formatDatePt(dateIso)}. Posso confirmar?`, nextState, [
          `Sim, ${next}`,
          "Outro horario no mesmo dia",
          "Outro dia",
          ...(getOtherStaffOptions(config, staffName).length > 0 ? ["Trocar colaborador"] : []),
        ])
      }
      if (choice === "same_day") {
        if (last.date) nextState.slots.date = last.date
        nextState.slots.staff_name = last.staff_name
        const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
        const serviceForSlots = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceDuration = getServicesTotalDuration(config, serviceForSlots)
        const availability = last.date
          ? getMockAvailability(last.date, schedule, nextState.booked_slots, nextState.slots.staff_name, serviceDuration)
          : { available: [], occupied: [] }
        if (!availability.available.length) {
          const closedToday =
            last.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
          const msg = closedToday
            ? "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?"
            : getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? "Esse dia esta cheio. Quer tentar outro dia ou trocar colaborador?"
              : "Esse dia esta cheio. Quer tentar outro dia?"
          return buildResult(msg, nextState, [
            "Outro dia",
            ...(getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? ["Trocar colaborador"]
              : []),
          ])
        }
        nextState.last_time_options = availability.available.slice(0, 8)
        nextState.last_time_options_date = nextState.slots.date
        nextState.last_time_options_staff = nextState.slots.staff_name
        return buildResult("Qual horario voce prefere no mesmo dia?", nextState, availability.available.slice(0, 8))
      }
      if (choice === "other_day") {
        nextState.slots.date = undefined
        nextState.slots.time = undefined
        return buildResult("Qual dia voce prefere?", nextState)
      }
      if (choice === "other_staff") {
        nextState.slots.staff_name = undefined
        return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
          ...getStaffList(config).map((s) => s.name),
          "Tanto faz",
        ])
      }
    }
  }

  const staffList = getStaffList(config)
  if (staffList.length === 1 && !nextState.slots.staff_name) {
    nextState.slots.staff_name = staffList[0].name
  }

  if (staffList.length > 1) {
    if (!nextState.slots.staff_name) {
      const selected = resolveStaffFromText(text, staffList)
      if (selected) {
        nextState.slots.staff_name = selected
      } else if (isAnyStaffRequest(text)) {
        nextState.slots.staff_name = staffList[0].name
      }
    }

    if (!nextState.slots.staff_name) {
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...staffList.map((s) => s.name),
        "Tanto faz",
      ])
    }

    if (!state.slots?.staff_name && nextState.slots.staff_name && nextState.slots.service && !nextState.slots.date) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const days = schedule?.days_of_week || []
      if (days.length > 0) {
        const daysLabel = days.map((d) => buildStaffDayOptions([d])[0]).join(", ")
        const intro =
          nextState.just_identified_service && nextState.slots.service
            ? `Entendi, voce precisa de ${nextState.slots.service}. `
            : ""
        nextState.just_identified_service = false
        return buildResult(
          `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel para atendimento de ${daysLabel}. Em qual dia voce gostaria de agendar?`,
          nextState,
          buildStaffDayOptions(days)
        )
      }
      if (isBusinessClosedForToday(schedule) && (schedule?.days_of_week || []).length > 0) {
        return buildResult(
          "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?",
          nextState,
          ["Sim, outro dia"]
        )
      }
    }
  }

  if (bookingComplete && (interpretedHasAdditional || (nextState.pending_additional_count || 0) > 0)) {
    let extraCount = interpretedCount && interpretedCount > 0 ? interpretedCount : 0
    if (!extraCount && interpretedHasAdditional) extraCount = 1
    nextState.last_booking = {
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
    }
    if (interpretedHasAdditional && !wasAdditionalPending) {
      nextState.pending_default_service = explicitService || undefined
      nextState.pending_default_service_locked = Boolean(explicitService)
    } else if (nextState.pending_default_service_locked && nextState.slots.service) {
      nextState.pending_default_service = nextState.slots.service
    }
    nextState.booked_slots = addBookedSlot(
      nextState.booked_slots,
      nextState.slots.staff_name,
      nextState.slots.date,
      nextState.slots.time
    )
    nextState.completed_bookings?.push({
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
    })
    nextState.pending_additional_count = extraCount
    nextState.pending_additional_booking = extraCount > 0
    if (nextState.expected_additional_count === undefined && extraCount > 0) {
      nextState.expected_additional_count = extraCount
    }
    nextState.slots = resetSlotsForNextBooking(nextState)
    nextState.pending_attendee_name = true
    return buildResult(extraCount > 0 ? buildAdditionalBookingAfterCompletePrompt() : buildSingleAdditionalPrompt(), nextState)
  }

  if (state.pending_date_confirmation) {
    if (isYes(text)) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const confirmedDate = state.pending_date_confirmation
      if (
        confirmedDate === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?",
          nextState,
          ["Sim, outro dia"]
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
    } else if (isNo(text) || normalizeText(text).includes("outra")) {
      nextState.pending_date_confirmation = undefined
      return buildResult("Qual dia voce prefere?", nextState)
    }
  }

  if (normalizeText(text).includes("outro dia") || normalizeText(text).includes("outra data")) {
    nextState.slots.date = undefined
    nextState.slots.time = undefined
    return buildResult("Qual dia voce prefere?", nextState)
  }

  const dateCandidate = !nextState.slots.date ? parseDateOrWeekday(text) : null
  if (!nextState.slots.date && !dateCandidate && nextState.slots.staff_name && nextState.slots.service) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const days = schedule?.days_of_week || []
    if (days.length > 0) {
      const daysLabel = days.map((d) => buildStaffDayOptions([d])[0]).join(", ")
      const intro =
        nextState.just_identified_service && nextState.slots.service
          ? `Entendi, voce precisa de ${nextState.slots.service}. `
          : ""
      nextState.just_identified_service = false
      return buildResult(
        `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel para atendimento de ${daysLabel}. Em qual dia voce gostaria de agendar?`,
        nextState,
        buildStaffDayOptions(days)
      )
    }
    if (isBusinessClosedForToday(schedule) && (schedule?.days_of_week || []).length > 0) {
      return buildResult(
        "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?",
        nextState,
        ["Sim, outro dia"]
      )
    }
  }

  if (state.pending_contact_field) {
    if (state.pending_contact_field === "name") {
      const name = text.trim()
      if (!name) {
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      nextState.slots.customer_name = name
      nextState.pending_contact_field = undefined
    } else if (state.pending_contact_field === "contact_preference") {
      const t = text.toLowerCase().trim()
      if (/(s[oó]|apenas)\s*celular|celular\s*apenas/.test(t)) {
        nextState.contact_preference = "phone"
        nextState.pending_contact_field = undefined
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      if (/(s[oó]|apenas)\s*email|email\s*apenas/.test(t)) {
        nextState.contact_preference = "email"
        nextState.pending_contact_field = undefined
        return buildResult("Qual seu email?", nextState)
      }
      if (/(ambos|celular\s*e\s*email|os\s*dois)/.test(t)) {
        nextState.contact_preference = "both"
        nextState.pending_contact_field = undefined
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      return buildResult(
        "Como prefere ser contatado? Escolha: Só celular, Só email ou Celular e email.",
        nextState,
        ["Só celular", "Só email", "Celular e email"]
      )
    } else if (state.pending_contact_field === "phone") {
      const phone = parsePhone(text)
      if (!phone) {
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      nextState.slots.customer_phone = phone
      nextState.pending_contact_field = undefined
    } else if (state.pending_contact_field === "email") {
      const email = parseEmail(text)
      if (!email) {
        return buildResult("Qual seu email?", nextState)
      }
      nextState.slots.customer_email = email
      nextState.pending_contact_field = undefined
    }
  }

  if (!nextState.slots.customer_email) {
    const email = parseEmail(text)
    if (email) nextState.slots.customer_email = email
  }
  if (!nextState.slots.customer_phone) {
    const phone = parsePhone(text)
    if (phone) nextState.slots.customer_phone = phone
  }

  if (!nextState.slots.service) {
    if (isVisitRequest(text)) {
      nextState.slots.service = "Visita"
    } else if (config.services && config.services.length === 1) {
      nextState.slots.service = config.services[0].name
    } else if (config.allow_sequence_booking && (config.sequence_eligible_services?.length ?? 0) > 0) {
      const multiple = findServicesFromText(text, config.services || [], config.sequence_eligible_services || [])
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

  if (!nextState.slots.date) {
    let date = parseDateOrWeekday(text)
    if (date) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const usedWeekday = !hasExplicitDate(text) && parseWeekdayDate(text)
      const allowedDays = schedule?.days_of_week

      // Dia da semana fora do expediente? Responder logo, sem pedir confirmação de data
      if (usedWeekday && allowedDays && allowedDays.length > 0) {
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

      if (
        usedWeekday &&
        date === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        date = addDaysToIsoDate(date, 7)
      } else if (
        !usedWeekday &&
        isBusinessClosedForToday(schedule) &&
        date === getTodayIsoBusinessTz()
      ) {
        nextState.slots.date = undefined
        return buildResult(
          "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?",
          nextState,
          ["Sim, outro dia"]
        )
      }
      if (usedWeekday && !state.pending_date_confirmation) {
        nextState.pending_date_confirmation = date
        return buildResult(`Voce quis dizer ${formatDatePt(date)}?`, nextState, [
          `Sim, ${formatDatePt(date)}`,
          "Outra data",
        ])
      }
      const blocked = await isDateBlocked(date, {
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
      nextState.slots.date = date
    }
  }

  if (!nextState.slots.time) {
    const time = parseTime(text)
    if (time) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const within = isWithinSchedule(time, schedule)
      if (!within.ok) {
        return buildResult(
          `Poxa, infelizmente nao consigo te atender nesse horario. ${within.reason} Qual horario voce prefere?`,
          nextState
        )
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
      const options = otherStaff.length > 0 ? [...otherStaff, "Outro dia"] : ["Outro dia"]
      const closedToday =
        nextState.slots.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
      const msg = closedToday
        ? "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?"
        : otherStaff.length > 0
          ? `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`
          : `Esse dia esta cheio. Quer tentar outro dia?`
      return buildResult(msg, nextState, options)
    }
    nextState.last_time_options = availability.available.slice(0, 8)
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    return buildResult(
      `Tenho estes horarios livres em ${formatDatePt(nextState.slots.date)}. Qual voce prefere?`,
      nextState,
      availability.available.slice(0, 8)
    )
  }

  if (!nextState.slots.service) {
    const prompt = buildServicePrompt(config, text, {
      date: nextState.slots.date,
      time: nextState.slots.time,
      time_period: nextState.slots.time_period,
      attendee_name: nextState.slots.attendee_name,
    })
    return buildResult(prompt.message, nextState, prompt.action_options)
  }

  if (!nextState.slots.date) {
    const prefix = nextState.slots.time
      ? `Anotei ${nextState.slots.service} no horario ${nextState.slots.time}. `
      : nextState.slots.time_period
        ? `Anotei ${nextState.slots.service} no periodo ${formatTimePeriod(nextState.slots.time_period)}. `
        : `Certo, ${nextState.slots.service}. `
    return buildResult(`${prefix}Qual dia voce prefere?`, nextState)
  }

  if (!nextState.slots.time) {
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
    const options = availability.available.slice(0, 8)
    if (availability.available.length === 0) {
      const otherStaff = getOtherStaffOptions(config, nextState.slots.staff_name)
      const optionList = otherStaff.length > 0 ? [...otherStaff, "Outro dia"] : ["Outro dia"]
      const closedToday =
        nextState.slots.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
      const msg = closedToday
        ? "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?"
        : otherStaff.length > 0
          ? `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`
          : `Esse dia esta cheio. Quer tentar outro dia?`
      return buildResult(msg, nextState, optionList)
    }
    nextState.last_time_options = options
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    if (nextState.slots.time_period) {
      return buildResult(
        `Perfeito, ${formatTimePeriod(nextState.slots.time_period)}. Qual horario voce prefere?`,
        nextState,
        options
      )
    }
    return buildResult("Qual horario voce prefere?", nextState, options)
  }

  const dateIso = nextState.slots.date
  const time = nextState.slots.time
  if (dateIso && time) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    )
    const availability = getMockAvailability(
      dateIso,
      schedule,
      nextState.booked_slots,
      nextState.slots.staff_name,
      serviceDuration
    )
    const isTimeFromLastOptions =
      Array.isArray(state.last_time_options) &&
      state.last_time_options.includes(time) &&
      state.last_time_options_date === dateIso &&
      state.last_time_options_staff === nextState.slots.staff_name
    if (availability.available.includes(time) || isTimeFromLastOptions) {
      if (!nextState.slots.customer_name) {
        nextState.pending_contact_field = "name"
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      const pref = nextState.contact_preference ?? state.contact_preference
      if (!pref) {
        nextState.pending_contact_field = "contact_preference"
        return buildResult(
          "Como prefere ser contatado para confirmar o agendamento?",
          nextState,
          ["Só celular", "Só email", "Celular e email"]
        )
      }
      const needsPhone = pref === "phone" || pref === "both"
      const needsEmail = pref === "email" || pref === "both"
      if (needsPhone && !nextState.slots.customer_phone) {
        nextState.pending_contact_field = "phone"
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      if (needsEmail && !nextState.slots.customer_email) {
        nextState.pending_contact_field = "email"
        return buildResult("Qual seu email?", nextState)
      }
      if (
        nextState.pending_additional_booking ||
        (nextState.pending_additional_count || 0) > 0 ||
        (nextState.expected_additional_count || 0) > 0
      ) {
        const completedService = nextState.slots.service
        const completedDate = nextState.slots.date
        const completedTime = nextState.slots.time
        nextState.last_booking = {
          service: completedService,
          date: completedDate,
          time: completedTime,
          staff_name: nextState.slots.staff_name,
        }
        if (nextState.pending_default_service_locked && completedService) {
          nextState.pending_default_service = completedService
        }
        nextState.booked_slots = addBookedSlot(
          nextState.booked_slots,
          nextState.slots.staff_name,
          completedDate,
          completedTime
        )
        nextState.completed_bookings?.push({
          attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
          service: completedService,
          date: completedDate,
          time: completedTime,
          staff_name: nextState.slots.staff_name,
        })
        nextState.pending_additional_booking = false
        if ((nextState.pending_additional_count || 0) > 0) {
          nextState.pending_additional_count = Math.max(0, (nextState.pending_additional_count || 0) - 1)
        }
        const expectedTotal =
          (nextState.expected_additional_count || 0) > 0 ? (nextState.expected_additional_count || 0) + 1 : 0
        const completedCount = nextState.completed_bookings?.length || 0
        if ((nextState.pending_additional_count || 0) > 0 || (expectedTotal > 0 && completedCount < expectedTotal)) {
          nextState.slots = resetSlotsForNextBooking(nextState)
          nextState.pending_attendee_name = true
          return buildResult(
            `Perfeito! Agendei ${completedService} para ${formatDatePt(
              completedDate || dateIso
            )} as ${completedTime || time}. Vamos agendar o proximo? De quem sera o proximo agendamento?`,
            nextState
          )
        }
        nextState.pending_final_confirmation = true
        const summary = buildMultiBookingSummary(nextState.completed_bookings || [])
        return buildResult(
          `${summary}\n\nPrecisa de mais alguma coisa?`,
          nextState,
          ["Confirmar agendamento"]
        )
      }
      nextState.booked_slots = addBookedSlot(nextState.booked_slots, nextState.slots.staff_name, dateIso, time)
      if (!nextState.completed_bookings) nextState.completed_bookings = []
      nextState.completed_bookings.push({
        attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
        service: nextState.slots.service,
        date: dateIso,
        time,
        staff_name: nextState.slots.staff_name,
      })
      const finalResult = await buildFinalBookingMessage({
        config,
        service: nextState.slots.service,
        staffName: nextState.slots.staff_name,
        dateIso,
        time,
      })
      nextState.final_thanks_sent = true
      nextState.slots = resetSlotsForNextBooking(nextState)
      const actionOptions = finalResult.calendar_url
        ? [`open_url|Adicionar ao calendário|${finalResult.calendar_url}`]
        : undefined
      return buildResult(finalResult.message, nextState, actionOptions)
    }

    const next = availability.available.find((slot) => slot > time) || availability.available[0]
    if (next) {
      nextState.pending_suggested_time = next
      nextState.slots.time = undefined
      return buildResult(`Esse horario esta ocupado. Posso te oferecer ${next} no mesmo dia?`, nextState)
    }
    const closedToday =
      dateIso === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
    return buildResult(
      closedToday
        ? "Ja encerramos nossas atividades por hoje. Gostaria de marcar outro dia?"
        : "Esse dia esta cheio. Quer tentar outro dia?",
      nextState
    )
  }

  return buildResult("Certo! Me diz o melhor dia e horario para voce.", nextState)
}

function resolveQuote(config: SimulatorConfig, text: string, state: SimulatorState): SimulatorResult {
  const nextState: SimulatorState = {
    ...state,
    step: "quote",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const variables = config.dynamic_variables?.filter((v) => !v.context || v.context === "quote") || []

  if (variables.length === 0) {
    if (state.step !== "quote_free_text") {
      nextState.step = "quote_free_text"
      return buildResult("Me conta os detalhes do que voce precisa para eu preparar o orcamento.", nextState)
    }
    return buildResult("Obrigado! Vou analisar e te retorno com o orcamento o quanto antes.", nextState)
  }

  if (state.pending_quote_key) {
    nextState.slots.quote_answers = {
      ...(nextState.slots.quote_answers || {}),
      [state.pending_quote_key]: text.trim(),
    }
    nextState.pending_quote_key = undefined
  }

  const nextVar = variables.find((v) => !nextState.slots.quote_answers?.[v.key])
  if (nextVar) {
    nextState.pending_quote_key = nextVar.key
    return buildResult(`${nextVar.label}?`, nextState)
  }

  return buildResult("Perfeito, obrigado! Vou analisar e te retorno com o orcamento.", nextState)
}

function isFirstMessage(state: SimulatorState & { _isFirstMessage?: boolean }): boolean {
  // Verifica se é a primeira mensagem usando a flag ou estado vazio
  if (state._isFirstMessage === true) return true
  // Fallback: verifica se é a primeira mensagem: estado vazio ou sem histórico significativo
  const hasNoHistory = !state.mode && !state.step && !state.slots?.service && !state.last_prompt
  const hasEmptySlots = !state.slots || Object.keys(state.slots).length === 0 || 
    (Object.keys(state.slots).length === 1 && state.slots.quote_answers && Object.keys(state.slots.quote_answers).length === 0)
  return hasNoHistory && hasEmptySlots
}

async function processSimulatorMessage(
  input: string,
  config: SimulatorConfig,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = []
): Promise<SimulatorResult> {
  const text = input.trim()
  const nextState: SimulatorState = {
    ...state,
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const isFirst = isFirstMessage(state)

  // Conversa finalizada: IA responde de forma natural com os dados do config
  if (isFinalizedState(nextState)) {
    const msg = normalizeText(text)
    const isThanks =
      /^(muito\s+)?(obrigad|valeu|agradec)[oas]?\.?$/.test(msg) ||
      /^(obrigad|valeu)[oas]?,\s*(obrigad|valeu)[oas]?\.?$/.test(msg) ||
      isThanksOrClosingPhrase(text)
    if (isThanks) {
      const company = config.business_name ? `A ${config.business_name}` : "A empresa"
      const saudacao = getGreetingByTime()
      nextState.final_thanks_sent = true
      return buildResult(`Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`, nextState)
    }
    // IA entende QUALQUER mensagem e responde com o config como contexto (finalized = não pedir dados novamente)
    const aiAnswer = await answerWithContextualAI(config, text, history, true)
    if (aiAnswer) {
      nextState.final_thanks_sent = true
      return buildResult(aiAnswer, nextState)
    }
    // Fallback se API falhar: padrões determinísticos
    const infoAnswer = tryAnswerInformationalQuestion(config, text)
    if (infoAnswer) {
      nextState.final_thanks_sent = true
      return buildResult(infoAnswer, nextState)
    }
    nextState.final_thanks_sent = true
    return buildResult("Se precisar de algo no futuro, fico à disposição.", nextState)
  }

  // PRIORIDADE: Se é primeira mensagem, processar contexto ANTES de qualquer outra coisa
  if (isFirst && !nextState.mode && !nextState.step) {
    const cordial = getCordialPrefix(config, true)
    const business = config.business_name ? `da ${config.business_name}` : "da empresa"
    const greeting = `Oi! Sou a assistente ${business}. Obrigado por entrar em contato. `

    // Pergunta de preço ou lista de serviços no início: responder de forma cordial e objetiva
    if (isListServicesQuestion(text)) {
      const listMsg = buildServicesListWithPrices(config)
      return buildResult(cordial + listMsg, { ...nextState, step: "qualification" }, ["Quero agendar"])
    }
    if (isServiceDetailQuestion(text)) {
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (svc?.description) {
        return buildResult(cordial + `${svc.name}: ${svc.description} Quer agendar?`, nextState, ["Quero agendar"])
      }
      if (serviceName) {
        return buildResult(
          cordial + `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`,
          nextState,
          ["Quero agendar"]
        )
      }
    }
    if (isPriceQuestion(text)) {
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        return buildResult(
          cordial + `O ${svc.name} sai por R$ ${svc.base_price}. Quer agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (serviceName && svc) {
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
      }
      if (!serviceName && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
          return buildResult(`${greeting}${rejectionMessage}`, { ...nextState, step: "qualification_rejected" })
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        const lines = withPrice.map((s) => `${s.name}: R$ ${s.base_price}`).join("; ")
        return buildResult(cordial + `Os valores são: ${lines}. Quer agendar algum?`, nextState, ["Quero agendar"])
      }
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }

    const shouldClassify =
      (config.services || []).length > 0 &&
      !nextState.slots.service &&
      (config.lead_policy?.use_ai_matching ?? true)

    if (shouldClassify && !isGreeting(text)) {
      const match = await classifyServiceMatch(text, config)
      const hasContext = hasMatchContext(match)

      if (match.service) {
        nextState.slots.service = match.service
        nextState.just_identified_service = true
        const thanks = config.business_name ? `Obrigado por escolher a ${config.business_name}. ` : ""
        const intro = `${greeting}${thanks}Entendi, você precisa de ajuda com ${match.service}. `
        if (config.context_mode === "booking") {
          const result = await resolveBooking(config, text, nextState)
          return buildResult(`${intro}${result.message}`, result.state, result.action_options)
        }
        if (config.context_mode === "quote") {
          return buildResult(`${intro}O que você precisa orçar?`, nextState)
        }
        return buildResult(`${intro}Você prefere agendar um horário ou pedir um orçamento?`, nextState)
      } else if (hasContext) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, hasContext)
        return buildResult(`${greeting}${rejectionMessage}`, { ...nextState, step: "qualification_rejected" })
      } else {
        const orchestrator = await interpretFlowWithAI(text, history, nextState, config)
        if (orchestrator && orchestrator.confidence >= 0.5 && orchestrator.suggested_action === "no_match_fallback") {
          const aiAnswer = await answerWithContextualAI(config, text, history)
          if (aiAnswer) return buildResult(`${greeting}${aiAnswer}`, { ...nextState, step: "qualification" })
          return buildResult(`${greeting}${buildGenericFallback(config)}`, { ...nextState, step: "qualification" })
        }
        return buildResult(`${greeting}Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
      }
    }

    if (isGreeting(text)) {
      return buildResult(`${greeting}Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
    }

    return buildResult(`${greeting}Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
  }

  if (!nextState.slots.service) {
    const exactService = findServiceByExactMatch(text, config.services || [])
    if (exactService) {
      nextState.slots.service = exactService
    } else {
      const service = findServiceFromText(text, config.services || [])
      if (service) nextState.slots.service = service
      else if (isVisitRequest(text)) nextState.slots.service = "visita"
    }
  }

  if (isWhoAreYou(text)) {
    const name = config.business_name ? `da ${config.business_name}` : "da empresa"
    return buildResult(`Oi! Sou a assistente virtual ${name}. Como posso te ajudar hoje?`, nextState)
  }

  if (isConfused(text)) {
    const fallback = nextState.last_prompt || "Como posso te ajudar hoje?"
    return buildResult(`Tudo bem! Posso repetir: ${fallback}`, nextState)
  }

  // Encerrar conversa após agradecimento final para evitar loop
  if (isFinalizedState(nextState)) {
    const msg = normalizeText(text)
    if (/\b(obrigad|valeu|agradec)\b/.test(msg)) {
      const company = config.business_name ? `A ${config.business_name}` : "A empresa"
      const saudacao = getGreetingByTime()
      nextState.final_thanks_sent = true
      return buildResult(`Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`, nextState)
    }
  }

  if (nextState.step === "qualification_rejected") {
    const n = normalizeText(text)
    const isShortDecline =
      /^(entendi|ok|t[aá] ok|tudo bem|obrigado|obrigada|valeu|nao|não)$/.test(n) ||
      /^(entendi|ok|tudo bem)[,\s]+(obrigad|valeu)/.test(n) ||
      isPoliteDecline(text)
    if (isShortDecline) return handleShortDecline(config, nextState)
    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }
    const orchestrator = await interpretFlowWithAI(text, history, nextState, config)
    if (orchestrator && orchestrator.confidence >= 0.5) {
      if (orchestrator.suggested_action === "no_match_fallback") {
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer) return buildResult(aiAnswer, nextState)
        return buildResult(buildGenericFallback(config), nextState)
      }
      if (orchestrator.suggested_action === "answer_price") {
        const cordial = getCordialPrefix(config, false)
        const svc = orchestrator.inferred_service
          ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
          : null
        if (orchestrator.inferred_service && !svc) {
          const rejectionMessage = await generateRejectionMessageWithAI(orchestrator.inferred_service, config, false, true)
          return buildResult(rejectionMessage, nextState)
        }
        if (svc && svc.base_price != null) {
          nextState.slots.service = svc.name
          nextState.just_identified_service = true
          nextState.step = undefined
          nextState.mode = "booking"
          const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          }
          return buildResult(
            cordial + `O ${svc.name} sai por R$ ${svc.base_price}. Quer agendar?`,
            nextState,
            ["Quero agendar", "Só queria saber"]
          )
        }
        const withPrice = (config.services || []).filter((s) => s.base_price != null)
        if (withPrice.length > 0) {
          const lines = withPrice.map((s) => `${s.name}: R$ ${s.base_price}`).join("; ")
          nextState.mode = "booking"
          nextState.step = undefined
          const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          }
          return buildResult(
            getCordialPrefix(config, false) + `Os valores são: ${lines}. Quer agendar algum?`,
            nextState,
            ["Quero agendar"]
          )
        }
      }
      if (orchestrator.suggested_action === "list_services") {
        const listMsg = buildServicesListWithPrices(config)
        return buildResult(getCordialPrefix(config, false) + listMsg, { ...nextState, step: "qualification" }, ["Quero agendar"])
      }
      if (orchestrator.suggested_action === "start_booking") {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator.inferred_attendees === "multiple" || orchestrator.inferred_attendees === "other_person") {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
          return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
        }
        const serviceFromOrchestrator = orchestrator.inferred_service ? getServiceWithPrice(config.services || [], orchestrator.inferred_service) : null
        const serviceFromText = findServiceFromText(text, config.services || [])
        const identifiedService = serviceFromOrchestrator?.name || (serviceFromText ? getServiceWithPrice(config.services || [], serviceFromText)?.name : null) || serviceFromText
        if (identifiedService) {
          nextState.slots.service = identifiedService
          nextState.just_identified_service = true
          return resolveBooking(config, text, nextState)
        }
        const prompt = buildServicePrompt(config, text)
        return buildResult(prompt.message, nextState, prompt.action_options)
      }
      if (orchestrator.suggested_action === "ask_clarification") {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          return buildResult(
            await generateRejectionMessageWithAI(match.inferred_area, config, false, true),
            nextState
          )
        }
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer) return buildResult(aiAnswer, nextState)
        if (orchestrator.clarification_question) return buildResult(orchestrator.clarification_question, nextState)
      }
    }

    if (isPriceQuestion(text)) {
      const cordial = getCordialPrefix(config, false)
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        return buildResult(
          cordial + `O ${svc.name} sai por R$ ${svc.base_price}. Quer agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        const lines = withPrice.map((s) => `${s.name}: R$ ${s.base_price}`).join("; ")
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        return buildResult(cordial + `Os valores são: ${lines}. Quer agendar algum?`, nextState, ["Quero agendar"])
      }
    }
    if (isExplicitBookingIntent(text)) {
      nextState.mode = "booking"
      nextState.step = undefined
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      const serviceFromText = findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState)
      }
      const prompt = buildServicePrompt(config, text)
      return buildResult(prompt.message, nextState, prompt.action_options)
    }
    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }
    // Re-inferir a área para manter contexto na resposta
    const match = await classifyServiceMatch(text, config)
    const hasContext = hasMatchContext(match)
    const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, hasContext)
    return buildResult(rejectionMessage, nextState)
  }

  if (nextState.step === "qualification") {
    const cordial = getCordialPrefix(config, isFirst)
    const n = normalizeText(text)
    const isShortDecline =
      /^(entendi|ok|t[aá] ok|tudo bem|obrigado|obrigada|valeu|nao|não)$/.test(n) ||
      /^(entendi|ok|tudo bem)[,\s]+(obrigad|valeu)/.test(n) ||
      isPoliteDecline(text)
    if (isShortDecline) return handleShortDecline(config, nextState)
    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
        return buildResult(rejectionMessage, nextState)
      }
    }
    const orchestrator = await interpretFlowWithAI(text, history, nextState, config)
    if (orchestrator && orchestrator.confidence >= 0.5) {
      if (orchestrator.suggested_action === "no_match_fallback") {
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer) return buildResult(aiAnswer, nextState)
        return buildResult(buildGenericFallback(config), nextState)
      }
      if (orchestrator.suggested_action === "answer_price") {
        const svc = orchestrator.inferred_service
          ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
          : null
        if (orchestrator.inferred_service && !svc) {
          const rejectionMessage = await generateRejectionMessageWithAI(orchestrator.inferred_service, config, isFirst, true)
          return buildResult(rejectionMessage, nextState)
        }
        if (svc && svc.base_price != null) {
          nextState.slots.service = svc.name
          nextState.just_identified_service = true
          nextState.step = undefined
          nextState.mode = "booking"
          const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator.inferred_attendees === "multiple" || orchestrator.inferred_attendees === "other_person") {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          }
          return buildResult(
            cordial + `O ${svc.name} sai por R$ ${svc.base_price}. Quer agendar?`,
            nextState,
            ["Quero agendar", "Só queria saber"]
          )
        }
        const withPrice = (config.services || []).filter((s) => s.base_price != null)
        if (withPrice.length > 0) {
          const lines = withPrice.map((s) => `${s.name}: R$ ${s.base_price}`).join("; ")
          nextState.mode = "booking"
          nextState.step = undefined
          const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator.inferred_attendees === "multiple" || orchestrator.inferred_attendees === "other_person") {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          }
          return buildResult(cordial + `Os valores são: ${lines}. Quer agendar algum?`, nextState, ["Quero agendar"])
        }
      }
      if (orchestrator.suggested_action === "list_services") {
        const listMsg = buildServicesListWithPrices(config)
        return buildResult(cordial + listMsg, nextState, ["Quero agendar"])
      }
      if (orchestrator.suggested_action === "start_booking") {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator.inferred_attendees === "multiple" || orchestrator.inferred_attendees === "other_person") {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
          return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
        }
        const serviceFromOrchestrator = orchestrator.inferred_service ? getServiceWithPrice(config.services || [], orchestrator.inferred_service) : null
        const serviceFromText = findServiceFromText(text, config.services || [])
        const identifiedService = serviceFromOrchestrator?.name || (serviceFromText ? getServiceWithPrice(config.services || [], serviceFromText)?.name : null) || serviceFromText
        if (identifiedService) {
          nextState.slots.service = identifiedService
          nextState.just_identified_service = true
          return resolveBooking(config, text, nextState)
        }
        const prompt = buildServicePrompt(config, text)
        return buildResult(prompt.message, nextState, prompt.action_options)
      }
      if (orchestrator.suggested_action === "ask_clarification") {
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer) return buildResult(aiAnswer, nextState)
        if (orchestrator.clarification_question) return buildResult(orchestrator.clarification_question, nextState)
      }
    }

    if (isExplicitBookingIntent(text)) {
      nextState.mode = "booking"
      nextState.step = undefined
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      const serviceFromText = findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState)
      }
      const prompt = buildServicePrompt(config, text)
      return buildResult(prompt.message, nextState, prompt.action_options)
    }
    if (isListServicesQuestion(text)) {
      const listMsg = buildServicesListWithPrices(config)
      return buildResult(cordial + listMsg, nextState, ["Quero agendar"])
    }
    if (isPriceQuestion(text)) {
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        return buildResult(
          cordial + `O ${svc.name} sai por R$ ${svc.base_price}. Quer agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (serviceName && svc) {
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer && /\bR\$\s*\d/.test(aiAnswer)) return buildResult(aiAnswer, nextState, ["Quero agendar", "Só queria saber"])
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
      }
      if (!serviceName && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
          return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        const lines = withPrice.map((s) => `${s.name}: R$ ${s.base_price}`).join("; ")
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        return buildResult(cordial + `Os valores são: ${lines}. Quer agendar algum?`, nextState, ["Quero agendar"])
      }
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer && /\bR\$\s*\d/.test(aiAnswer)) return buildResult(aiAnswer, nextState, ["Quero agendar", "Só queria saber"])
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }
    const match = await classifyServiceMatch(text, config)
    if (match.service) {
      nextState.slots.service = match.service
      nextState.just_identified_service = true
      nextState.step = undefined
    } else if (match.reject || config.lead_policy?.reject_unlisted_services) {
      // Verificar se há contexto suficiente (não é indefinido e tem confidence razoável)
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      if (match.reject) return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
      if (hasContext && (config.services || []).length > 0) {
        return buildResult(rejectionMessage, nextState)
      }
      // Sem contexto suficiente, pedir mais detalhes de forma natural
      return buildResult("Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor.", nextState)
    } else {
      // Verificar se há contexto suficiente
      const hasContext = hasMatchContext(match)
      if (hasContext && (config.services || []).length > 0) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, nextState)
      }
      return buildResult("Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor.", nextState)
    }
  }

  // Se é primeira mensagem, SEMPRE verificar contexto primeiro (mesmo que comece com "oi")
  // Isso garante que mensagens como "oi, prenderam meu filho" sejam processadas corretamente

  if (
    config.lead_policy?.reject_unlisted_services &&
    (config.services || []).length > 0 &&
    !nextState.slots.service &&
    !isGreeting(text) &&
    !isFirst
  ) {
    const match = await classifyServiceMatch(text, config)
    if (match.service) {
      nextState.slots.service = match.service
      nextState.just_identified_service = true
    } else if (match.reject) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
    } else {
      // Verificar se há contexto suficiente
      const hasContext = hasMatchContext(match)
      if (hasContext) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, { ...nextState, step: "qualification" })
      }
      return buildResult("Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor.", {
        ...nextState,
        step: "qualification",
      })
    }
  }

  if (!nextState.mode && isGreeting(text)) {
    const business = config.business_name ? `da ${config.business_name}` : "da empresa"
    const greeting = pickVariant(text, [
      `Oi! Sou a assistente ${business}.`,
      `Oi! Aqui e a assistente ${business}.`,
      `Oi! Sou a assistente virtual ${business}.`,
    ])
    
    // Se é greeting puro (sem contexto), apenas saudar e perguntar
    // Se tem contexto na mensagem, já foi processado acima no bloco isFirst
    return buildResult(`${greeting} Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
  }

  if (!nextState.mode) {
    // Só definir mode se tiver serviço válido ou se não houver política de rejeição
    const canSetMode = nextState.slots.service || 
                      !config.lead_policy?.reject_unlisted_services ||
                      (config.services || []).length === 0
    
    if (canSetMode) {
      if (config.context_mode && config.context_mode !== "both") {
        nextState.mode = config.context_mode
      } else {
        const detected = detectModeFromText(text)
        if (!detected) {
          // Sem contexto suficiente, perguntar de forma natural
          return buildResult("Voce prefere agendar um horario ou pedir um orcamento?", { ...nextState, step: "ask_mode" })
        }
        nextState.mode = detected
      }
    } else {
      // Não tem serviço e há política de rejeição, não definir mode ainda
      // Deixar no step "qualification" para continuar a qualificação
      if (!nextState.step) {
        return buildResult("Para eu te ajudar melhor, qual o assunto ou área que você precisa?", { ...nextState, step: "qualification" })
      }
    }
  }

  if (nextState.step === "ask_mode" && !nextState.mode) {
    const detected = detectModeFromText(text)
    if (!detected) {
      return buildResult("Entendi. Voce quer agendar um horario ou pedir um orcamento?", nextState)
    }
    nextState.mode = detected
  }

  // Verificar se o serviço existe ANTES de entrar no modo booking
  // Isso previne que o bot tente agendar serviços que não existem
  if (nextState.mode === "booking" && 
      !nextState.slots.service && 
      config.lead_policy?.reject_unlisted_services &&
      (config.services || []).length > 0 &&
      !isGreeting(text)) {
    const match = await classifyServiceMatch(text, config)
    if (match.reject || (match.inferred_area && match.inferred_area !== "indefinido" && !match.service)) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected", mode: undefined })
    }
  }

  if (nextState.mode === "booking") {
    if (isPriceQuestion(text)) {
      const cordial = getCordialPrefix(config, isFirst)
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        return buildResult(
          cordial + `O ${svc.name} sai por R$ ${svc.base_price}. Quer agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (serviceName && svc) {
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        const lines = withPrice.map((s) => `${s.name}: R$ ${s.base_price}`).join("; ")
        return buildResult(cordial + `Os valores são: ${lines}. Quer agendar algum?`, nextState, ["Quero agendar"])
      }
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }
    if (isListServicesQuestion(text)) {
      const cordial = getCordialPrefix(config, isFirst)
      const listMsg = buildServicesListWithPrices(config)
      return buildResult(cordial + listMsg, nextState, ["Quero agendar"])
    }
    if (isServiceDetailQuestion(text)) {
      const cordial = getCordialPrefix(config, isFirst)
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (svc?.description) {
        return buildResult(cordial + `${svc.name}: ${svc.description} Quer agendar?`, nextState, ["Quero agendar"])
      }
      if (serviceName) {
        return buildResult(
          cordial + `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`,
          nextState,
          ["Quero agendar"]
        )
      }
    }
    if (isFirst && !isGreeting(text)) {
      const result = await resolveBooking(config, text, nextState)
      return buildResult(result.message, result.state, result.action_options)
    }
    return await resolveBooking(config, text, nextState)
  }

  return resolveQuote(config, text, nextState)
}

async function getTenantById(supabaseAdmin: any, tenantId: string) {
  const { data, error } = await supabaseAdmin.from("tenant").select("id, name, slug").eq("id", tenantId).single()
  if (error || !data) return null
  return data
}

async function getOrCreateTenant(supabaseAdmin: any, sessionId: string, businessName?: string) {
  const slug = `sim-${sessionId}`
  const { data: existing } = await supabaseAdmin.from("tenant").select("*").eq("slug", slug).maybeSingle()
  if (existing) return existing

  const { data, error } = await supabaseAdmin
    .from("tenant")
    .insert({ name: businessName || `Simulador ${sessionId}`, slug })
    .select()
    .single()
  if (error) throw error
  return data
}

type ChannelType = "web_simulator" | "whatsapp"

async function getOrCreateChannel(supabaseAdmin: any, tenantId: string, agentId: string, channelType: ChannelType = "web_simulator") {
  const { data: existing } = await supabaseAdmin
    .from("channel")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("type", channelType)
    .eq("agent_id", agentId)
    .maybeSingle()
  if (existing) return existing

  const insertPayload =
    channelType === "whatsapp"
      ? { tenant_id: tenantId, agent_id: agentId, type: "whatsapp", provider: "twilio", provider_config: {}, is_active: true }
      : { tenant_id: tenantId, agent_id: agentId, type: "web_simulator", is_active: true }
  const { data, error } = await supabaseAdmin
    .from("channel")
    .insert(insertPayload)
    .select()
    .single()
  if (error) throw error
  return data
}

async function getOrCreateContact(supabaseAdmin: any, tenantId: string, channelId: string, sessionId: string, businessName?: string) {
  const { data: existing } = await supabaseAdmin
    .from("contact")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("external_id", sessionId)
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabaseAdmin
    .from("contact")
    .insert({
      tenant_id: tenantId,
      channel_id: channelId,
      external_id: sessionId,
      phone: sessionId,
      display_name: businessName || "Cliente",
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function getOrCreateConversation(
  supabaseAdmin: any,
  tenantId: string,
  channelId: string,
  contactId: string,
  agentId: string,
  conversationId?: string
) {
  if (conversationId) {
    const { data: existing } = await supabaseAdmin
      .from("conversation")
      .select("*")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (existing) return existing
  }

  const { data, error } = await supabaseAdmin
    .from("conversation")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      channel_id: channelId,
      contact_id: contactId,
      status: "open",
      context: {},
      state_json: {},
    })
    .select()
    .single()
  if (error) throw error
  return data
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Max-Age": "86400",
      },
    })
  }

  try {
    const body = (await req.json()) as ConversationTurnRequest
    if (!body?.message) {
      return json({ error: "message e obrigatorio" }, 400)
    }
    const isWhatsApp = (body as { channel?: string }).channel === "whatsapp"
    if (isWhatsApp && !(body as { from?: string }).from) {
      return json({ error: "para channel whatsapp, from (numero do remetente) e obrigatorio" }, 400)
    }
    if (!isWhatsApp && !body?.session_id) {
      return json({ error: "session_id e obrigatorio para web_simulator" }, 400)
    }

    const { supabaseAdmin, envError } = createSupabaseAdmin()
    if (envError) return json({ error: envError }, 500)

    const config: SimulatorConfig = {
      business_name: body.context?.business_name,
      business_type: body.context?.business_type,
      context_mode: body.context?.context_mode,
      establishment_address: body.context?.establishment_address,
      tone: body.context?.tone,
      services: body.context?.services || [],
      when_client_asks_price_no_value: body.context?.when_client_asks_price_no_value || "offer_handoff_or_booking",
      schedule: body.context?.schedule,
      staff: body.context?.staff || [],
      dynamic_variables: body.context?.dynamic_variables || [],
      lead_policy: body.context?.lead_policy,
      holidays_attend: body.context?.holidays_attend,
      closure_periods: body.context?.closure_periods,
      allow_sequence_booking: body.context?.allow_sequence_booking ?? false,
      sequence_eligible_services: body.context?.sequence_eligible_services ?? [],
    }

    const tenant = (body as { tenant_id?: string }).tenant_id
      ? await getTenantById(supabaseAdmin, (body as { tenant_id: string }).tenant_id)
      : await getOrCreateTenant(supabaseAdmin, body.session_id, config.business_name)
    if (!tenant) {
      return json({ error: "tenant_id invalido ou nao encontrado" }, 400)
    }

    let agentId = (body as { agent_id?: string }).agent_id
    if (!agentId) {
      const { data: firstAgent } = await supabaseAdmin
        .from("agent")
        .select("id")
        .eq("tenant_id", tenant.id)
        .limit(1)
        .maybeSingle()
      agentId = firstAgent?.id ?? undefined
    }
    if (!agentId) {
      return json({ error: "tenant sem agente configurado; agent_id obrigatorio para conversation/channel" }, 400)
    }

    const channelType: ChannelType = (body as { channel?: string }).channel === "whatsapp" ? "whatsapp" : "web_simulator"
    const sessionIdForContact =
      channelType === "whatsapp" && (body as { from?: string }).from
        ? (body as { from: string }).from
        : body.session_id
    const channel = await getOrCreateChannel(supabaseAdmin, tenant.id, agentId, channelType)
    const contact = await getOrCreateContact(supabaseAdmin, tenant.id, channel.id, sessionIdForContact, config.business_name)
    const conversation = await getOrCreateConversation(supabaseAdmin, tenant.id, channel.id, contact.id, agentId, body.conversation_id)

    // Verificar se é a primeira mensagem da conversa
    const { count: messageCount } = await supabaseAdmin
      .from("conversation_messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("role", "user")
    const isFirstMessage = (messageCount || 0) === 0

    const currentState = (conversation.state_json?.state as SimulatorState) || createSimulatorState()
    const stateWithFirstFlag = { ...currentState, _isFirstMessage: isFirstMessage }

    const { data: recentMessages } = await supabaseAdmin
      .from("conversation_messages")
      .select("role, content_text")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(12)
    const history = (recentMessages || []).map((m) => ({
      role: m.role || "user",
      content: (m.content_text || "").trim(),
    }))

    let result: SimulatorResult
    try {
      result = await processSimulatorMessage(body.message, config, stateWithFirstFlag, history)
    } catch (err) {
      console.error("processSimulatorMessage error:", err)
      result = {
        message: "Desculpe, tive um problema ao processar. Pode repetir?",
        state: stateWithFirstFlag,
        action_options: undefined,
      }
    }
    const rewritten = await rewriteWithTone(result.message, config.tone)

    const nowIso = new Date().toISOString()

    await supabaseAdmin.from("conversation_messages").insert([
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "user",
        content_text: body.message,
        metadata: { channel: channelType },
      },
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "assistant",
        content_text: rewritten.message,
        metadata: {
          channel: channelType,
          tone: config.tone,
          base_message: result.message,
          used_ai: rewritten.used_ai,
          action_options: result.action_options || null,
        },
      },
    ])

    // Remover flag temporária do estado antes de salvar
    const { _isFirstMessage, ...stateToSave } = result.state as SimulatorState & { _isFirstMessage?: boolean }
    
    await supabaseAdmin
      .from("conversation")
      .update({
        state_json: { state: stateToSave, channel: channelType },
        context: {
          ...(conversation.context || {}),
          session_id: sessionIdForContact,
          business_name: config.business_name,
          business_type: config.business_type,
          context_mode: config.context_mode,
          tone: config.tone,
        },
        last_message_at: nowIso,
      })
      .eq("id", conversation.id)
      .eq("tenant_id", tenant.id)

    const tenantIdForAppointment = (body as { tenant_id?: string }).tenant_id
    if (tenantIdForAppointment) {
      const prevLen = (currentState.completed_bookings?.length ?? 0)
      const completed = (stateToSave as SimulatorState).completed_bookings ?? []
      const newBookings = completed.slice(prevLen)
      for (const b of newBookings) {
        const staffName = (b as { staff_name?: string }).staff_name ?? null
        const date = (b as { date?: string }).date
        const time = (b as { time?: string }).time
        const service = (b as { service?: string }).service
        if (!date || !time || !staffName) continue
        const startAt = `${date}T${time}:00.000Z`
        const duration = getServiceDurationMinutes(config, service) ?? 30
        const endAt = new Date(Date.parse(startAt) + duration * 60 * 1000).toISOString()
        const { error: insErr } = await supabaseAdmin.from("appointment").insert({
          tenant_id: tenantIdForAppointment,
          attendee_name: (b as { attendee_name?: string }).attendee_name ?? null,
          staff_name: staffName,
          service_names: service ? [service] : [],
          start_at: startAt,
          end_at: endAt,
          status: "confirmed",
        })
        if (insErr && insErr.code !== "23505") console.error("appointment insert error:", insErr)
      }
    }

    const response: ConversationTurnResponse = {
      conversation_id: conversation.id,
      messages: [
        {
          role: "assistant",
          content: rewritten.message,
          created_at: nowIso,
          action_options: result.action_options,
        },
      ],
    }

    return json(response)
  } catch (error: any) {
    console.error("Error na Edge Function:", error)
    return json({ error: error?.message || error?.toString() || "Erro desconhecido" }, 500)
  }
})

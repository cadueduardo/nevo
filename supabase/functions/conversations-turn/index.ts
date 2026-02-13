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
  resolveOptionByNumber,
  formatTimePeriod,
  buildDailySlots,
  applyBreaks,
  getMockAvailability,
  isWithinSchedule,
  isBusinessClosedForToday,
  getTodayIsoBusinessTz,
  isTimeTooSoonForDate,
  MIN_BOOKING_LEAD_MINUTES,
  isGreeting,
  isWhoAreYou,
  getGreetingByTime,
  isConfused,
  isEndTestCommand,
  isFinalizedState,
  isPriceQuestion,
  isListServicesQuestion,
  isServiceDetailQuestion,
  isExplicitBookingIntent,
  looksLikeAttendeeName,
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
  getGreetingMessage,
  buildListServicesMessage,
  buildBookingConfirmationIntro,
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
  interpretSlotsFromMessageWithAI,
  createSimulatorState,
  buildResult,
  resetSlotsForNextBooking,
  addDaysToIsoDate,
  addBookedSlot,
  buildCalendarIcs,
  uploadCalendarIcs,
  buildFinalBookingMessage,
  classifyServiceMatch,
  areaMatchesServices,
  hasMatchContext,
  hasAdditionalBookings,
  applyAdditionalBookingState,
  handleShortDecline,
  tryAnswerInformationalQuestion,
  isMyBookingQuestion,
  getMyBookingAnswer,
  answerWithContextualAI,
  generateAvailabilityResponseWithAI,
  extractContactPreferenceFromText,
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

async function resolveBooking(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string
): Promise<SimulatorResult> {
  const toNumberedOptions = (options: string[]): string[] => options.map((option, idx) => `${idx + 1} - ${option}`)
  const getOtherDayOptions = (schedule?: { days_of_week?: string[] } | null): string[] => {
    const dayOptions = buildStaffDayOptions(schedule?.days_of_week || [])
    return dayOptions.length > 0 ? dayOptions : ["Outro dia"]
  }
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
  // Cliente confirmou com frase de encerramento (ex.: "tudo certo", "confirmar") sem ter passado pelo botão "Confirmar agendamento".
  // É obrigatório fazer push em completed_bookings e atualizar booked_slots para que o insert na tabela appointment seja feito ao final do turn.
  // NÃO tratar como encerramento se está no meio da escolha de opção (ex: "Isso, mesmo dia e colaborador").
  const isConfirm =
    isDonePhrase(text) ||
    (text.trim() === "1" && Array.isArray(state.last_confirm_options) && state.last_confirm_options.length > 0)
  if (!state.pending_template_choice && !state.pending_second_service_choice && !state.pending_final_confirmation && !state.final_thanks_sent && isConfirm && bookingComplete) {
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
  if (!state.pending_template_choice && !state.pending_second_service_choice && !state.pending_final_confirmation && !state.final_thanks_sent && isConfirmShort) {
    const bookings = nextState.completed_bookings || []
    if (bookings.length > 0) {
      nextState.final_thanks_sent = true
      nextState.completed_bookings = []
      return buildResult(buildFinalThanksMessage(config.business_name, bookings), nextState)
    }
  }
  // Resposta "2", "3", "4" às opções de confirmação (Outro horário, Outro dia, Trocar colaborador)
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

  // REGRA CRÍTICA: dígito "1"/"2"/"3" com attendee e sem data = seleção de serviço → perguntar dia, NUNCA horário
  const isDigitOnlyEarly = /^[1-9]\d*$/.test(text.trim())
  const serviceOpts = buildServiceOptions(config.services || [])
  const canResolveService = serviceOpts.length > 0 && resolveOptionByNumber(text, serviceOpts)
  if (
    isDigitOnlyEarly &&
    nextState.slots.attendee_name &&
    !nextState.slots.service &&
    !nextState.slots.date &&
    !state.last_confirm_options?.length &&
    !state.pending_template_choice &&
    !state.pending_second_service_choice &&
    canResolveService
  ) {
    const serviceFromNum = resolveOptionByNumber(text, serviceOpts)!
    nextState.slots.service = serviceFromNum === "Quero agendar uma visita" ? "visita" : serviceFromNum
    nextState.last_service_options = undefined
    // Seleção numérica de serviço deve sempre reiniciar etapa de agenda (evita herdar data/horário antigo da sessão).
    nextState.slots.date = undefined
    nextState.slots.time = undefined
    nextState.slots.time_period = undefined
    nextState.pending_date_confirmation = undefined
    nextState.last_time_options = undefined
    nextState.last_time_options_date = undefined
    nextState.last_time_options_staff = undefined
    const staffName = nextState.slots.staff_name || (getStaffList(config)[0]?.name)
    const schedule = staffName ? getScheduleForStaff(config, staffName) : null
    const days = schedule?.days_of_week || []
    const dayOpts = buildStaffDayOptions(days)
    if (!nextState.slots.staff_name && staffName) nextState.slots.staff_name = staffName
    nextState.just_identified_service = true
    return buildResult(
      `Entendi, voce precisa de ${nextState.slots.service}. Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
      nextState,
      toNumberedOptions(dayOpts)
    )
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
  const interpretedAdditional = await interpretAdditionalBookingsWithAI(text, {
    has_completed_booking: hasCompletedBooking,
    history,
  })
  const interpretedCountRaw = typeof interpretedAdditional?.count === "number" ? interpretedAdditional.count : null
  const interpretedCount = interpretedCountRaw !== null ? Math.max(0, interpretedCountRaw) : null
  const interpretedHasAdditional =
    interpretedAdditional?.has_additional === true || (interpretedCount !== null && interpretedCount > 0)

  const lastAssistantMsg =
    state.last_prompt || (history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : undefined)
  const waitingFor = nextState.pending_attendee_name
    ? "attendee_name"
    : !nextState.slots.service
      ? "service"
      : !nextState.slots.date
        ? "date"
        : !nextState.slots.time
          ? "time"
          : undefined
  const slotsInterpretation =
    waitingFor || nextState.pending_attendee_name
      ? await interpretSlotsFromMessageWithAI(text, {
          waiting_for: waitingFor,
          current_slots: nextState.slots,
          services: config.services || [],
          history,
          last_assistant_message: lastAssistantMsg,
          sender_display_name: senderDisplayName,
        }, config)
      : null
  const normalizedText = normalizeText(text)
  const allowAiDateAutofill =
    hasExplicitDate(text) ||
    normalizedText.includes("hoje") ||
    normalizedText.includes("amanha")

  // Não usar slots da IA quando a mensagem é só número (ex: "1" = opção de serviço)
  const isDigitOnly = /^[1-9]\d*$/.test(text.trim())
  if (
    waitingFor === "service" &&
    slotsInterpretation?.service &&
    !nextState.slots.service &&
    !isDigitOnly
  ) {
    nextState.slots.service = slotsInterpretation.service
  }

  if (
    waitingFor === "date" &&
    slotsInterpretation?.date &&
    !nextState.slots.date &&
    !isDigitOnly &&
    allowAiDateAutofill &&
    /^\d{4}-\d{2}-\d{2}$/.test(slotsInterpretation.date)
  ) {
    nextState.slots.date = slotsInterpretation.date
  }
  if (
    waitingFor === "time" &&
    slotsInterpretation?.time &&
    !nextState.slots.time &&
    !isDigitOnly
  ) {
    nextState.slots.time = slotsInterpretation.time
  }
  if (
    waitingFor === "attendee_name" &&
    slotsInterpretation?.attendee_name &&
    !nextState.slots.attendee_name &&
    !isDigitOnly
  ) {
    nextState.slots.attendee_name = slotsInterpretation.attendee_name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = slotsInterpretation.attendee_name
  }

  // Cliente perguntou "tem horário às 14?" — consultar agenda e responder de forma fluida
  // Não executar quando msg é só número (ex: "1" = opção de serviço)
  if (slotsInterpretation?.needs_availability_check && slotsInterpretation?.time && !isDigitOnly) {
    const dateIso = nextState.slots.date || getTodayIsoBusinessTz()
    const staffList = getStaffList(config)
    const staffName = nextState.slots.staff_name || (staffList[0]?.name)
    const schedule = getScheduleForStaff(config, staffName)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    ) ?? 30
    const availability = getMockAvailability(
      dateIso,
      schedule,
      nextState.booked_slots,
      staffName,
      serviceDuration
    )
    const requestedTime = slotsInterpretation.time.includes(":")
      ? slotsInterpretation.time
      : `${String(parseInt(slotsInterpretation.time, 10)).padStart(2, "0")}:00`
    const isAvailable = availability.available.includes(requestedTime)

    const fluidResponse = await generateAvailabilityResponseWithAI(config, {
      attendee_name: nextState.slots.attendee_name,
      requested_time: requestedTime,
      date_iso: dateIso,
      is_available: isAvailable,
      available_slots: availability.available.slice(0, 12),
      service: nextState.slots.service,
    }, history)

    if (isAvailable) {
      nextState.slots.date = dateIso
      nextState.slots.time = requestedTime
      nextState.slots.staff_name = staffName
      nextState.pending_attendee_name = false
      const options = [
        `Sim, ${requestedTime}`,
        "Outro horario",
        ...(getOtherStaffOptions(config, staffName).length > 0 ? ["Outro colaborador"] : []),
      ]
      return buildResult(fluidResponse, nextState, options)
    }
    return buildResult(fluidResponse, nextState, availability.available.slice(0, 8))
  }

  if (!nextState.slots.service) {
    const serviceFromNumber =
      state.last_service_options?.length && resolveOptionByNumber(text, state.last_service_options)
    if (serviceFromNumber) {
      nextState.slots.service = serviceFromNumber === "Quero agendar uma visita" ? "visita" : serviceFromNumber
      nextState.last_service_options = undefined
      // Ao escolher serviço por número, não carregar data/horário previamente preenchidos.
      nextState.slots.date = undefined
      nextState.slots.time = undefined
      nextState.slots.time_period = undefined
      nextState.pending_date_confirmation = undefined
      nextState.last_time_options = undefined
      nextState.last_time_options_date = undefined
      nextState.last_time_options_staff = undefined
      // Se a GUARDA no início não pegou (ex: fluxo sem attendee), perguntar dia quando faltar data
      if (!nextState.slots.date) {
        const staffName = nextState.slots.staff_name || (getStaffList(config)[0]?.name)
        const schedule = staffName ? getScheduleForStaff(config, staffName) : null
        const days = schedule?.days_of_week || []
        const dayOpts = buildStaffDayOptions(days)
        nextState.just_identified_service = true
        if (!nextState.slots.staff_name && staffName) nextState.slots.staff_name = staffName
        return buildResult(
          `Entendi, voce precisa de ${nextState.slots.service}. Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
          nextState,
          toNumberedOptions(dayOpts)
        )
      }
    } else if (explicitService) nextState.slots.service = explicitService
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
    // Fallback: assistente pediu o nome e cliente respondeu só com o nome (ex: "Cesar") — usar como attendee
    const lastAskedForName = lastAssistantMsg && /qual[\s\w]*nome/.test(normalizeText(lastAssistantMsg))
    const directNameAnswer = lastAskedForName && looksLikeAttendeeName(text)
    if (slotsInterpretation?.relationship_only && !directNameAnswer) {
      const rel = slotsInterpretation.relationship || "pessoa"
      const question =
        rel === "filho"
          ? "Claro, vamos comecar pelo seu filho. Qual o nome dele?"
          : rel === "filha"
            ? "Claro, vamos comecar pela sua filha. Qual o nome dela?"
            : rel === "marido"
              ? "Claro, vamos comecar pelo seu marido. Qual o nome dele?"
              : rel === "esposa"
                ? "Claro, vamos comecar pela sua esposa. Qual o nome dela?"
                : `Claro! Qual o nome ${rel === "pessoa" ? "dessa pessoa" : `do(a) seu(sua) ${rel}`}?`
      return buildResult(question, nextState)
    }

    const name =
      slotsInterpretation?.attendee_name && slotsInterpretation.attendee_name.trim()
        ? slotsInterpretation.attendee_name.trim()
        : text.trim()
    if (!name || interpretedHasAdditional || isExplicitBookingIntent(text)) {
      return buildResult(`${buildMultiBookingIntro()} De quem sera o primeiro agendamento?`, nextState)
    }
    nextState.slots.attendee_name = name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = name
    if (slotsInterpretation?.service && !nextState.slots.service) {
      nextState.slots.service = slotsInterpretation.service
    }
    nextState.pending_attendee_name = false
    if (nextState.last_booking && !nextState.pending_template_choice) {
      nextState.pending_template_choice = true
      const staffLabel = nextState.last_booking.staff_name ? ` da ${nextState.last_booking.staff_name}` : ""
      const dateLabel = nextState.last_booking.date ? formatDatePt(nextState.last_booking.date) : "esse dia"
      const hasOtherStaff = getOtherStaffOptions(config, nextState.last_booking.staff_name).length > 0
      const rawOpts = [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
        ...(hasOtherStaff ? ["Trocar colaborador"] : []),
      ]
      const options = rawOpts.map((o, i) => `${i + 1} - ${o}`)
      nextState.last_template_options = options
      const optsText = hasOtherStaff
        ? "Prefere o proximo horario, outro horario no mesmo dia, outro dia ou trocar colaborador?"
        : "Prefere o proximo horario, outro horario no mesmo dia ou outro dia?"
      return buildResult(`Certo, para ${name}. Quer agendar tambem em ${dateLabel}${staffLabel}? ${optsText}`, nextState, options)
    }
    const staffList = getStaffList(config)
    if (staffList.length > 1) {
      const staffOptions = [...staffList.map((s) => s.name), "Tanto faz"]
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...toNumberedOptions(staffOptions),
      ])
    }
    const serviceOpts = buildServiceOptions(config.services || [])
    const numberedOpts = serviceOpts.map((o, i) => `${i + 1} - ${o}`)
    nextState.last_service_options = serviceOpts
    const msg = `Otimo! Vamos agendar primeiro para o ${name}. Qual servico seria? (responda com o numero ou nome)`
    return buildResult(msg, nextState, numberedOpts)
  }

  if (nextState.pending_second_service_choice) {
    const serviceOptions = buildServiceOptions(config.services || [])
    const resolved = resolveOptionByNumber(text, serviceOptions) || findServiceFromText(text, config.services || [])
    const serviceNames = (config.services || []).map((s) => s.name).filter(Boolean)
    if (resolved && (resolved === "Quero agendar uma visita" || serviceNames.includes(resolved))) {
      nextState.pending_second_service_choice = false
      nextState.slots.service = resolved === "Quero agendar uma visita" ? "visita" : resolved
      const last = nextState.last_booking
      if (last?.date && last?.staff_name) {
        const serviceDuration = getServicesTotalDuration(config, nextState.slots.service)
        const next = getNextAvailableSlot(last.date, config, nextState.booked_slots, last.staff_name, last.time, serviceDuration)
        if (next) {
          nextState.slots.date = last.date
          nextState.slots.time = next
          nextState.slots.staff_name = last.staff_name
          const firstName = last.attendee_name || "o primeiro"
          const confirmOpts = [`1 - Sim, ${next}`, "2 - Outro horario no mesmo dia", "3 - Outro dia", ...(getOtherStaffOptions(config, last.staff_name).length > 0 ? ["4 - Trocar colaborador"] : [])]
          nextState.last_confirm_options = confirmOpts
          return buildResult(
            `Otimo, vamos agendar ${nextState.slots.attendee_name || "ele"} em seguida ao ${firstName}. Sugeri ${next} em ${formatDatePt(last.date)}. Posso confirmar?`,
            nextState,
            confirmOpts
          )
        }
        const hasOtherStaff = getOtherStaffOptions(config, last.staff_name).length > 0
        const msg = hasOtherStaff
          ? "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia ou trocar colaborador?"
          : "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia?"
        return buildResult(msg, nextState, [
          "1 - Outro dia",
          ...(hasOtherStaff ? ["2 - Trocar colaborador"] : []),
        ])
      }
    } else {
      const opts = buildServiceOptions(config.services || []).map((o, i) => `${i + 1} - ${o}`)
      return buildResult("Qual servico voce prefere? (responda com o numero ou nome)", nextState, opts)
    }
  }

  if (nextState.pending_template_choice) {
    const templateOpts = state.last_template_options || []
    const choice = parseTemplateChoice(text, templateOpts.length > 0 ? templateOpts : undefined)
    const last = nextState.last_booking
    if (choice && last) {
      nextState.pending_template_choice = false
      nextState.last_template_options = undefined
      if (choice === "same_next") {
        const staffName = last.staff_name
        const defaultService = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceList = buildServiceOptions(config.services || [])
        const numberedServiceOpts = serviceList.map((o, i) => `${i + 1} - ${o}`)
        nextState.pending_second_service_choice = true
        const firstName = last.attendee_name || "o primeiro"
        const secondName = nextState.slots.attendee_name || "ele"
        const defaultLabel = defaultService === "visita" ? "visita" : defaultService
        const question =
          defaultService
            ? `Otimo, vamos agendar ${secondName} em seguida ao ${firstName}. O dele tambem vai ser ${defaultLabel}? Ou prefere trocar o servico:`
            : `Otimo, vamos agendar ${secondName} em seguida ao ${firstName}. Qual servico?`
        return buildResult(question, nextState, numberedServiceOpts)
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
            ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
            : getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? "Esse dia esta cheio. Quer tentar outro dia ou trocar colaborador?"
              : "Esse dia esta cheio. Quer tentar outro dia?"
          const closedDayOptions = getOtherDayOptions(schedule)
          return buildResult(msg, nextState, [
            ...(closedToday ? closedDayOptions : ["Outro dia"]),
            ...(getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? ["Trocar colaborador"]
              : []),
          ])
        }
        nextState.last_time_options = availability.available.slice(0, 24)
        nextState.last_time_options_date = nextState.slots.date
        nextState.last_time_options_staff = nextState.slots.staff_name
        return buildResult(
          "Qual horario voce prefere no mesmo dia?",
          nextState,
          toNumberedOptions(availability.available.slice(0, 24))
        )
      }
      if (choice === "other_day") {
        nextState.slots.date = undefined
        nextState.slots.time = undefined
        return buildResult("Qual dia voce prefere?", nextState)
      }
      if (choice === "other_staff") {
        nextState.slots.staff_name = undefined
        const staffOptions = [...getStaffList(config).map((s) => s.name), "Tanto faz"]
        return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
          ...toNumberedOptions(staffOptions),
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

  if (bookingComplete && (interpretedHasAdditional || (nextState.pending_additional_count || 0) > 0)) {
    let extraCount = interpretedCount && interpretedCount > 0 ? interpretedCount : 0
    if (!extraCount && interpretedHasAdditional) extraCount = 1
    nextState.last_booking = {
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
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

  // Priorizar pergunta de preço: mesmo com staff+service (sem data), responder preço + botões como no WhatsApp
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
    // Rejeição para qualquer serviço que não esteja na lista do negócio (preço, agendamento, etc.)
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
      return buildResult(cordial + " " + buildServicesListWithPrices(config), nextState)
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

  if (state.pending_contact_field) {
    if (state.pending_contact_field === "name") {
      const name = text.trim()
      if (!name) {
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      nextState.slots.customer_name = name
      nextState.pending_contact_field = undefined
    } else if (state.pending_contact_field === "contact_preference") {
      const prefOptions = ["Só celular", "Só email", "Celular e email"]
      const prefInput = resolveOptionByNumber(text, prefOptions) || text
      const t = prefInput.toLowerCase().trim()
      let pref: "phone" | "email" | "both" | null = null
      // Reconhece "celular mesmo", "só celular", "cell", etc.
      if (/(s[oó]|apenas)\s*celular|celular\s*(apenas|mesmo)|celular\s+\d/.test(t)) pref = "phone"
      else if (/(s[oó]|apenas)\s*email|email\s*apenas/.test(t)) pref = "email"
      else if (/(ambos|celular\s*e\s*email|os\s*dois)/.test(t)) pref = "both"
      if (!pref) {
        pref = await extractContactPreferenceFromText(prefInput, history)
      }
      if (pref === "phone") {
        nextState.contact_preference = "phone"
        nextState.pending_contact_field = undefined
        // Se a mensagem já contém o número (ex: "Celular mesmo 11972763228"), extrair e não perguntar de novo
        const phoneFromText = parsePhone(text)
        if (phoneFromText) {
          nextState.slots.customer_phone = phoneFromText
          // não retorna aqui; o fluxo continua abaixo e avança para o próximo passo
        } else {
          nextState.pending_contact_field = "phone"
          return buildResult("Qual seu celular com DDD?", nextState)
        }
      } else if (pref === "email") {
        nextState.contact_preference = "email"
        nextState.pending_contact_field = undefined
        const emailFromText = parseEmail(text)
        if (emailFromText) {
          nextState.slots.customer_email = emailFromText
        } else {
          nextState.pending_contact_field = "email"
          return buildResult("Qual seu email?", nextState)
        }
      } else if (pref === "both") {
        nextState.contact_preference = "both"
        nextState.pending_contact_field = undefined
        const phoneFromText = parsePhone(text)
        if (phoneFromText) {
          nextState.slots.customer_phone = phoneFromText
          nextState.pending_contact_field = "email"
          return buildResult("Qual seu email?", nextState)
        }
        nextState.pending_contact_field = "phone"
        return buildResult("Qual seu celular com DDD?", nextState)
      } else {
        return buildResult(
          "Como prefere ser contatado? Escolha: Só celular, Só email ou Celular e email.",
          nextState,
          prefOptions
        )
      }
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
    let date = parseDateOrWeekday(dateInput)
    if (date) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const usedWeekday = !hasExplicitDate(dateInput) && parseWeekdayDate(dateInput)
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
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
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
      if (nextState.slots.date === getTodayIsoBusinessTz() && isTimeTooSoonForDate(nextState.slots.date, time)) {
        const msg =
          `Este horario nao pode ser agendado agora. Trabalhamos com antecedencia minima de ${MIN_BOOKING_LEAD_MINUTES} minutos. Qual horario voce prefere?`
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

  if (!nextState.slots.service) {
    const prompt = buildServicePrompt(config, text, {
      date: nextState.slots.date,
      time: nextState.slots.time,
      time_period: nextState.slots.time_period,
      attendee_name: nextState.slots.attendee_name,
    })
    nextState.last_service_options = buildServiceOptions(config.services || [])
    return buildResult(prompt.message, nextState, toNumberedOptions(prompt.action_options))
  }

  if (!nextState.slots.date) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const days = schedule?.days_of_week || []
    const dayOpts = buildStaffDayOptions(days)
    const prefix = nextState.slots.time
      ? `Anotei ${nextState.slots.service} no horario ${nextState.slots.time}. `
      : nextState.slots.time_period
        ? `Anotei ${nextState.slots.service} no periodo ${formatTimePeriod(nextState.slots.time_period)}. `
        : `Certo, ${nextState.slots.service}. `
    return buildResult(
      `${prefix}Qual dia voce prefere? (ex: Hoje, Amanha ou dia da semana)`,
      nextState,
      toNumberedOptions(dayOpts)
    )
  }

  if (!nextState.slots.time) {
    const timeFromNumber =
      Array.isArray(state.last_time_options) && state.last_time_options.length > 0
        ? resolveOptionByNumber(text, state.last_time_options)
        : null
    if (timeFromNumber) {
      // Validar antes de aceitar: não permitir horário passado ou sem buffer mínimo para hoje
      if (nextState.slots.date && isTimeTooSoonForDate(nextState.slots.date, timeFromNumber)) {
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
        nextState.last_time_options = availability.available.slice(0, 24)
        nextState.last_time_options_date = nextState.slots.date
        nextState.last_time_options_staff = nextState.slots.staff_name
        return buildResult(
          `Este horário não pode ser agendado agora. Trabalhamos com antecedência mínima de ${MIN_BOOKING_LEAD_MINUTES} minutos. Qual horário você prefere?`,
          nextState,
          toNumberedOptions(availability.available.slice(0, 24))
        )
      }
      nextState.slots.time = timeFromNumber
    }
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
    const options = availability.available.slice(0, 24)
    if (availability.available.length === 0) {
      const otherStaff = getOtherStaffOptions(config, nextState.slots.staff_name)
      const closedToday =
        nextState.slots.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
      const msg = closedToday
        ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : otherStaff.length > 0
          ? `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`
          : `Esse dia esta cheio. Quer tentar outro dia?`
      const optionList = closedToday
        ? [...getOtherDayOptions(schedule), ...otherStaff]
        : otherStaff.length > 0
          ? [...otherStaff, "Outro dia"]
          : ["Outro dia"]
      return buildResult(msg, nextState, toNumberedOptions(optionList))
    }
    nextState.last_time_options = options
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    if (nextState.slots.time_period) {
      return buildResult(
        `Perfeito, ${formatTimePeriod(nextState.slots.time_period)}. Qual horario voce prefere?`,
        nextState,
        toNumberedOptions(options)
      )
    }
    return buildResult("Qual horario voce prefere?", nextState, toNumberedOptions(options))
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
    if (isTimeTooSoonForDate(dateIso, time)) {
      nextState.slots.time = undefined
      nextState.last_time_options = availability.available.slice(0, 24)
      nextState.last_time_options_date = dateIso
      nextState.last_time_options_staff = nextState.slots.staff_name
      return buildResult(
        `Esse horario nao esta disponivel para agora. A antecedencia minima e de ${MIN_BOOKING_LEAD_MINUTES} minutos. Vou te mostrar os proximos horarios livres.`,
        nextState,
        toNumberedOptions(availability.available.slice(0, 24))
      )
    }
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
          attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
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
      return buildResult(finalResult.message, nextState)
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
      ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : "Esse dia esta cheio. Quer tentar outro dia?",
    nextState,
    closedToday ? getOtherDayOptions(schedule) : undefined
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
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string
): Promise<SimulatorResult> {
  const incomingText = input.trim()
  const singleOptionResolved =
    /^[1-9]\d*$/.test(incomingText) &&
    Array.isArray(state.last_action_options) &&
    state.last_action_options.length === 1
      ? resolveOptionByNumber(incomingText, state.last_action_options)
      : null
  const text = singleOptionResolved || incomingText
  const nextState: SimulatorState = {
    ...state,
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const isFirst = isFirstMessage(state)

  // Conversa finalizada: responder só o que foi perguntado (endereço, horários etc.) sem pedir confirmação de novo
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
    // Primeiro: perguntas sobre a marcação do próprio cliente (ex: "qual dia e horário foi marcado?")
    if (isMyBookingQuestion(msg)) {
      const myBookingAnswer = getMyBookingAnswer(nextState)
      if (myBookingAnswer) {
        nextState.final_thanks_sent = true
        return buildResult(myBookingAnswer, nextState)
      }
    }
    // Depois: outras perguntas informativas (endereço, horários, serviços) — resposta direta, sem pedir confirmação
    const infoAnswer = tryAnswerInformationalQuestion(config, text)
    if (infoAnswer) {
      nextState.final_thanks_sent = true
      return buildResult(infoAnswer, nextState)
    }
    // Depois: IA para outras mensagens (finalized = não pedir dados/confirmação de novo)
    const aiAnswer = await answerWithContextualAI(config, text, history, true)
    if (aiAnswer) {
      nextState.final_thanks_sent = true
      return buildResult(aiAnswer, nextState)
    }
    nextState.final_thanks_sent = true
    return buildResult("Se precisar de algo no futuro, fico à disposição.", nextState)
  }

  // PRIORIDADE: Se é primeira mensagem, processar contexto ANTES de qualquer outra coisa
  if (isFirst && !nextState.mode && !nextState.step) {
    const greeting = getGreetingMessage(config)

    // Perguntas informativas (endereço, horários) em qualquer momento — resposta direta do cadastro
    const firstInfoAnswer = tryAnswerInformationalQuestion(config, text)
    if (firstInfoAnswer) {
      return buildResult(`${greeting}\n\n${firstInfoAnswer}`, { ...nextState, step: "qualification" }, ["Quero agendar"])
    }

    // Primeira mensagem com intenção explícita de agendamento deve ir direto para fluxo de booking,
    // mesmo sem "oi/olá" e mesmo sem citar serviço.
    if (isExplicitBookingIntent(text)) {
      nextState.mode = "booking"
      nextState.step = undefined
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState, history, senderDisplayName)
      }
      const prompt = buildServicePrompt(config, text, { attendee_name: nextState.slots.attendee_name })
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    // Pergunta de preço ou lista de serviços no início: responder de forma cordial e objetiva
    if (isListServicesQuestion(text)) {
      const listMsg = buildServicesListWithPrices(config)
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(`${greeting}\n\n${listMsg}`, { ...nextState, step: "qualification", last_service_options: serviceOptions })
    }
    if (isServiceDetailQuestion(text)) {
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (svc?.description) {
        return buildResult(greeting + " " + `${svc.name}: ${svc.description} Quer agendar?`, nextState, ["Quero agendar"])
      }
      if (serviceName) {
        return buildResult(
          greeting + " " + `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`,
          nextState,
          ["Quero agendar"]
        )
      }
    }
    if (isPriceQuestion(text)) {
      const priceIntro = `Obrigado por entrar em contato${config.business_name ? ` com a ${config.business_name}` : ""}.`
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        return buildResult(
          priceIntro + " " + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (serviceName && svc) {
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(priceIntro + " " + noPrice.message, nextState, noPrice.action_options)
      }
      if (!serviceName && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
          return buildResult(`${greeting} ${rejectionMessage}`, { ...nextState, step: "qualification_rejected" })
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildResult(priceIntro + " " + buildServicesListWithPrices(config), nextState)
      }
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(priceIntro + " " + noPrice.message, nextState, noPrice.action_options)
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
        // Pergunta de preço deve responder preço primeiro, sem puxar disponibilidade.
        if (isPriceQuestion(text)) {
          const priced = getServiceWithPrice(config.services || [], match.service)
          if (priced?.base_price != null) {
            return buildResult(
              `${greeting} O ${priced.name} está R$ ${Number(priced.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
              nextState,
              ["Quero agendar", "Só queria saber"]
            )
          }
          const noPrice = buildPriceNotAvailableMessage(config, match.service)
          return buildResult(`${greeting} ${noPrice.message}`, nextState, noPrice.action_options)
        }
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        const thanks = config.business_name ? `Obrigado por escolher a ${config.business_name}. ` : ""
        const intro = `${greeting}${thanks}Entendi, você precisa de ajuda com ${match.service}. `
        if (config.context_mode === "booking") {
          const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
          return buildResult(intro + " " + result.message, result.state, result.action_options)
        }
        if (config.context_mode === "quote") {
          return buildResult(`${intro}O que você precisa orçar?`, nextState)
        }
        return buildResult(`${intro}Você prefere agendar um horário ou pedir um orçamento?`, nextState)
      }

      // Sem match exato: verificar se é pedido genérico + múltiplos ANTES de rejeitar
      const orchestrator = await interpretFlowWithAI(text, history, nextState, config)
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      const hasMultiple = interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple"
      const isGenericList = orchestrator?.suggested_action === "list_services"
      const areaMatches = areaMatchesServices(match.inferred_area, config.services || [])

      // Pedido genérico ou temos serviços relacionados: listar em vez de rejeitar
      if ((isGenericList || areaMatches) && !match.reject) {
        const listMsg = buildServicesListWithPrices(config)
        if (hasMultiple) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
          nextState.mode = "booking"
          nextState.step = undefined
          return buildResult(
            `${greeting}\n\n${buildMultiBookingIntro()} ${listMsg}\n\nDe quem será o primeiro agendamento?`,
            nextState,
            ["Quero agendar"]
          )
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        return buildResult(`${greeting}\n\n${listMsg}`, { ...nextState, step: "qualification", last_service_options: serviceOptions })
      }

      if (hasContext && match.reject) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, hasContext)
        return buildResult(`${greeting}${rejectionMessage}`, { ...nextState, step: "qualification_rejected" })
      }
      if (hasContext && !areaMatches) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, hasContext)
        return buildResult(`${greeting}${rejectionMessage}`, { ...nextState, step: "qualification_rejected" })
      }

      if (orchestrator?.confidence >= 0.5 && orchestrator.suggested_action === "no_match_fallback") {
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer) return buildResult(`${greeting}${aiAnswer}`, { ...nextState, step: "qualification" })
        return buildResult(`${greeting}${buildGenericFallback(config)}`, { ...nextState, step: "qualification" })
      }
      return buildResult(greeting, { ...nextState, step: "qualification" })
    }

    if (isGreeting(text)) {
      return buildResult(greeting, { ...nextState, step: "qualification" })
    }

    return buildResult(greeting, { ...nextState, step: "qualification" })
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
          const interpreted = await interpretAdditionalBookingsWithAI(text, {
            has_completed_booking: false,
            history,
          })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          } else if (interpreted?.for_whom) {
            nextState.slots.attendee_name = interpreted.for_whom
          }
          return buildResult(
            cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
            nextState,
            ["Quero agendar", "Só queria saber"]
          )
        }
        const withPrice = (config.services || []).filter((s) => s.base_price != null)
        if (withPrice.length > 0) {
          nextState.mode = "booking"
          nextState.step = undefined
          const interpreted = await interpretAdditionalBookingsWithAI(text, {
            has_completed_booking: false,
            history,
          })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          } else if (interpreted?.for_whom) {
            nextState.slots.attendee_name = interpreted.for_whom
          }
          const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
          nextState.last_service_options = serviceOptions
          return buildResult(getCordialPrefix(config, false) + " " + buildServicesListWithPrices(config), nextState)
        }
      }
      if (orchestrator.suggested_action === "list_services") {
        const listMsg = buildListServicesMessage(config, { intro: "after_generic" })
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        return buildResult(listMsg, { ...nextState, step: "qualification", last_service_options: serviceOptions })
      }
      if (orchestrator.suggested_action === "start_booking") {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
          return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
        }
        if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
        const serviceFromOrchestrator = orchestrator.inferred_service ? getServiceWithPrice(config.services || [], orchestrator.inferred_service) : null
        const msgNorm = normalizeText(text)
        const useOrchestratorService =
          serviceFromOrchestrator && msgNorm.includes(normalizeText(serviceFromOrchestrator.name))
        const serviceFromText = findServiceFromText(text, config.services || [])
        const identifiedService =
          (useOrchestratorService ? serviceFromOrchestrator?.name : null) ||
          (serviceFromText ? getServiceWithPrice(config.services || [], serviceFromText)?.name : null) ||
          serviceFromText
        if (identifiedService) {
          nextState.slots.service = identifiedService
          nextState.just_identified_service = true
          const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
          const intro = buildBookingConfirmationIntro(config)
          return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
        }
        const prompt = buildServicePrompt(config, text)
        nextState.last_service_options = buildServiceOptions(config.services || [])
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
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
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
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildResult(cordial + " " + buildServicesListWithPrices(config), nextState)
      }
    }
    if (isExplicitBookingIntent(text)) {
      nextState.mode = "booking"
      nextState.step = undefined
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState, history, senderDisplayName)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
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
    // Detecção contextual em TODO momento: perguntas informativas (endereço, horários) ou transição para agendamento
    const infoAnswer = tryAnswerInformationalQuestion(config, text)
    if (infoAnswer) {
      return buildResult(infoAnswer, nextState)
    }

    // Triagem: SEMPRE verificar contexto da mensagem antes de mostrar menu (ex.: "meu filho foi preso" após "olá")
    if (
      !isGreeting(text) &&
      (config.services || []).length > 0 &&
      !nextState.slots.service &&
      (config.lead_policy?.reject_unlisted_services || config.lead_policy?.use_ai_matching)
    ) {
      const match = await classifyServiceMatch(text, config)
      const hasContext = hasMatchContext(match)
      if (match.service) {
        nextState.slots.service = match.service
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const areaMatches = areaMatchesServices(match.inferred_area, config.services || [])
      if (match.reject || (hasContext && !match.service && !areaMatches)) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
      }
    }

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
        if (!svc && isPriceQuestion(text) && (config.services || []).length > 0) {
          const match = await classifyServiceMatch(text, config)
          if (hasMatchContext(match) && !match.service) {
            const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
            return buildResult(rejectionMessage, nextState)
          }
        }
        if (svc && svc.base_price != null) {
          nextState.slots.service = svc.name
          nextState.just_identified_service = true
          nextState.step = undefined
          nextState.mode = "booking"
          const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          } else if (interpreted?.for_whom) {
            nextState.slots.attendee_name = interpreted.for_whom
          }
          return buildResult(
            cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
            nextState,
            ["Quero agendar", "Só queria saber"]
          )
        }
        const withPrice = (config.services || []).filter((s) => s.base_price != null)
        if (withPrice.length > 0) {
          nextState.mode = "booking"
          nextState.step = undefined
          const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
          if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
            nextState.pending_additional_booking = true
            nextState.pending_attendee_name = true
            nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
            nextState.expected_additional_count = nextState.pending_additional_count
          } else if (interpreted?.for_whom) {
            nextState.slots.attendee_name = interpreted.for_whom
          }
          const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
          nextState.last_service_options = serviceOptions
          return buildResult(cordial + " " + buildServicesListWithPrices(config), nextState)
        }
      }
      if (orchestrator.suggested_action === "list_services") {
        if (isPriceQuestion(text) && (config.services || []).length > 0) {
          const match = await classifyServiceMatch(text, config)
          if (hasMatchContext(match) && !match.service) {
            const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
            return buildResult(rejectionMessage, nextState)
          }
        }
        const listMsg = buildListServicesMessage(config, { intro: "after_generic" })
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        return buildResult(listMsg, { ...nextState, last_service_options: serviceOptions })
      }
      if (orchestrator.suggested_action === "start_booking") {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
          return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
        }
        if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
        const serviceFromOrchestrator = orchestrator.inferred_service ? getServiceWithPrice(config.services || [], orchestrator.inferred_service) : null
        const msgNorm = normalizeText(text)
        const useOrchestratorService =
          serviceFromOrchestrator && msgNorm.includes(normalizeText(serviceFromOrchestrator.name))
        const serviceFromText = findServiceFromText(text, config.services || [])
        const identifiedService =
          (useOrchestratorService ? serviceFromOrchestrator?.name : null) ||
          (serviceFromText ? getServiceWithPrice(config.services || [], serviceFromText)?.name : null) ||
          serviceFromText
        if (identifiedService) {
          nextState.slots.service = identifiedService
          nextState.just_identified_service = true
          const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
          const intro = buildBookingConfirmationIntro(config)
          return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
        }
        const prompt = buildServicePrompt(config, text)
        nextState.last_service_options = buildServiceOptions(config.services || [])
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
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }
    if (isListServicesQuestion(text)) {
      const listMsg = buildServicesListWithPrices(config)
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(cordial + listMsg, { ...nextState, last_service_options: serviceOptions })
    }
    if (isPriceQuestion(text)) {
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        return buildResult(
          cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
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
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildResult(cordial + " " + buildServicesListWithPrices(config), nextState)
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
    const greeting = getGreetingMessage(config)
    return buildResult(greeting, { ...nextState, step: "qualification" })
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
          cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
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
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
          return buildResult(rejectionMessage, nextState)
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildResult(cordial + " " + buildServicesListWithPrices(config), nextState)
      }
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }
    if (isListServicesQuestion(text)) {
      const cordial = getCordialPrefix(config, isFirst)
      const listMsg = buildServicesListWithPrices(config)
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(cordial + listMsg, { ...nextState, last_service_options: serviceOptions })
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
      const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
      return buildResult(result.message, result.state, result.action_options)
    }
    return await resolveBooking(config, text, nextState, history, senderDisplayName)
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

/** Cria um agente default para tenant de simulador (onboarding) que ainda não tem agente. */
async function getOrCreateAgentForSimTenant(supabaseAdmin: any, tenantId: string, tenantName?: string) {
  const { data: existing } = await supabaseAdmin
    .from("agent")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data: newAgent, error } = await supabaseAdmin
    .from("agent")
    .insert({
      tenant_id: tenantId,
      name: tenantName || "Agente Simulador",
      status: "active",
      channel_primary: "web",
    })
    .select("id")
    .single()
  if (error) throw error

  await supabaseAdmin.from("agent_setting").insert({
    agent_id: newAgent.id,
    tone: "professional",
    language: "pt-BR",
    handoff_mode: "conditional",
    business_config: {},
    when_client_asks_price_no_value: "offer_handoff_or_booking",
  })
  return newAgent.id
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

  // Sem conversation_id (ex.: WhatsApp): reutilizar conversa aberta do mesmo contato/canal para manter estado igual ao simulador
  const { data: existingRows } = await supabaseAdmin
    .from("conversation")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1)
  const existingByContact = Array.isArray(existingRows) ? existingRows[0] : null
  if (existingByContact) return existingByContact

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

    const ctxLead = body.context?.lead_policy
    const leadPolicy =
      typeof ctxLead === "object" && ctxLead !== null
        ? { reject_unlisted_services: true, use_ai_matching: true, ...ctxLead }
        : { reject_unlisted_services: true, use_ai_matching: true }

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
      lead_policy: leadPolicy,
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
      agentId = await getOrCreateAgentForSimTenant(supabaseAdmin, tenant.id, config.business_name)
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

    // Comando para encerrar/reiniciar a conversa (testes): zera o estado e responde que pode começar de novo
    if (isEndTestCommand(body.message)) {
      const resetState = createSimulatorState()
      const nowIso = new Date().toISOString()
      const replyText = "Conversa encerrada. Quando quiser, é só mandar uma mensagem para começar de novo."
      await supabaseAdmin.from("conversation_messages").insert([
        { tenant_id: tenant.id, conversation_id: conversation.id, role: "user", content_text: body.message, metadata: { channel: channelType } },
        { tenant_id: tenant.id, conversation_id: conversation.id, role: "assistant", content_text: replyText, metadata: { channel: channelType } },
      ])
      await supabaseAdmin
        .from("conversation")
        .update({
          state_json: { state: resetState, channel: channelType },
          last_message_at: nowIso,
        })
        .eq("id", conversation.id)
        .eq("tenant_id", tenant.id)
      return json({
        conversation_id: conversation.id,
        messages: [{ role: "assistant", content: replyText, created_at: nowIso, action_options: undefined }],
      })
    }

    // Verificar se é a primeira mensagem da conversa
    const { count: messageCount } = await supabaseAdmin
      .from("conversation_messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("role", "user")
    const isFirstMessage = (messageCount || 0) === 0

    const stateFromConversation = (conversation.state_json?.state as SimulatorState) || createSimulatorState()

    const mergeBookedSlots = (
      base?: Record<string, Record<string, string[]>>,
      extra?: Record<string, Record<string, string[]>>
    ): Record<string, Record<string, string[]>> => {
      const merged: Record<string, Record<string, string[]>> = {}
      const sources = [base || {}, extra || {}]
      for (const src of sources) {
        for (const staffKey of Object.keys(src)) {
          if (!merged[staffKey]) merged[staffKey] = {}
          const byDate = src[staffKey] || {}
          for (const dateIso of Object.keys(byDate)) {
            const existing = new Set(merged[staffKey][dateIso] || [])
            for (const t of byDate[dateIso] || []) existing.add(t)
            merged[staffKey][dateIso] = Array.from(existing).sort()
          }
        }
      }
      return merged
    }

    const toBusinessDateTime = (value: string): { dateIso: string; time: string } => {
      const dt = new Date(value)
      return {
        dateIso: dt.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
        time: dt.toLocaleTimeString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      }
    }

    // Hidrata agenda ocupada real para filtrar horários indisponíveis (além dos slots deste turno).
    const todayIso = getTodayIsoBusinessTz()
    const { data: appointmentRows, error: appointmentRowsError } = await supabaseAdmin
      .from("appointment")
      .select("staff_name, start_at, status")
      .eq("tenant_id", tenant.id)
      .eq("agent_id", agentId)
      .neq("status", "cancelled")
      .gte("start_at", `${todayIso}T00:00:00.000-03:00`)
      .limit(3000)
    if (appointmentRowsError) {
      console.error("appointment hydration error:", appointmentRowsError)
    }
    let persistedBookedSlots: Record<string, Record<string, string[]>> = {}
    for (const row of (appointmentRows || []) as Array<{ staff_name?: string | null; start_at?: string | null }>) {
      if (!row?.staff_name || !row?.start_at) continue
      const { dateIso, time } = toBusinessDateTime(row.start_at)
      persistedBookedSlots = addBookedSlot(persistedBookedSlots, row.staff_name, dateIso, time)
    }

    const currentState: SimulatorState = {
      ...stateFromConversation,
      booked_slots: mergeBookedSlots(persistedBookedSlots, stateFromConversation.booked_slots),
    }
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

    // WhatsApp: janela de 24h sem interação encerra (só templates depois). Avisar se inatividade próxima do limite.
    const SESSION_WARN_HOURS = 18
    const SESSION_WINDOW_HOURS = 24
    let sessionExpiryWarning: string | null = null
    if (channelType === "whatsapp") {
      const { data: lastUserRows } = await supabaseAdmin
        .from("conversation_messages")
        .select("created_at")
        .eq("conversation_id", conversation.id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
      const lastUserMsg = Array.isArray(lastUserRows) ? lastUserRows[0] : null
      const lastAt = lastUserMsg?.created_at
      if (lastAt) {
        const lastMs = new Date(lastAt).getTime()
        const nowMs = Date.now()
        const hoursSince = (nowMs - lastMs) / (60 * 60 * 1000)
        if (hoursSince >= SESSION_WARN_HOURS && hoursSince < SESSION_WINDOW_HOURS) {
          const hoursLeft = Math.max(0.5, Math.floor((SESSION_WINDOW_HOURS - hoursSince) * 10) / 10)
          const nome = (currentState as SimulatorState).slots?.customer_name
            || (currentState as SimulatorState).slots?.attendee_name
            || contact?.display_name
            || ""
          const nomePart = nome ? `Oi ${nome}, ` : "Oi, "
          sessionExpiryWarning =
            `${nomePart}ainda está aí? Esta conversa vai encerrar em cerca de ${hoursLeft} hora(s) se não houver mais interação.`
        }
      }
    }

    const senderDisplayName = (body as { sender_display_name?: string }).sender_display_name?.trim() || undefined
    let result: SimulatorResult
    try {
      result = await processSimulatorMessage(body.message, config, stateWithFirstFlag, history, senderDisplayName)
    } catch (err) {
      console.error("processSimulatorMessage error:", err)
      result = {
        message: "Desculpe, tive um problema ao processar. Pode repetir?",
        state: stateWithFirstFlag,
        action_options: undefined,
      }
    }
    const rewritten = await rewriteWithTone(result.message, config.tone)
    const finalMessage = sessionExpiryWarning
      ? `${sessionExpiryWarning}\n\n${rewritten.message}`
      : rewritten.message

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
        content_text: finalMessage,
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
        // Horário é em hora local do negócio (Brasil). Usar -03:00 para que 15:30 local = 18:30 UTC
        // (evita bug onde 15:30 era armazenado como UTC e exibia 12:30 no calendário)
        const startAt = `${date}T${time}:00.000-03:00`
        const duration = getServiceDurationMinutes(config, service) ?? 30
        const endAt = new Date(Date.parse(startAt) + duration * 60 * 1000).toISOString()
        const { error: insErr } = await supabaseAdmin.from("appointment").insert({
          tenant_id: tenantIdForAppointment,
          agent_id: agentId,
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
          content: finalMessage,
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

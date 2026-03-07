// @ts-nocheck
/** Handler: escolha de serviço (número/texto), attendee_name, second_service, template_choice, multi-pessoas. */
import type { SimulatorResult } from "../types.ts"
import { buildResult } from "../state.ts"
import { buildServiceOptions, buildMultiBookingIntro } from "../builders.ts"
import { getScheduleForStaff, getStaffList, getOtherStaffOptions } from "../staff.ts"
import {
  resolveOptionByNumber,
  resolveMultipleOptionsByNumber,
  formatDatePt,
  parseTemplateChoice,
  getTodayIsoBusinessTz,
  getMockAvailability,
  isBusinessClosedForToday,
  normalizeText,
  toMinutes,
  fromMinutes,
} from "../utils.ts"
import { getNextAvailableSlot, buildStaffDayOptions } from "../staff.ts"
import { getServicesTotalDuration, getServicesTotalDurationOrFallback, findServiceFromText } from "../services.ts"
import { getSequenceServicesFromText } from "../anytime-handlers.ts"
import { isVisitRequest, looksLikeAttendeeName, isExplicitBookingIntent } from "../detection.ts"
import { extractAttendeeNameForMultiBooking } from "../ai.ts"
import type { BookingContext } from "./context.ts"

export async function handleService(ctx: BookingContext): Promise<SimulatorResult | null> {
  const {
    config,
    text,
    state,
    nextState,
    toNumberedOptions,
    getOtherDayOptions,
    interpretedHasAdditional,
    interpretedCount,
    explicitService,
    wasAdditionalPending,
    lastAssistantMsg,
    slotsInterpretation,
    waitingFor,
  } = ctx

  const isDigitOnlyEarly = /^[1-9]\d*$/.test(text.trim())
  const lastCompletedFromNextState =
    Array.isArray(nextState.completed_bookings) && nextState.completed_bookings.length > 0
      ? nextState.completed_bookings[nextState.completed_bookings.length - 1]
      : undefined
  const lastCompletedFromState =
    Array.isArray(state.completed_bookings) && state.completed_bookings.length > 0
      ? state.completed_bookings[state.completed_bookings.length - 1]
      : undefined
  const referenceBooking =
    lastCompletedFromNextState || lastCompletedFromState || nextState.last_booking || state.last_booking
  const inferredTemplateChoice = parseTemplateChoice(text, state.last_template_options || undefined)
  const lastAssistantNorm = normalizeText(String(lastAssistantMsg || ""))
  const completedCount =
    (nextState.completed_bookings?.length ?? state.completed_bookings?.length ?? 0)
  const hasServicePromptContext =
    Array.isArray(state.last_service_options) &&
    state.last_service_options.length > 0 &&
    /(qual|que)[\s\w]*servico/.test(lastAssistantNorm)
  const awaitingSequenceServiceChoice =
    Boolean(nextState.pending_second_service_choice) ||
    Boolean(
      referenceBooking &&
      completedCount > 0 &&
      !nextState.slots.date &&
      !nextState.slots.time &&
      hasServicePromptContext
    )

  // Trava definitiva: ao escolher "mesmo dia e colaborador (proximo horario)",
  // calcular e sugerir diretamente o slot em sequencia usando o ultimo booking concluido.
  if (
    inferredTemplateChoice === "same_next" &&
    referenceBooking &&
    !awaitingSequenceServiceChoice
  ) {
    nextState.service_selection_multi = false
    nextState.last_service_options = undefined
    if (!nextState.last_booking) nextState.last_booking = referenceBooking
    const defaultService =
      nextState.slots.service ||
      (nextState.pending_default_service_locked ? nextState.pending_default_service : undefined)
    if (!defaultService) {
      nextState.pending_second_service_choice = true
      const canSequenceSecond = config.allow_sequence_booking
      const sequenceList =
        (config.sequence_eligible_services?.length ?? 0) > 0
          ? config.sequence_eligible_services!
          : (config.services || []).map((s) => s.name).filter(Boolean)
      if (canSequenceSecond && sequenceList.length > 0) {
        nextState.service_selection_multi = true
        const sequenceOpts = [...sequenceList, "Quero agendar uma visita"]
        nextState.last_service_options = sequenceOpts
        return buildResult(
          `Certo! Qual servico voce gostaria de agendar para ${nextState.slots.attendee_name || "essa pessoa"}? (pode escolher mais de um)`,
          nextState,
          toNumberedOptions(sequenceOpts)
        )
      }
      nextState.service_selection_multi = false
      const serviceList = buildServiceOptions(config.services || [])
      const numberedServiceOpts = serviceList.map((o, i) => `${i + 1} - ${o}`)
      return buildResult(
        `Certo! Qual servico voce gostaria de agendar para ${nextState.slots.attendee_name || "essa pessoa"}?`,
        nextState,
        numberedServiceOpts
      )
    }
    if (defaultService) nextState.slots.service = defaultService
    if (referenceBooking.date) nextState.slots.date = referenceBooking.date
    if (referenceBooking.staff_name) nextState.slots.staff_name = referenceBooking.staff_name

    const referenceStaffName = referenceBooking.staff_name || nextState.slots.staff_name || getStaffList(config)[0]?.name
    if (referenceBooking.date && referenceStaffName && defaultService) {
      const secondDuration = getServicesTotalDurationOrFallback(config, defaultService)
      const firstDuration =
        (referenceBooking as any)?.duration_minutes ??
        getServicesTotalDurationOrFallback(config, referenceBooking.service) ??
        30
      const firstEndMins = toMinutes(referenceBooking.time) + firstDuration
      const firstEndTime = fromMinutes(firstEndMins)
      const nextSlot = getNextAvailableSlot(
        referenceBooking.date,
        config,
        nextState.booked_slots,
        referenceStaffName,
        firstEndTime,
        secondDuration ?? undefined
      )
      if (nextSlot) {
        nextState.slots.time = nextSlot
        nextState.slots.staff_name = referenceStaffName
        const firstName = referenceBooking.attendee_name || "o primeiro"
        const secondName = nextState.slots.attendee_name || "ele"
        const confirmOpts = [
          `1 - Sim, ${nextSlot}`,
          "2 - Outro horario no mesmo dia",
          "3 - Outro dia",
          ...(getOtherStaffOptions(config, referenceStaffName).length > 0
            ? ["4 - Mesmo horario com outro colaborador"]
            : []),
        ]
        nextState.last_confirm_options = confirmOpts
        return buildResult(
          `Otimo, vamos agendar ${secondName} em seguida ao ${firstName}. Sugeri ${nextSlot} em ${formatDatePt(referenceBooking.date)}. Posso confirmar?`,
          nextState,
          confirmOpts
        )
      }
      const hasOtherStaff = getOtherStaffOptions(config, referenceStaffName).length > 0
      const msg = hasOtherStaff
        ? "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia ou manter esse horario com outro colaborador?"
        : "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia?"
      return buildResult(msg, nextState, [
        "1 - Outro dia",
        ...(hasOtherStaff ? ["2 - Mesmo horario com outro colaborador"] : []),
      ])
    }
  }

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
    nextState.service_selection_multi = false
    nextState.last_service_options = undefined
    nextState.slots.date = undefined
    nextState.slots.time = undefined
    nextState.slots.time_period = undefined
    nextState.pending_date_confirmation = undefined
    nextState.last_time_options = undefined
    nextState.last_time_options_date = undefined
    nextState.last_time_options_staff = undefined
    const staffName = nextState.slots.staff_name || getStaffList(config)[0]?.name
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

  const shouldPrioritizeCurrentServiceAnswer =
    waitingFor === "service" &&
    Array.isArray(state.last_service_options) &&
    state.last_service_options.length > 0 &&
    !nextState.pending_template_choice &&
    !nextState.pending_second_service_choice &&
    !nextState.pending_attendee_name

  if (state.pending_second_service_choice || awaitingSequenceServiceChoice) {
    nextState.pending_second_service_choice = true
    const serviceOptions =
      state.service_selection_multi && Array.isArray(state.last_service_options) && state.last_service_options.length > 0
        ? state.last_service_options
        : buildServiceOptions(config.services || [])
    const canSequence = config.allow_sequence_booking
    const multiSelectedByNumber =
      canSequence &&
      state.service_selection_multi &&
      Array.isArray(state.last_service_options) &&
      state.last_service_options.length > 0
        ? resolveMultipleOptionsByNumber(text, state.last_service_options)
        : []
    const multiSelectedByText = canSequence ? getSequenceServicesFromText(config, text) : []
    const resolvedMulti =
      multiSelectedByNumber.length > 0
        ? multiSelectedByNumber
        : multiSelectedByText.length > 0
          ? multiSelectedByText
          : []
    const resolvedSingle = resolveOptionByNumber(text, serviceOptions) || findServiceFromText(text, config.services || [])
    const serviceNames = (config.services || []).map((s) => s.name).filter(Boolean)
    const resolvedServiceValue =
      resolvedMulti.length > 0
        ? resolvedMulti.filter((s) => s !== "Quero agendar uma visita").join(", ") || "visita"
        : resolvedSingle && (resolvedSingle === "Quero agendar uma visita" || serviceNames.includes(resolvedSingle))
          ? (resolvedSingle === "Quero agendar uma visita" ? "visita" : resolvedSingle)
          : null
    if (resolvedServiceValue) {
      nextState.pending_second_service_choice = false
      nextState.slots.service = resolvedServiceValue
      nextState.service_selection_multi = false
      nextState.last_service_options = undefined
      const last =
        lastCompletedFromNextState || lastCompletedFromState || nextState.last_booking || state.last_booking
      const lastStaffName = last?.staff_name || nextState.slots.staff_name || getStaffList(config)[0]?.name
      if (last?.date && lastStaffName) {
        const secondDuration = getServicesTotalDurationOrFallback(config, nextState.slots.service)
        const firstDuration =
          (last as any)?.duration_minutes ??
          getServicesTotalDurationOrFallback(config, last.service) ??
          30
        const firstEndMins = toMinutes(last.time) + firstDuration
        const firstEndTime = fromMinutes(firstEndMins)
        const nextSlot = getNextAvailableSlot(
          last.date,
          config,
          nextState.booked_slots,
          lastStaffName,
          firstEndTime,
          secondDuration ?? undefined
        )
        if (nextSlot) {
          nextState.slots.date = last.date
          nextState.slots.time = nextSlot
          nextState.slots.staff_name = lastStaffName
          const firstName = last.attendee_name || "o primeiro"
          const confirmOpts = [
            `1 - Sim, ${nextSlot}`,
            "2 - Outro horario no mesmo dia",
            "3 - Outro dia",
            ...(getOtherStaffOptions(config, lastStaffName).length > 0
              ? ["4 - Mesmo horario com outro colaborador"]
              : []),
          ]
          nextState.last_confirm_options = confirmOpts
          return buildResult(
            `Otimo, vamos agendar ${nextState.slots.attendee_name || "ele"} em seguida ao ${firstName}. Sugeri ${nextSlot} em ${formatDatePt(last.date)}. Posso confirmar?`,
            nextState,
            confirmOpts
          )
        }
        const hasOtherStaff = getOtherStaffOptions(config, lastStaffName).length > 0
        const msg = hasOtherStaff
          ? "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia ou manter esse horario com outro colaborador?"
          : "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia?"
        return buildResult(msg, nextState, [
          "1 - Outro dia",
          ...(hasOtherStaff ? ["2 - Mesmo horario com outro colaborador"] : []),
        ])
      }
    } else {
      const canSequenceSecond = config.allow_sequence_booking
      const sequenceList =
        (config.sequence_eligible_services?.length ?? 0) > 0
          ? config.sequence_eligible_services!
          : (config.services || []).map((s) => s.name).filter(Boolean)
      if (canSequenceSecond && sequenceList.length > 0) {
        nextState.service_selection_multi = true
        const sequenceOpts = [...sequenceList, "Quero agendar uma visita"]
        nextState.last_service_options = sequenceOpts
        return buildResult(
          "Qual servico voce prefere para essa pessoa? (pode escolher mais de um)",
          nextState,
          toNumberedOptions(sequenceOpts)
        )
      }
      nextState.service_selection_multi = false
      const opts = buildServiceOptions(config.services || []).map((o, i) => `${i + 1} - ${o}`)
      return buildResult("Qual servico voce prefere? (responda com o numero ou nome)", nextState, opts)
    }
  }

  if ((!nextState.slots.service || shouldPrioritizeCurrentServiceAnswer) && !awaitingSequenceServiceChoice) {
    // 0) Texto livre baseado nas opcoes exibidas no multi-select (robusto mesmo com catalogo parcial).
    const normalizedInput = normalizeText(text)
    const presentedOptions =
      state.service_selection_multi &&
      Array.isArray(state.last_service_options) &&
      state.last_service_options.length > 0
        ? state.last_service_options.filter((opt) => normalizeText(opt) !== normalizeText("Quero agendar uma visita"))
        : []
    const selectedByPresentedText = presentedOptions.filter((opt) =>
      normalizedInput.includes(normalizeText(opt))
    )
    if (selectedByPresentedText.length >= 1) {
      const unique = Array.from(new Set(selectedByPresentedText))
      nextState.slots.service = unique.join(", ")
      nextState.service_selection_multi = false
      nextState.last_service_options = undefined
      nextState.slots.date = undefined
      nextState.slots.time = undefined
      nextState.slots.time_period = undefined
      nextState.pending_date_confirmation = undefined
      nextState.last_time_options = undefined
      nextState.last_time_options_date = undefined
      nextState.last_time_options_staff = undefined
      nextState.just_identified_service = true
      const staffName = nextState.slots.staff_name || getStaffList(config)[0]?.name
      const schedule = staffName ? getScheduleForStaff(config, staffName) : null
      const days = schedule?.days_of_week || []
      const dayOpts = buildStaffDayOptions(days)
      if (!nextState.slots.staff_name && staffName) nextState.slots.staff_name = staffName
      return buildResult(
        `Entendi, ${nextState.slots.service}. Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
        nextState,
        toNumberedOptions(dayOpts)
      )
    }

    // 1) Texto livre: "corte e barba" → múltiplos serviços (allow_sequence_booking)
    const sequenceServices = config.allow_sequence_booking ? getSequenceServicesFromText(config, text) : []
    if (sequenceServices.length >= 1) {
      nextState.slots.service = sequenceServices.join(", ")
      nextState.service_selection_multi = false
      nextState.last_service_options = undefined
      nextState.slots.date = undefined
      nextState.slots.time = undefined
      nextState.slots.time_period = undefined
      nextState.pending_date_confirmation = undefined
      nextState.last_time_options = undefined
      nextState.last_time_options_date = undefined
      nextState.last_time_options_staff = undefined
      nextState.just_identified_service = true
      const staffName = nextState.slots.staff_name || getStaffList(config)[0]?.name
      const schedule = staffName ? getScheduleForStaff(config, staffName) : null
      const days = schedule?.days_of_week || []
      const dayOpts = buildStaffDayOptions(days)
      if (!nextState.slots.staff_name && staffName) nextState.slots.staff_name = staffName
      const serviceLabel = nextState.slots.service
      return buildResult(
        `Entendi, ${serviceLabel}. Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
        nextState,
        toNumberedOptions(dayOpts)
      )
    }
    // 2) Multi-select por número: "1,2" ou "1 e 2" (quando UI enviou opções com service_selection_multi)
    const multiSelected =
      state.service_selection_multi &&
      Array.isArray(state.last_service_options) &&
      state.last_service_options.length > 0
        ? resolveMultipleOptionsByNumber(text, state.last_service_options)
        : []
    if (multiSelected.length >= 1) {
      const withoutVisita = multiSelected.filter((s) => s !== "Quero agendar uma visita")
      const serviceValue =
        withoutVisita.length === 0
          ? "visita"
          : withoutVisita.join(", ")
      nextState.slots.service = serviceValue
      nextState.service_selection_multi = false
      nextState.last_service_options = undefined
      nextState.slots.date = undefined
      nextState.slots.time = undefined
      nextState.slots.time_period = undefined
      nextState.pending_date_confirmation = undefined
      nextState.last_time_options = undefined
      nextState.last_time_options_date = undefined
      nextState.last_time_options_staff = undefined
      nextState.just_identified_service = true
      const staffName = nextState.slots.staff_name || getStaffList(config)[0]?.name
      const schedule = staffName ? getScheduleForStaff(config, staffName) : null
      const days = schedule?.days_of_week || []
      const dayOpts = buildStaffDayOptions(days)
      if (!nextState.slots.staff_name && staffName) nextState.slots.staff_name = staffName
      return buildResult(
        `Entendi, ${serviceValue}. Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
        nextState,
        toNumberedOptions(dayOpts)
      )
    }
    const serviceFromNumber =
      state.last_service_options?.length && resolveOptionByNumber(text, state.last_service_options)
    if (serviceFromNumber) {
      nextState.slots.service = serviceFromNumber === "Quero agendar uma visita" ? "visita" : serviceFromNumber
      nextState.service_selection_multi = false
      nextState.last_service_options = undefined
      nextState.slots.date = undefined
      nextState.slots.time = undefined
      nextState.slots.time_period = undefined
      nextState.pending_date_confirmation = undefined
      nextState.last_time_options = undefined
      nextState.last_time_options_date = undefined
      nextState.last_time_options_staff = undefined
      if (!nextState.slots.date) {
        const staffName = nextState.slots.staff_name || getStaffList(config)[0]?.name
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
    } else if (explicitService) {
      nextState.slots.service = explicitService
      nextState.service_selection_multi = false
    } else if (isVisitRequest(text)) {
      nextState.slots.service = "visita"
      nextState.service_selection_multi = false
    } else if (nextState.pending_default_service && nextState.pending_default_service_locked) {
      nextState.slots.service = nextState.pending_default_service
      nextState.service_selection_multi = false
    }
  }

  const isMultiServiceSinglePerson =
    nextState.slots.service && String(nextState.slots.service).includes(",")
  if (
    !nextState.pending_additional_count &&
    !nextState.pending_additional_booking &&
    interpretedHasAdditional &&
    !isMultiServiceSinglePerson
  ) {
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
    const normalizedLast = lastAssistantMsg ? normalizeText(lastAssistantMsg) : ""
    const lastAskedForName = lastAssistantMsg && /qual[\s\w]*nome/.test(normalizedLast)
    const directNameAnswer = lastAskedForName && looksLikeAttendeeName(text)
    // Prioriza extrair o nome antes de cair na pergunta de parentesco.
    let name =
      slotsInterpretation?.attendee_name && slotsInterpretation.attendee_name.trim()
        ? slotsInterpretation.attendee_name.trim()
        : ""
    if (!name && text.trim().length >= 2 && text.trim().length <= 300) {
      const aiName = await extractAttendeeNameForMultiBooking(text, {
        lastAssistantMessage: lastAssistantMsg,
      })
      if (aiName) name = aiName
    }
    if (!name) {
      const cleaned = normalizeText(text)
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
      const stop = new Set([
        "o", "a", "os", "as", "do", "da", "de", "dos", "das",
        "meu", "minha", "seu", "sua", "pro", "pra", "para", "um", "uma",
      ])
      const candidate = cleaned.filter((w) => w.length >= 2 && !stop.has(w)).pop()
      if (candidate) name = candidate
    }

    if (slotsInterpretation?.relationship_only && !directNameAnswer && !name) {
      const rel = slotsInterpretation.relationship || "pessoa"
      const relNormalized = normalizeText(String(rel || ""))
      const isInvalidRel = ["meu", "minha", "seu", "sua", "dele", "dela"].includes(relNormalized)
      const question =
        rel === "filho"
          ? "Claro, vamos comecar pelo seu filho. Qual o nome dele?"
          : rel === "filha"
            ? "Claro, vamos comecar pela sua filha. Qual o nome dela?"
            : rel === "marido"
              ? "Claro, vamos comecar pelo seu marido. Qual o nome dele?"
              : rel === "esposa"
                ? "Claro, vamos comecar pela sua esposa. Qual o nome dela?"
                : (isInvalidRel
                    ? "Claro! Qual o nome dessa pessoa?"
                    : `Claro! Qual o nome ${rel === "pessoa" ? "dessa pessoa" : `do(a) seu(sua) ${rel}`}?`)
      return buildResult(question, nextState)
    }

    if (!name && looksLikeAttendeeName(text)) name = text.trim()
    // Não re-perguntar quando já temos resposta: só re-perguntar se estiver vazio ou for intenção explícita de agendar (ex.: "quero agendar")
    if (!name || isExplicitBookingIntent(text)) {
      const isNextBooking = (nextState.completed_bookings?.length ?? 0) > 0
      const whoPrompt = isNextBooking ? "De quem sera o proximo agendamento?" : "De quem sera o primeiro agendamento?"
      return buildResult(`${buildMultiBookingIntro()} ${whoPrompt}`, nextState)
    }
    nextState.slots.attendee_name = name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = name
    if (slotsInterpretation?.service && !nextState.slots.service) {
      nextState.slots.service = slotsInterpretation.service
    }
    nextState.pending_attendee_name = false
    if (referenceBooking && !nextState.pending_template_choice) {
      if (!nextState.last_booking) nextState.last_booking = referenceBooking
      nextState.pending_template_choice = true
      const staffLabel = referenceBooking.staff_name ? ` da ${referenceBooking.staff_name}` : ""
      const dateLabel = referenceBooking.date ? formatDatePt(referenceBooking.date) : "esse dia"
      const hasOtherStaff = getOtherStaffOptions(config, referenceBooking.staff_name).length > 0
      const rawOpts = [
        "Mesmo dia e colaborador (proximo horario)",
        ...(hasOtherStaff ? ["Mesmo horario com outro colaborador"] : []),
        "Outro horario no mesmo dia",
        "Outro dia",
      ]
      const options = rawOpts.map((o, i) => `${i + 1} - ${o}`)
      nextState.last_template_options = options
      const optsText = hasOtherStaff
        ? "Prefere o proximo horario, o mesmo horario com outro colaborador, outro horario no mesmo dia ou outro dia?"
        : "Prefere o proximo horario, outro horario no mesmo dia ou outro dia?"
      const msg = `Quer agendar o ${name} na sequencia apos o seu atendimento? O proximo horario esta disponivel. ${optsText}`
      return buildResult(msg, nextState, options)
    }
    const staffList = getStaffList(config)
    if (staffList.length > 1) {
      const staffOptions = [...staffList.map((s) => s.name), "Tanto faz"]
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...toNumberedOptions(staffOptions),
      ])
    }
    const canSequence = config.allow_sequence_booking
    const sequenceList =
      (config.sequence_eligible_services?.length ?? 0) > 0
        ? config.sequence_eligible_services!
        : (config.services || []).map((s) => s.name).filter(Boolean)
    if (canSequence && sequenceList.length > 0) {
      nextState.service_selection_multi = true
      const sequenceOpts = [...sequenceList, "Quero agendar uma visita"]
      nextState.last_service_options = sequenceOpts
      const msg = `Otimo! Vamos agendar primeiro para o ${name}. Qual servico seria? (pode escolher mais de um)`
      return buildResult(msg, nextState, toNumberedOptions(sequenceOpts))
    }
    nextState.service_selection_multi = false
    const serviceOptsList = buildServiceOptions(config.services || [])
    const numberedOpts = serviceOptsList.map((o, i) => `${i + 1} - ${o}`)
    nextState.last_service_options = serviceOptsList
    const msg = `Otimo! Vamos agendar primeiro para o ${name}. Qual servico seria? (responda com o numero ou nome)`
    return buildResult(msg, nextState, numberedOpts)
  }

  if (nextState.pending_template_choice) {
    const templateOpts = state.last_template_options || []
    const choice = parseTemplateChoice(text, templateOpts.length > 0 ? templateOpts : undefined)
    const last =
      lastCompletedFromNextState || lastCompletedFromState || nextState.last_booking || referenceBooking
    if (choice && last) {
      nextState.pending_template_choice = false
      nextState.last_template_options = undefined
      if (choice === "same_next") {
        nextState.service_selection_multi = false
        nextState.last_service_options = undefined
        const firstName = last.attendee_name || "o primeiro"
        const secondName = nextState.slots.attendee_name || "ele"
        const defaultService =
          nextState.slots.service ||
          (nextState.pending_default_service_locked ? nextState.pending_default_service : undefined)
        if (!defaultService) {
          nextState.pending_second_service_choice = true
          const canSequenceSecond = config.allow_sequence_booking
          const sequenceList =
            (config.sequence_eligible_services?.length ?? 0) > 0
              ? config.sequence_eligible_services!
              : (config.services || []).map((s) => s.name).filter(Boolean)
          if (canSequenceSecond && sequenceList.length > 0) {
            nextState.service_selection_multi = true
            const sequenceOpts = [...sequenceList, "Quero agendar uma visita"]
            nextState.last_service_options = sequenceOpts
            return buildResult(
              `Perfeito! Qual servico voce gostaria de agendar para ${secondName}? (pode escolher mais de um)`,
              nextState,
              toNumberedOptions(sequenceOpts)
            )
          }
          nextState.service_selection_multi = false
          const serviceList = buildServiceOptions(config.services || [])
          const numberedServiceOpts = serviceList.map((o, i) => `${i + 1} - ${o}`)
          return buildResult(
            `Perfeito! Qual servico voce gostaria de agendar para ${secondName}?`,
            nextState,
            numberedServiceOpts
          )
        }
        if (defaultService) nextState.slots.service = defaultService
        if (last.date) nextState.slots.date = last.date
        if (last.staff_name) nextState.slots.staff_name = last.staff_name

        if (last.date && last.staff_name && defaultService) {
          const secondDuration = getServicesTotalDurationOrFallback(config, defaultService)
          const firstDuration =
            (last as any)?.duration_minutes ??
            getServicesTotalDurationOrFallback(config, last.service) ??
            30
          const firstEndMins = toMinutes(last.time) + firstDuration
          const firstEndTime = fromMinutes(firstEndMins)
          const nextSlot = getNextAvailableSlot(
            last.date,
            config,
            nextState.booked_slots,
            last.staff_name,
            firstEndTime,
            secondDuration ?? undefined
          )
          if (nextSlot) {
            nextState.slots.time = nextSlot
            const confirmOpts = [
              `1 - Sim, ${nextSlot}`,
              "2 - Outro horario no mesmo dia",
              "3 - Outro dia",
              ...(getOtherStaffOptions(config, last.staff_name).length > 0
                ? ["4 - Mesmo horario com outro colaborador"]
                : []),
            ]
            nextState.last_confirm_options = confirmOpts
            return buildResult(
              `Otimo, vamos agendar ${secondName} em seguida ao ${firstName}. Sugeri ${nextSlot} em ${formatDatePt(last.date)}. Posso confirmar?`,
              nextState,
              confirmOpts
            )
          }
          const hasOtherStaff = getOtherStaffOptions(config, last.staff_name).length > 0
          const msg = hasOtherStaff
            ? "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia ou manter esse horario com outro colaborador?"
            : "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia?"
          return buildResult(msg, nextState, [
            "1 - Outro dia",
            ...(hasOtherStaff ? ["2 - Mesmo horario com outro colaborador"] : []),
          ])
        }
        return buildResult("Qual dia voce prefere?", nextState)
      }
      if (choice === "same_day") {
        if (last.date) nextState.slots.date = last.date
        nextState.slots.staff_name = last.staff_name
        const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
        const serviceForSlots = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceDuration = getServicesTotalDuration(config, serviceForSlots)
        const availability = last.date
          ? getMockAvailability(last.date, schedule, nextState.booked_slots, nextState.slots.staff_name, serviceDuration)
          : { available: [] as string[], occupied: [] as string[] }
        if (!availability.available.length) {
          const closedToday =
            last.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
          const msg = closedToday
            ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
            : getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? "Esse dia esta cheio. Quer tentar outro dia ou manter esse horario com outro colaborador?"
              : "Esse dia esta cheio. Quer tentar outro dia?"
          const closedDayOptions = getOtherDayOptions(schedule)
          return buildResult(msg, nextState, [
            ...(closedToday ? closedDayOptions : ["Outro dia"]),
            ...(getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? ["Mesmo horario com outro colaborador"]
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
        const desiredDate = last.date
        const desiredTime = last.time
        const serviceForSameTime =
          nextState.slots.service ||
          (nextState.pending_default_service_locked ? nextState.pending_default_service : undefined) ||
          last.service
        if (desiredDate && desiredTime) {
          const serviceDuration = getServicesTotalDuration(config, serviceForSameTime)
          const availableStaffAtSameTime = getStaffList(config)
            .map((s) => s.name)
            .filter((name) => normalizeText(name) !== normalizeText(last.staff_name || ""))
            .filter((name) => {
              const schedule = getScheduleForStaff(config, name)
              const availability = getMockAvailability(
                desiredDate,
                schedule,
                nextState.booked_slots,
                name,
                serviceDuration ?? undefined
              )
              return availability.available.includes(desiredTime)
            })
          if (availableStaffAtSameTime.length > 0) {
            nextState.slots.date = desiredDate
            nextState.slots.time = desiredTime
            nextState.slots.staff_name = undefined
            return buildResult(
              `Perfeito. Qual colaborador voce prefere para manter o mesmo horario (${desiredTime})?`,
              nextState,
              toNumberedOptions(availableStaffAtSameTime)
            )
          }
          return buildResult(
            "Nao encontrei outro colaborador disponivel nesse mesmo horario. Quer outro horario no mesmo dia ou outro dia?",
            nextState,
            ["1 - Outro horario no mesmo dia", "2 - Outro dia"]
          )
        }
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

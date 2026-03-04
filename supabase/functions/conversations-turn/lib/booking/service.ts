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
} from "../utils.ts"
import { getNextAvailableSlot, buildStaffDayOptions } from "../staff.ts"
import { getServicesTotalDuration, findServiceFromText } from "../services.ts"
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
  } = ctx

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

  if (!nextState.slots.service) {
    // 1) Texto livre: "corte e barba" → múltiplos serviços (allow_sequence_booking)
    const sequenceServices = config.allow_sequence_booking ? getSequenceServicesFromText(config, text) : []
    if (sequenceServices.length >= 1) {
      nextState.slots.service = sequenceServices.join(", ")
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
    } else if (explicitService) nextState.slots.service = explicitService
    else if (isVisitRequest(text)) nextState.slots.service = "visita"
    else if (nextState.pending_default_service && nextState.pending_default_service_locked)
      nextState.slots.service = nextState.pending_default_service
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

    // Nome vem da IA (interpretSlots), da IA dedicada (extractAttendeeNameForMultiBooking) ou do texto livre
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
    if (!name) name = text.trim()
    // Não re-perguntar quando já temos resposta: só re-perguntar se estiver vazio ou for intenção explícita de agendar (ex.: "quero agendar")
    if (!name || isExplicitBookingIntent(text)) {
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
        const nextSlot = getNextAvailableSlot(last.date, config, nextState.booked_slots, last.staff_name, last.time, serviceDuration)
        if (nextSlot) {
          nextState.slots.date = last.date
          nextState.slots.time = nextSlot
          nextState.slots.staff_name = last.staff_name
          const firstName = last.attendee_name || "o primeiro"
          const confirmOpts = [`1 - Sim, ${nextSlot}`, "2 - Outro horario no mesmo dia", "3 - Outro dia", ...(getOtherStaffOptions(config, last.staff_name).length > 0 ? ["4 - Trocar colaborador"] : [])]
          nextState.last_confirm_options = confirmOpts
          return buildResult(
            `Otimo, vamos agendar ${nextState.slots.attendee_name || "ele"} em seguida ao ${firstName}. Sugeri ${nextSlot} em ${formatDatePt(last.date)}. Posso confirmar?`,
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
          : { available: [] as string[], occupied: [] as string[] }
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

  return null
}

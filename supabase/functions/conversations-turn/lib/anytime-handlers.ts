// @ts-nocheck
/** Handlers que podem rodar a qualquer momento: preço, lista/detalhe de serviços, disponibilidade. */
import { normalizeText } from "./utils.ts"
import { buildResult } from "./state.ts"
import {
  parseTime,
  parseTimePeriod,
  parseDateOrWeekday,
  addDaysToIsoDate,
  getTodayIsoBusinessTz,
  resolveOptionByNumber,
  resolveMultipleOptionsByNumber,
  isWithinSchedule,
  getMockAvailability,
  isTimeTooSoonForDate,
  MIN_BOOKING_LEAD_MINUTES,
  getNextAvailableSlotAfter,
  filterSlotsByPeriod,
} from "./utils.ts"
import {
  findServiceFromText,
  findServicesFromText,
  getServiceWithPrice,
  getServiceDurationMinutes,
  getServicesTotalDuration,
} from "./services.ts"
import { resolveConfiguredServicesFromConfig, resolveSequenceEligibleServicesFromConfig } from "./canonical-services.ts"
import { getStaffList, getScheduleForStaff, getOtherStaffOptions } from "./staff.ts"
import {
  isPriceQuestion,
  isListServicesQuestion,
  isServiceDetailQuestion,
  isAvailabilityQuestion,
} from "./detection.ts"
import {
  getCordialPrefix,
  buildPriceNotAvailableMessage,
  buildServicesListWithPrices,
} from "./builders.ts"
import { generateAvailabilityResponseWithAI } from "./ai.ts"
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"

export function buildServicesListResult(
  config: SimulatorConfig,
  state: SimulatorState,
  prefix?: string
): SimulatorResult {
  const configuredServices = resolveConfiguredServicesFromConfig(config)
  const serviceOptions = configuredServices.map((s) => s.name).filter(Boolean)
  const fullMessage = prefix ? `${prefix} ${buildServicesListWithPrices(config)}` : buildServicesListWithPrices(config)
  return buildResult(
    fullMessage,
    { ...state, last_service_options: serviceOptions },
    serviceOptions.length > 0 ? serviceOptions : undefined
  )
}

export function getSequenceServicesFromText(config: SimulatorConfig, text: string): string[] {
  if (!config.allow_sequence_booking) return []
  const configuredServices = resolveConfiguredServicesFromConfig(config)
  const eligibleForSequence = resolveSequenceEligibleServicesFromConfig(config)
  const sequencePool =
    eligibleForSequence.length > 0 ? eligibleForSequence : configuredServices.map((s) => s.name).filter(Boolean)
  return findServicesFromText(text, configuredServices, sequencePool)
}

export function tryResolveNumericServiceSelection(incomingText: string, state: SimulatorState): string | null {
  if (!/^[1-9]\d*$/.test(incomingText)) return null
  const serviceOptions = (state.last_service_options || []).map((s) => String(s || "").trim()).filter(Boolean)
  if (serviceOptions.length === 0) return null
  if (Array.isArray(state.last_action_options) && state.last_action_options.length > 0) {
    const byAction = resolveOptionByNumber(incomingText, state.last_action_options)
    if (byAction) {
      const exact = serviceOptions.find((s) => normalizeText(s) === normalizeText(byAction))
      if (exact) return exact
      return null
    }
  }
  if (state.step === "qualification" || (!state.slots?.service && state.step !== "booking")) {
    return resolveOptionByNumber(incomingText, serviceOptions)
  }
  return null
}

export function tryResolveNumericMultipleServiceSelection(
  incomingText: string,
  state: SimulatorState
): string | null {
  if (!/^\s*\d+(?:\s*[,.;eE]\s*|\s+e\s+|\s+)\d+/.test(incomingText.trim())) return null
  const serviceOptions = (state.last_service_options || []).map((s) => String(s || "").trim()).filter(Boolean)
  if (serviceOptions.length === 0) return null
  const selected = resolveMultipleOptionsByNumber(incomingText, serviceOptions)
  if (selected.length === 0) return null
  const withoutVisit = selected.filter((s) => normalizeText(s) !== normalizeText("Quero agendar uma visita"))
  if (withoutVisit.length === 0) return "visita"
  return withoutVisit.join(", ")
}

export function tryHandlePriceQuestionAnytime(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState
): SimulatorResult | null {
  if (!isPriceQuestion(text)) return null
  const cordial = getCordialPrefix(config, false)
  const configuredServices = resolveConfiguredServicesFromConfig(config)
  const serviceName = findServiceFromText(text, configuredServices)
  const svc = getServiceWithPrice(configuredServices, serviceName)
  if (serviceName && svc && svc.base_price != null) {
    return buildResult(
      cordial + `O ${svc.name} esta R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
      state,
      ["Quero agendar", "Só queria saber"]
    )
  }
  if (serviceName && svc) {
    const noPrice = buildPriceNotAvailableMessage(config, serviceName)
    return buildResult(cordial + noPrice.message, state, noPrice.action_options)
  }
  const withPrice = configuredServices.filter((s) => s.base_price != null)
  if (withPrice.length > 0) return buildServicesListResult(config, state, cordial)
  const noPrice = buildPriceNotAvailableMessage(config, serviceName || undefined)
  return buildResult(cordial + noPrice.message, state, noPrice.action_options)
}

export function tryHandleServicesQuestionAnytime(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState
): SimulatorResult | null {
  if (isListServicesQuestion(text)) return buildServicesListResult(config, state)
  if (!isServiceDetailQuestion(text)) return null
  const configuredServices = resolveConfiguredServicesFromConfig(config)
  const serviceName = findServiceFromText(text, configuredServices) || state.slots?.service || null
  const svc = getServiceWithPrice(configuredServices, serviceName)
  if (!svc) {
    const serviceOptions = configuredServices.map((s) => s.name).filter(Boolean)
    if (serviceOptions.length > 0) {
      return buildResult("Claro. Sobre qual serviço você quer mais detalhes?", state, serviceOptions)
    }
    return buildResult("No momento não encontrei serviços cadastrados para detalhar.", state)
  }
  const duration = getServiceDurationMinutes(config, svc.name)
  const parts = [`Sobre ${svc.name}:`]
  if (svc.description) parts.push(svc.description)
  if (duration != null) parts.push(`Duração média: ${duration} min.`)
  if (svc.base_price != null) parts.push(`Valor: R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}.`)
  return buildResult(parts.join(" "), state, ["Quero agendar", "Só queria saber"])
}

export async function tryHandleAvailabilityQuestionAnytime(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState,
  history: Array<{ role: string; content: string }>
): Promise<SimulatorResult | null> {
  if (/^[1-9]\d*$/.test(text.trim())) return null
  const hasAvailabilityIntent =
    isAvailabilityQuestion(text) ||
    /\b(agendar|marcar)\b.*\b(as|às|as)\s*\d|quero\s+as\s+\d/.test(normalizeText(text))
  const period = parseTimePeriod(text)
  const timeFromText = parseTime(text)
  // Pergunta só por período (ex.: "tem algum horário à tarde?") sem horário específico
  if (!timeFromText && period && hasAvailabilityIntent) {
    const dateIso = parseDateOrWeekday(text) || state.slots?.date || getTodayIsoBusinessTz()
    const staffList = getStaffList(config)
    const staffName = state.slots?.staff_name || staffList[0]?.name
    const schedule = getScheduleForStaff(config, staffName)
    const configuredServices = resolveConfiguredServicesFromConfig(config)
    const service =
      state.slots?.service || findServiceFromText(text, configuredServices) || configuredServices[0]?.name
    const duration = getServicesTotalDuration(config, service) ?? 30
    const availability = getMockAvailability(dateIso, schedule, state.booked_slots, staffName, duration)
    const slotsInPeriod = filterSlotsByPeriod(availability.available, period)
    const nextState: SimulatorState = { ...state }
    nextState.slots = { ...nextState.slots, date: dateIso, time_period: period }
    if (staffName) nextState.slots.staff_name = staffName
    if (service) nextState.slots.service = service
    nextState.last_time_options = slotsInPeriod.slice(0, 24)
    nextState.last_time_options_date = dateIso
    nextState.last_time_options_staff = staffName
    if (slotsInPeriod.length === 0) {
      const msg = `Para ${period === "afternoon" ? "a tarde" : period === "morning" ? "de manha" : "a noite"} nao tenho horarios livres nessa data. Quer escolher outro dia ou outro periodo?`
      return buildResult(msg, nextState, ["Outro dia", "Outro horario"])
    }
    const list = slotsInPeriod.slice(0, 8).join(", ")
    const msg = `Tenho ainda alguns horarios, qual voce deseja? Eu vejo aqui a disponibilidade: ${list}.`
    const options = slotsInPeriod.slice(0, 8).map((t, i) => `${i + 1} - ${t}`)
    return buildResult(msg, nextState, options)
  }
  if (!timeFromText) return null
  const hasSpecificTimeIntent =
    isAvailabilityQuestion(text) ||
    /\b(agendar|marcar)\b.*\b(as|às|as)\s*\d|quero\s+as\s+\d/.test(normalizeText(text))
  if (!hasSpecificTimeIntent) return null
  // Se o cliente não mencionou data, preferir HOJE (não amanhã).
  // Se hoje não tiver horários, a própria lista de available_slots virá vazia e a IA sugerirá alternativas.
  const dateIso = parseDateOrWeekday(text) || state.slots?.date || getTodayIsoBusinessTz()
  const staffList = getStaffList(config)
  const staffName = state.slots?.staff_name || staffList[0]?.name
  const schedule = getScheduleForStaff(config, staffName)
  const configuredServices = resolveConfiguredServicesFromConfig(config)
  const service =
    state.slots?.service || findServiceFromText(text, configuredServices) || configuredServices[0]?.name
  const duration = getServicesTotalDuration(config, service) ?? 30
  const availability = getMockAvailability(dateIso, schedule, state.booked_slots, staffName, duration)
  const normalizedTime = timeFromText.includes(":")
    ? timeFromText.replace(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/, (_: string, h: string, m: string) =>
        `${String(parseInt(h, 10)).padStart(2, "0")}:${String(parseInt(m, 10)).padStart(2, "0")}`
      )
    : `${timeFromText.padStart(2, "0")}:00`
  const isAvailable = availability.available.includes(normalizedTime)
  const within = !isAvailable ? isWithinSchedule(normalizedTime, schedule) : null
  const occupied = availability.occupied.includes(normalizedTime)
  const minLead = schedule?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
  const tooSoon = dateIso === getTodayIsoBusinessTz() && isTimeTooSoonForDate(dateIso, normalizedTime, minLead)
  const unavailableReason =
    (within && !within.ok ? within.reason : undefined) ||
    (tooSoon
      ? `Este horário exige antecedência mínima de ${minLead} minutos.`
      : occupied
        ? `Esse horário já está ocupado.`
        : !isAvailable
          ? `Esse horário não está disponível.`
          : undefined)
  const suggestedNext =
    !isAvailable && occupied && availability.available.length > 0
      ? getNextAvailableSlotAfter(availability.available, normalizedTime)
      : undefined
  const fluidResponse = await generateAvailabilityResponseWithAI(
    config,
    {
      requested_time: normalizedTime,
      date_iso: dateIso,
      is_available: isAvailable,
      available_slots: availability.available.slice(0, 12),
      service: service || undefined,
      unavailable_reason: unavailableReason,
      suggested_next_slot: suggestedNext,
    },
    history
  )
  const nextState: SimulatorState = { ...state }
  nextState.slots = { ...nextState.slots, date: dateIso }
  if (staffName) nextState.slots.staff_name = staffName
  if (service) nextState.slots.service = service
  if (isAvailable) {
    nextState.slots.time = normalizedTime
    nextState.mode = "booking"
    nextState.step = undefined
  }
  const options =
    availability.available.length > 0
      ? isAvailable
        ? [`Sim, ${normalizedTime}`, "Outro horario", ...(getOtherStaffOptions(config, staffName).length > 0 ? ["Outro colaborador"] : [])]
        : availability.available.slice(0, 8).map((t, i) => `${i + 1} - ${t}`)
      : ["Quero agendar"]
  return buildResult(fluidResponse, nextState, options)
}

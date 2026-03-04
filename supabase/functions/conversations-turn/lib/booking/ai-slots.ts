// @ts-nocheck
/** Handler: aplica interpretação IA (service/date/time/attendee) e pergunta "tem horário às X?". */
import type { SimulatorResult } from "../types.ts"
import { buildResult } from "../state.ts"
import { getScheduleForStaff, getStaffList, getOtherStaffOptions } from "../staff.ts"
import {
  getTodayIsoBusinessTz,
  getMockAvailability,
  isWithinSchedule,
} from "../utils.ts"
import { getServicesTotalDuration, findServicesFromText } from "../services.ts"
import { generateAvailabilityResponseWithAI } from "../ai.ts"
import type { BookingContext } from "./context.ts"

export async function handleAiSlots(ctx: BookingContext): Promise<SimulatorResult | null> {
  const { config, nextState, text, toNumberedOptions } = ctx
  const si = ctx.slotsInterpretation
  if (!si) return null

  const expectingMultiServiceSelection =
    Boolean(ctx.state.service_selection_multi) &&
    Array.isArray(ctx.state.last_service_options) &&
    ctx.state.last_service_options.length > 0

  const { waitingFor, isDigitOnly, normalizedText, allowAiDateAutofill } = ctx
  const isHojeOuAmanha = normalizedText.includes("hoje") || normalizedText.includes("amanha")

  if (
    waitingFor === "service" &&
    !nextState.slots.service &&
    !isDigitOnly
  ) {
    if (expectingMultiServiceSelection) {
      // Quando o turno explicitamente permite multi-select, evitar que a IA fixe
      // serviço único prematuramente (ex.: "corte de cabelo") antes do parser
      // de múltiplos ("corte de cabelo e barba") no handler de service.
      if (config.allow_sequence_booking) {
        const eligibleForSequence =
          (config.sequence_eligible_services?.length ?? 0) > 0
            ? config.sequence_eligible_services || []
            : (config.services || []).map((s) => s.name).filter(Boolean)
        const multipleFromText = findServicesFromText(text, config.services || [], eligibleForSequence)
        if (multipleFromText.length >= 2) {
          nextState.slots.service = multipleFromText.join(", ")
        }
      }
    } else if (config.allow_sequence_booking) {
      const eligibleForSequence =
        (config.sequence_eligible_services?.length ?? 0) > 0
          ? config.sequence_eligible_services || []
          : (config.services || []).map((s) => s.name).filter(Boolean)
      const multipleFromText = findServicesFromText(text, config.services || [], eligibleForSequence)
      if (multipleFromText.length >= 2) {
        nextState.slots.service = multipleFromText.join(", ")
      } else if (si.service) {
        nextState.slots.service = si.service
      }
    } else if (si.service) {
      nextState.slots.service = si.service
    }
  }

  if (
    waitingFor === "date" &&
    si.date &&
    !nextState.slots.date &&
    !isDigitOnly &&
    allowAiDateAutofill &&
    !isHojeOuAmanha &&
    /^\d{4}-\d{2}-\d{2}$/.test(si.date)
  ) {
    nextState.slots.date = si.date
  }

  if (waitingFor === "time" && si.time && !nextState.slots.time && !isDigitOnly) {
    const rawTime = si.time
    const normalizedTime = rawTime.includes(":")
      ? rawTime.replace(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/, (_, h, m) =>
          `${String(parseInt(h, 10)).padStart(2, "0")}:${String(parseInt(m, 10)).padStart(2, "0")}`
        )
      : `${String(parseInt(rawTime, 10)).padStart(2, "0")}:00`
    const dateIsoForTime = nextState.slots.date || getTodayIsoBusinessTz()
    const staffList = getStaffList(config)
    const staffNameForTime = nextState.slots.staff_name || staffList[0]?.name
    const scheduleForTime = getScheduleForStaff(config, staffNameForTime)
    const availabilityForTime = getMockAvailability(
      dateIsoForTime,
      scheduleForTime,
      nextState.booked_slots,
      staffNameForTime,
      getServicesTotalDuration(config, nextState.slots.service || nextState.pending_default_service)
    )
    if (availabilityForTime.available.includes(normalizedTime)) {
      nextState.slots.time = normalizedTime
    } else {
      const within = isWithinSchedule(normalizedTime, scheduleForTime)
      const options = availabilityForTime.available.slice(0, 24)
      nextState.last_time_options = options
      nextState.last_time_options_date = dateIsoForTime
      nextState.last_time_options_staff = staffNameForTime
      const msg = !within.ok
        ? `${within.reason || "Esse horário não está disponível."} Temos: ${options.slice(0, 8).join(", ")}. Qual prefere?`
        : "Esse horário não temos disponível (não bate com nossa grade). Temos: " +
          options.slice(0, 8).join(", ") +
          ". Qual prefere?"
      return buildResult(msg, nextState, toNumberedOptions(options))
    }
  }

  if (
    waitingFor === "attendee_name" &&
    si.attendee_name &&
    !nextState.slots.attendee_name &&
    !isDigitOnly
  ) {
    nextState.slots.attendee_name = si.attendee_name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = si.attendee_name
  }

  if (si.needs_availability_check && si.time && !isDigitOnly) {
    const dateIso = nextState.slots.date || getTodayIsoBusinessTz()
    const staffList = getStaffList(config)
    const staffName = nextState.slots.staff_name || staffList[0]?.name
    const schedule = getScheduleForStaff(config, staffName)
    const serviceDuration =
      getServicesTotalDuration(config, nextState.slots.service || nextState.pending_default_service) ?? 30
    const availability = getMockAvailability(
      dateIso,
      schedule,
      nextState.booked_slots,
      staffName,
      serviceDuration
    )
    const requestedTime = si.time.includes(":")
      ? si.time
      : `${String(parseInt(si.time, 10)).padStart(2, "0")}:00`
    const isAvailable = availability.available.includes(requestedTime)
    const within = !isAvailable ? isWithinSchedule(requestedTime, schedule) : null
    const unavailableReason = within && !within.ok ? within.reason : undefined

    const fluidResponse = await generateAvailabilityResponseWithAI(config, {
      attendee_name: nextState.slots.attendee_name,
      requested_time: requestedTime,
      date_iso: dateIso,
      is_available: isAvailable,
      available_slots: availability.available.slice(0, 12),
      service: nextState.slots.service,
      unavailable_reason: unavailableReason,
    }, ctx.history)

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

  return null
}

// @ts-nocheck
/** Early steps: rejeição de serviço não listado, primeira interação (saudação), primeira mensagem com IA. */
import type { SimulatorResult } from "../../types.ts"
import type { TurnPipelineContext } from "../../turn-context.ts"
import { buildResult } from "../../state.ts"
import { normalizeText, parseTime, parseDateOrWeekday, addDaysToIsoDate, getTodayIsoBusinessTz } from "../../utils.ts"
import { getMockAvailability, isWithinSchedule, isTimeTooSoonForDate, MIN_BOOKING_LEAD_MINUTES, getNextAvailableSlotAfter } from "../../utils.ts"
import { getGreetingMessage, buildClarificationMessage } from "../../builders.ts"
import { isGreeting, isExplicitBookingIntent } from "../../detection.ts"
import { findServiceFromText, getServicesTotalDuration } from "../../services.ts"
import { resolveConfiguredServicesFromConfig } from "../../canonical-services.ts"
import { getStaffList, getScheduleForStaff } from "../../staff.ts"
import {
  answerWithContextualAI,
  generateAdaptiveGreetingWithAI,
  generateAvailabilityResponseWithAI,
  interpretBookingRequestWithAI,
} from "../../ai.ts"
import { resolveServiceMatchSummary } from "../../qualification.ts"
import { detectModeFromText } from "../../detection.ts"
import { tryAnswerInformationalQuestion } from "../../informational.ts"
import { getEntryActionOptions } from "../../request-helpers.ts"
import { resolveQuote } from "../../quote-mode.ts"
import { handleFirstMessageOrchestratorAction } from "../../orchestrator-actions.ts"
import { resolveBooking } from "../../resolve-booking.ts"
import { enterBookingFromIntent } from "../../qualification.ts"

/** Retorna resultado se rejeição unlisted, primeira saudação ou primeira mensagem (IA); senão null. */
export async function runRejectAndFirstSteps(ctx: TurnPipelineContext): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, isFirst, textNorm, minOrchestratorConfidence, getOrchestrator } = ctx
  const configuredServices = resolveConfiguredServicesFromConfig(config)

  if (
    config.lead_policy?.reject_unlisted_services &&
    configuredServices.length > 0 &&
    !nextState.slots.service &&
    !isGreeting(text)
  ) {
    const matchUnlisted = await resolveServiceMatchSummary({
      text,
      config,
      isFirst,
    })
    if (matchUnlisted.match.reject) {
      return buildResult(matchUnlisted.rejectionMessage, { ...nextState, step: "qualification_rejected" })
    }
  }

  if (isFirst && isGreeting(text)) {
    const aiGreeting = await generateAdaptiveGreetingWithAI(config, text, history, senderDisplayName)
    if (aiGreeting) return buildResult(aiGreeting, { ...nextState, step: "qualification" }, getEntryActionOptions(config))
    return buildResult(getGreetingMessage(config), { ...nextState, step: "qualification" }, getEntryActionOptions(config))
  }

  if (isFirst && !nextState.mode && !nextState.step) {
    const greeting =
      (await generateAdaptiveGreetingWithAI(config, text, history, senderDisplayName)) ||
      getGreetingMessage(config)
    const bookingRequest = await interpretBookingRequestWithAI(
      text,
      { history, sender_display_name: senderDisplayName },
      config
    )
    if (isExplicitBookingIntent(text) || bookingRequest?.booking_intent) {
      const handled = await enterBookingFromIntent({
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        resolveBooking,
        includeIntro: false,
      })
      if (handled) return handled
    }
    const orchestrator = await getOrchestrator()
    const hasConfidentOrchestrator = orchestrator && (orchestrator.confidence ?? 0) >= minOrchestratorConfidence
    if (hasConfidentOrchestrator) {
      const handled = await handleFirstMessageOrchestratorAction(orchestrator, {
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        isFirst,
        resolveBooking,
      })
      if (handled) return handled
    }
    const timeFromFirstMsg = parseTime(text)
    // Se o cliente não mencionou data na 1ª mensagem, preferir HOJE (não amanhã).
    const dateFromFirstMsg = parseDateOrWeekday(text) || getTodayIsoBusinessTz()
    if (timeFromFirstMsg && dateFromFirstMsg) {
      const staffList = getStaffList(config)
      const staffNameFirst = staffList[0]?.name
      const scheduleFirst = getScheduleForStaff(config, staffNameFirst)
      const serviceFirst = findServiceFromText(text, configuredServices) || configuredServices[0]?.name
      const durationFirst = getServicesTotalDuration(config, serviceFirst) ?? 30
      const availabilityFirst = getMockAvailability(
        dateFromFirstMsg,
        scheduleFirst,
        nextState.booked_slots,
        staffNameFirst,
        durationFirst
      )
      const normalizedFirstTime = timeFromFirstMsg.includes(":") ? timeFromFirstMsg : `${timeFromFirstMsg.padStart(2, "0")}:00`
      const isAvailableFirst = availabilityFirst.available.includes(normalizedFirstTime)
      if (!isAvailableFirst) {
        const withinFirst = isWithinSchedule(normalizedFirstTime, scheduleFirst)
        const occupiedFirst = availabilityFirst.occupied.includes(normalizedFirstTime)
        const minLead = scheduleFirst?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
        const tooSoon = dateFromFirstMsg === getTodayIsoBusinessTz() && isTimeTooSoonForDate(dateFromFirstMsg, normalizedFirstTime, minLead)
        const unavailableReasonFirst =
          (!withinFirst.ok ? withinFirst.reason : undefined) ||
          (tooSoon
            ? `Este horário exige antecedência mínima de ${minLead} minutos.`
            : occupiedFirst
              ? `Esse horário já está ocupado.`
              : `Esse horário não está disponível.`)
        const suggestedNextFirst =
          availabilityFirst.available.length > 0
            ? getNextAvailableSlotAfter(availabilityFirst.available, normalizedFirstTime)
            : undefined
        const fluidFirst = await generateAvailabilityResponseWithAI(
          config,
          {
            requested_time: normalizedFirstTime,
            date_iso: dateFromFirstMsg,
            is_available: false,
            available_slots: availabilityFirst.available.slice(0, 12),
            service: serviceFirst || undefined,
            unavailable_reason: unavailableReasonFirst,
            suggested_next_slot: suggestedNextFirst,
          },
          history
        )
        const stateAfterFirst = { ...nextState, step: "qualification" as const }
        if (serviceFirst) stateAfterFirst.slots = { ...stateAfterFirst.slots, service: serviceFirst }
        stateAfterFirst.slots = { ...stateAfterFirst.slots, date: dateFromFirstMsg }
        if (staffNameFirst) stateAfterFirst.slots = { ...stateAfterFirst.slots, staff_name: staffNameFirst }
        return buildResult(
          `${greeting}\n\n${fluidFirst}`,
          stateAfterFirst,
          availabilityFirst.available.length > 0 ? availabilityFirst.available.slice(0, 8).map((t, i) => `${i + 1} - ${t}`) : ["Quero agendar"]
        )
      }
    }
    const firstAiAnswer = await answerWithContextualAI(config, text, history)
    if (firstAiAnswer?.trim()) {
      return buildResult(`${greeting}\n\n${firstAiAnswer}`, { ...nextState, step: "qualification" }, getEntryActionOptions(config))
    }
    const firstInfoAnswer = tryAnswerInformationalQuestion(config, text)
    if (firstInfoAnswer) {
      return buildResult(`${greeting}\n\n${firstInfoAnswer}`, { ...nextState, step: "qualification" }, getEntryActionOptions(config))
    }
    if (config.context_mode === "both") {
      const detectedMode = detectModeFromText(text)
      if (detectedMode === "quote") {
        nextState.mode = "quote"
        nextState.step = "quote"
        return resolveQuote(config, text, nextState)
      }
    }
    const aiAnswer = await answerWithContextualAI(config, text, history)
    if (aiAnswer) return buildResult(aiAnswer, { ...nextState, step: "qualification" })
    return buildResult(buildClarificationMessage(config), { ...nextState, step: "qualification" })
  }

  return null
}




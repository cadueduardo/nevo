// @ts-nocheck
/** Early steps: rejeição de serviço não listado, primeira interação (saudação), primeira mensagem com IA. */
import type { SimulatorResult } from "../../types.ts"
import type { TurnPipelineContext } from "../../turn-context.ts"
import { buildResult } from "../../state.ts"
import { normalizeText, parseTime, parseDateOrWeekday, addDaysToIsoDate, getTodayIsoBusinessTz } from "../../utils.ts"
import { getMockAvailability, isWithinSchedule } from "../../utils.ts"
import { getGreetingMessage, buildClarificationMessage } from "../../builders.ts"
import { isGreeting, isExplicitBookingIntent } from "../../detection.ts"
import { findServiceFromText, getServicesTotalDuration } from "../../services.ts"
import { getStaffList, getScheduleForStaff } from "../../staff.ts"
import { answerWithContextualAI, generateAvailabilityResponseWithAI } from "../../ai.ts"
import { classifyServiceMatch } from "../../services.ts"
import { hasMatchContext } from "../../qualification.ts"
import { generateRejectionMessageWithAI } from "../../builders.ts"
import { detectModeFromText } from "../../detection.ts"
import { tryAnswerInformationalQuestion } from "../../informational.ts"
import { getEntryActionOptions } from "../../request-helpers.ts"
import { resolveQuote } from "../../quote-mode.ts"
import { handleFirstMessageOrchestratorAction } from "../../orchestrator-actions.ts"
import { resolveBooking } from "../../resolve-booking.ts"

function handleQuoteModeMessage(config: import("../../types.ts").SimulatorConfig, text: string, nextState: import("../../types.ts").SimulatorState): SimulatorResult {
  return resolveQuote(config, text, nextState)
}

/** Retorna resultado se rejeição unlisted, primeira saudação ou primeira mensagem (IA); senão null. */
export async function runRejectAndFirstSteps(ctx: TurnPipelineContext): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, isFirst, textNorm, minOrchestratorConfidence, getOrchestrator } = ctx

  if (
    config.lead_policy?.reject_unlisted_services &&
    (config.services || []).length > 0 &&
    !nextState.slots.service &&
    !isGreeting(text)
  ) {
    const matchUnlisted = await classifyServiceMatch(text, config)
    if (matchUnlisted.reject) {
      const hasContext = hasMatchContext(matchUnlisted)
      const rejectionMessage = await generateRejectionMessageWithAI(
        matchUnlisted.inferred_area,
        config,
        isFirst,
        hasContext
      )
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
    }
  }

  if (isFirst && isGreeting(text)) {
    const aiGreeting = await answerWithContextualAI(config, text, history)
    if (aiGreeting) return buildResult(aiGreeting, { ...nextState, step: "qualification" }, getEntryActionOptions(config))
    return buildResult(getGreetingMessage(config), { ...nextState, step: "qualification" }, getEntryActionOptions(config))
  }

  if (isFirst && !nextState.mode && !nextState.step) {
    const greeting = getGreetingMessage(config)
    const orchestrator = await getOrchestrator()
    const hasConfidentOrchestrator = orchestrator && (orchestrator.confidence ?? 0) >= minOrchestratorConfidence
    if (isExplicitBookingIntent(text) || hasConfidentOrchestrator) {
      const handled = hasConfidentOrchestrator
        ? await handleFirstMessageOrchestratorAction(orchestrator, {
            text,
            config,
            nextState,
            history,
            senderDisplayName,
            isFirst,
            resolveBooking,
          })
        : await resolveBooking(config, text, nextState, history, senderDisplayName)
      if (handled) return handled
    }
    const timeFromFirstMsg = parseTime(text)
    const dateFromFirstMsg = parseDateOrWeekday(text) || addDaysToIsoDate(getTodayIsoBusinessTz(), 1)
    if (timeFromFirstMsg && dateFromFirstMsg) {
      const staffList = getStaffList(config)
      const staffNameFirst = staffList[0]?.name
      const scheduleFirst = getScheduleForStaff(config, staffNameFirst)
      const serviceFirst = findServiceFromText(text, config.services || []) || (config.services || [])[0]?.name
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
        const unavailableReasonFirst = withinFirst.ok ? undefined : withinFirst.reason
        const fluidFirst = await generateAvailabilityResponseWithAI(
          config,
          {
            requested_time: normalizedFirstTime,
            date_iso: dateFromFirstMsg,
            is_available: false,
            available_slots: availabilityFirst.available.slice(0, 12),
            service: serviceFirst || undefined,
            unavailable_reason: unavailableReasonFirst,
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
        return handleQuoteModeMessage(config, text, nextState)
      }
    }
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
    const aiAnswer = await answerWithContextualAI(config, text, history)
    if (aiAnswer) return buildResult(aiAnswer, { ...nextState, step: "qualification" })
    return buildResult(buildClarificationMessage(config), { ...nextState, step: "qualification" })
  }

  return null
}

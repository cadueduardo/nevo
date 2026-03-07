// @ts-nocheck
/** Helpers extraidos para reduzir duplicacao em qualification e qualification_rejected. */
import { buildResult } from "./state.ts"
import {
  getCordialPrefix,
  buildBookingConfirmationIntro,
  buildServicePrompt,
  buildMultiBookingIntro,
  buildServiceOptions,
  generateRejectionMessageWithAI,
} from "./builders.ts"
import { getServiceWithPrice, findServiceFromText } from "./services.ts"
import { interpretAdditionalBookingsWithAI, interpretBookingRequestWithAI } from "./ai.ts"
import { getSequenceServicesFromText } from "./anytime-handlers.ts"
import { normalizeText } from "./utils.ts"
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"
import type { ResolveBookingFn } from "./orchestrator-actions.ts"

/** Verifica se o match tem contexto suficiente para resposta de rejeicao (qualquer servico nao definido na lista do negocio). */
export function hasMatchContext(match: { inferred_area?: string; confidence?: number }): boolean {
  return (
    Boolean(match.inferred_area) &&
    match.inferred_area !== "indefinido" &&
    (match.confidence ?? 0) >= 0.3
  )
}

export function hasAdditionalBookings(
  interpreted: { has_additional?: boolean; count?: number } | null | undefined,
  orchestrator?: { inferred_attendees?: string } | null
): boolean {
  return Boolean(
    interpreted?.has_additional ||
      (typeof interpreted?.count === "number" && interpreted.count > 0) ||
      orchestrator?.inferred_attendees === "multiple"
  )
}

export function applyAdditionalBookingState(
  state: SimulatorState,
  interpreted: { has_additional?: boolean; count?: number } | null | undefined,
  orchestrator?: { inferred_attendees?: string } | null
): void {
  if (!hasAdditionalBookings(interpreted, orchestrator)) return
  state.pending_additional_booking = true
  state.pending_attendee_name = true
  state.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
  state.expected_additional_count = state.pending_additional_count
}

export function handleShortDecline(config: SimulatorConfig, nextState: SimulatorState): SimulatorResult {
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  if (servicesList.length > 0) {
    const list = servicesList.join(", ")
    return buildResult(`Tudo bem! Se precisar, atendemos: ${list}. Fico a disposicao.`, nextState)
  }
  return buildResult("Tudo bem! Se precisar de algo, fico a disposicao.", nextState)
}

type EnterBookingFromIntentParams = {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: ResolveBookingFn
  orchestrator?: { inferred_service?: string; inferred_attendees?: string } | null
  includeIntro?: boolean
}

export async function enterBookingFromIntent({
  text,
  config,
  nextState,
  history,
  senderDisplayName,
  resolveBooking,
  orchestrator,
  includeIntro = true,
}: EnterBookingFromIntentParams): Promise<SimulatorResult> {
  nextState.mode = "booking"
  nextState.step = undefined

  const bookingRequest = await interpretBookingRequestWithAI(
    text,
    { history, sender_display_name: senderDisplayName },
    config
  )
  const requestServices = (bookingRequest?.service_names || []).filter(Boolean)
  const requestNames = Array.from(new Set((bookingRequest?.attendee_names || []).filter(Boolean)))

  if (!nextState.slots.service && requestServices.length > 0) {
    nextState.slots.service = requestServices.join(", ")
    nextState.just_identified_service = true
  }

  const shouldEnterMultiFromRequest =
    (bookingRequest?.additional_count ?? 0) > 0 ||
    requestNames.length > 1 ||
    (Boolean(bookingRequest?.includes_self) && requestNames.length > 0)

  if (shouldEnterMultiFromRequest) {
    let firstAttendee: string | undefined
    let queueNames = [...requestNames]
    if (bookingRequest?.includes_self && senderDisplayName?.trim()) {
      firstAttendee = senderDisplayName.trim()
    } else if (queueNames.length > 0) {
      firstAttendee = queueNames.shift()
    }

    const additionalCount =
      typeof bookingRequest?.additional_count === "number"
        ? Math.max(bookingRequest.additional_count, queueNames.length)
        : queueNames.length

    nextState.pending_additional_booking = additionalCount > 0
    nextState.pending_additional_count = additionalCount
    nextState.expected_additional_count = additionalCount
    nextState.pending_attendee_queue = queueNames

    if (firstAttendee) {
      nextState.slots.attendee_name = firstAttendee
      if (!nextState.slots.customer_name) nextState.slots.customer_name = firstAttendee
      nextState.pending_attendee_name = false
    } else {
      nextState.pending_attendee_name = true
    }

    if (nextState.pending_attendee_name) {
      return buildResult(`${buildMultiBookingIntro()} De quem sera o primeiro agendamento?`, nextState)
    }
  }

  if (orchestrator?.inferred_service && !nextState.slots.service) {
    nextState.slots.service = orchestrator.inferred_service
    nextState.just_identified_service = true
  }

  const sequenceServices = getSequenceServicesFromText(config, text)
  if (sequenceServices.length >= 2) {
    nextState.slots.service = sequenceServices.join(", ")
    nextState.just_identified_service = true
    const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
    const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
    const message =
      !includeIntro || isMultiBookingPrompt
        ? result.message
        : `${buildBookingConfirmationIntro(config)} ${result.message}`
    return buildResult(message, result.state, result.action_options)
  }

  const interpreted = shouldEnterMultiFromRequest
    ? null
    : await interpretAdditionalBookingsWithAI(text, {
        has_completed_booking: false,
        history,
      })

  applyAdditionalBookingState(nextState, interpreted, orchestrator)
  if (nextState.pending_additional_booking && nextState.pending_attendee_name) {
    return buildResult(`${buildMultiBookingIntro()} De quem sera o primeiro agendamento?`, nextState)
  }

  if (!nextState.slots.attendee_name && requestNames.length === 1 && !bookingRequest?.includes_self) {
    nextState.slots.attendee_name = requestNames[0]
    if (!nextState.slots.customer_name) nextState.slots.customer_name = requestNames[0]
  }

  if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
  if (!nextState.slots.attendee_name && bookingRequest?.for_whom) nextState.slots.attendee_name = bookingRequest.for_whom

  const serviceFromOrchestrator = orchestrator?.inferred_service
    ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
    : null
  const msgNorm = normalizeText(text)
  const useOrchestratorService =
    serviceFromOrchestrator && msgNorm.includes(normalizeText(serviceFromOrchestrator.name))
  const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
  const identifiedService =
    (useOrchestratorService ? serviceFromOrchestrator?.name : null) ||
    (serviceFromText ? getServiceWithPrice(config.services || [], serviceFromText)?.name : null) ||
    serviceFromText

  if (identifiedService) {
    nextState.slots.service = identifiedService
    nextState.just_identified_service = true
    const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
    const message = includeIntro
      ? `${buildBookingConfirmationIntro(config)} ${result.message}`
      : result.message
    return buildResult(message, result.state, result.action_options)
  }

  const prompt = buildServicePrompt(config, text, { attendee_name: nextState.slots.attendee_name })
  const canSequence = config.allow_sequence_booking
  const sequenceList =
    (config.sequence_eligible_services?.length ?? 0) > 0
      ? config.sequence_eligible_services!
      : (config.services || []).map((s) => s.name).filter(Boolean)
  if (canSequence && sequenceList.length > 0) {
    nextState.service_selection_multi = true
    const sequenceOpts = [...sequenceList, "Quero agendar uma visita"]
    nextState.last_service_options = sequenceOpts
    return buildResult(prompt.message, nextState, sequenceOpts)
  }

  nextState.service_selection_multi = false
  nextState.last_service_options = buildServiceOptions(config.services || [])
  return buildResult(prompt.message, nextState, prompt.action_options)
}

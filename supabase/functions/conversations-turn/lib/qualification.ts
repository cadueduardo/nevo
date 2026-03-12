// @ts-nocheck
/** Helpers extraidos para reduzir duplicacao em qualification e qualification_rejected. */
import { buildResult } from "./state.ts"
import {
  getCordialPrefix,
  buildBookingConfirmationIntro,
  buildServicePrompt,
  buildMultiBookingIntro,
  buildServiceOptions,
  buildPriceNotAvailableMessage,
  generateRejectionMessageWithAI,
} from "./builders.ts"
import { getServiceWithPrice, findServiceFromText } from "./services.ts"
import { interpretAdditionalBookingsWithAI, interpretBookingRequestWithAI } from "./ai.ts"
import { buildServicesListResult, getSequenceServicesFromText } from "./anytime-handlers.ts"
import { normalizeText } from "./utils.ts"
import {
  shouldBlockByTargetAudience,
  buildTargetAudienceRestrictionMessage,
  needsAudienceClarification,
  buildAudienceClarificationMessage,
} from "./policies.ts"
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"
import type { ResolveBookingFn } from "./orchestrator-actions.ts"
import { classifyServiceMatch } from "./services.ts"

/** Verifica se o match tem contexto suficiente para resposta de rejeicao (qualquer servico nao definido na lista do negocio). */
export function hasMatchContext(match: { inferred_area?: string; confidence?: number }): boolean {
  return (
    Boolean(match.inferred_area) &&
    match.inferred_area !== "indefinido" &&
    (match.confidence ?? 0) >= 0.3
  )
}

export type ServiceMatchSummary = {
  match: Awaited<ReturnType<typeof classifyServiceMatch>>
  hasContext: boolean
  rejectionMessage: string
}

export async function resolveServiceMatchSummary(params: {
  text: string
  config: SimulatorConfig
  isFirst: boolean
}): Promise<ServiceMatchSummary> {
  const { text, config, isFirst } = params
  const match = await classifyServiceMatch(text, config)
  const hasContext = hasMatchContext(match)
  const rejectionMessage = await generateRejectionMessageWithAI(
    match.inferred_area,
    config,
    isFirst,
    hasContext
  )
  return {
    match,
    hasContext,
    rejectionMessage,
  }
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
  applyManualAdditionalBookingState(state, Math.max(1, interpreted?.count ?? 1))
}

export function applyManualAdditionalBookingState(
  state: SimulatorState,
  count = 1
): void {
  state.pending_additional_booking = true
  state.pending_attendee_name = true
  state.pending_additional_count = Math.max(1, count)
  state.expected_additional_count = state.pending_additional_count
}

export function applyIdentifiedService(
  nextState: SimulatorState,
  service: string,
  options?: { clearStep?: boolean }
): void {
  nextState.slots.service = service
  nextState.just_identified_service = true
  if (options?.clearStep) nextState.step = undefined
}

export function resolveCatalogService(params: {
  text: string
  config: Pick<SimulatorConfig, "services">
  currentService?: string | null
  inferredService?: string | null
  preferExplicitMentionForInferredService?: boolean
}): { serviceName: string | null; service: ReturnType<typeof getServiceWithPrice> | null } {
  const {
    text,
    config,
    currentService,
    inferredService,
    preferExplicitMentionForInferredService = false,
  } = params
  const inferredCatalogService = inferredService ? getServiceWithPrice(config.services || [], inferredService) : null
  const textService = currentService || findServiceFromText(text, config.services || [])
  const normalizedText = normalizeText(text)
  const canUseInferredService =
    inferredCatalogService &&
    (!preferExplicitMentionForInferredService ||
      normalizedText.includes(normalizeText(inferredCatalogService.name)))
  const serviceName =
    (canUseInferredService ? inferredCatalogService?.name : null) ||
    (textService ? getServiceWithPrice(config.services || [], textService)?.name : null) ||
    textService ||
    (!preferExplicitMentionForInferredService ? inferredCatalogService?.name : null) ||
    null
  return {
    serviceName,
    service: serviceName ? getServiceWithPrice(config.services || [], serviceName) : null,
  }
}

export function buildConfiguredPriceResult(
  nextState: SimulatorState,
  intro: string,
  service: { name: string; base_price?: number | null }
): SimulatorResult {
  return buildResult(
    `${intro} O ${service.name} esta R$ ${Number(service.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`.trim(),
    nextState,
    ["Quero agendar", "So queria saber"]
  )
}

export function buildUnavailablePriceResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  intro: string,
  serviceName?: string | null
): SimulatorResult {
  const noPrice = buildPriceNotAvailableMessage(config, serviceName || undefined)
  return buildResult(`${intro} ${noPrice.message}`.trim(), nextState, noPrice.action_options)
}

export function buildPriceAiAnswerResult(
  nextState: SimulatorState,
  aiAnswer: string
): SimulatorResult {
  return buildResult(aiAnswer, nextState, ["Quero agendar", "So queria saber"])
}

export function buildCatalogPriceListResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  intro: string
): SimulatorResult | null {
  const withPrice = (config.services || []).filter((s) => s.base_price != null)
  if (withPrice.length === 0) return null
  nextState.last_service_options = (config.services || []).map((s) => s.name).filter(Boolean)
  return buildServicesListResult(config, nextState, intro)
}

export function handleShortDecline(config: SimulatorConfig, nextState: SimulatorState): SimulatorResult {
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  if (servicesList.length > 0) {
    const list = servicesList.join(", ")
    return buildResult(`Tudo bem! Se precisar, atendemos: ${list}. Fico a disposicao.`, nextState)
  }
  return buildResult("Tudo bem! Se precisar de algo, fico a disposicao.", nextState)
}

export function enterBookingIntentMode(nextState: SimulatorState): void {
  nextState.mode = "booking"
  nextState.step = undefined
}

export function buildFirstAttendeePrompt(nextState: SimulatorState): SimulatorResult {
  return buildResult(`${buildMultiBookingIntro()} De quem sera o primeiro agendamento?`, nextState)
}

export function applyBookingAttendeeName(nextState: SimulatorState, name: string): void {
  nextState.pending_attendee_name = false
  nextState.slots = {
    ...nextState.slots,
    attendee_name: name,
    quote_answers: nextState.slots?.quote_answers || {},
  }
  if (!nextState.slots.customer_name) nextState.slots.customer_name = name
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

type BookingIntentRequest = {
  attendee_names?: string[]
  service_names?: string[]
  additional_count?: number
  includes_self?: boolean
  for_whom?: string
} | null

export async function applyBookingLeadContext(params: {
  text: string
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  inferredAttendees?: unknown
}): Promise<void> {
  const { text, nextState, history, inferredAttendees } = params
  enterBookingIntentMode(nextState)
  const interpreted = await interpretAdditionalBookingsWithAI(text, {
    has_completed_booking: false,
    history,
  })
  applyAdditionalBookingState(
    nextState,
    interpreted,
    inferredAttendees === "multiple" ? { inferred_attendees: "multiple" } : null
  )
  if (!nextState.pending_additional_booking && interpreted?.for_whom) {
    nextState.slots.attendee_name = interpreted.for_whom
  }
}

async function resolveBookingWithOptionalIntro(params: {
  config: SimulatorConfig
  text: string
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: ResolveBookingFn
  includeIntro: boolean
  suppressIntroOnMultiPrompt?: boolean
}): Promise<SimulatorResult> {
  const {
    config,
    text,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    includeIntro,
    suppressIntroOnMultiPrompt = false,
  } = params
  const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
  const shouldSuppressIntro =
    suppressIntroOnMultiPrompt && /De quem sera(o)? o primeiro agendamento/i.test(result.message)
  const message =
    !includeIntro || shouldSuppressIntro
      ? result.message
      : `${buildBookingConfirmationIntro(config)} ${result.message}`
  return buildResult(message, result.state, result.action_options)
}

type HandoffIdentifiedServiceBookingParams = {
  config: SimulatorConfig
  text: string
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: ResolveBookingFn
  service: string
  includeIntro: boolean
  suppressIntroOnMultiPrompt?: boolean
  activateBookingMode?: boolean
  clearStep?: boolean
}

export async function handoffIdentifiedServiceBooking(
  params: HandoffIdentifiedServiceBookingParams
): Promise<SimulatorResult> {
  const {
    config,
    text,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    service,
    includeIntro,
    suppressIntroOnMultiPrompt = false,
    activateBookingMode = false,
    clearStep = false,
  } = params
  if (activateBookingMode) enterBookingIntentMode(nextState)
  applyIdentifiedService(nextState, service, { clearStep })
  return await resolveBookingWithOptionalIntro({
    config,
    text,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    includeIntro,
    suppressIntroOnMultiPrompt,
  })
}

function applyRequestMultiBookingState(params: {
  nextState: SimulatorState
  bookingRequest?: {
    additional_count?: number
    includes_self?: boolean
  } | null
  requestNames: string[]
}): void {
  const { nextState, bookingRequest, requestNames } = params
  const shouldEnterMultiFromRequest =
    (bookingRequest?.additional_count ?? 0) > 0 ||
    requestNames.length > 1 ||
    (Boolean(bookingRequest?.includes_self) && requestNames.length > 0)
  if (!shouldEnterMultiFromRequest) return

  let firstAttendee: string | undefined
  let queueNames = [...requestNames]
  if (queueNames.length > 0) {
    firstAttendee = queueNames.shift()
  }

  const additionalCount =
    typeof bookingRequest?.additional_count === "number"
      ? Math.max(bookingRequest.additional_count, queueNames.length)
      : queueNames.length

  applyManualAdditionalBookingState(nextState, additionalCount)
  nextState.pending_attendee_queue = queueNames

  if (firstAttendee) {
    applyBookingAttendeeName(nextState, firstAttendee)
  }
}

function resolveBookingIntentService(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  orchestrator?: { inferred_service?: string } | null
}): string | null {
  const { text, config, nextState, orchestrator } = params
  return resolveCatalogService({
    text,
    config,
    currentService: nextState.slots.service,
    inferredService: orchestrator?.inferred_service,
    preferExplicitMentionForInferredService: true,
  }).serviceName
}

function hydrateBookingIntentAttendee(params: {
  nextState: SimulatorState
  requestNames: string[]
  bookingRequest?: { includes_self?: boolean; for_whom?: string } | null
  interpreted?: { for_whom?: string } | null
}): void {
  const { nextState, requestNames, bookingRequest, interpreted } = params
  if (!nextState.slots.attendee_name && requestNames.length === 1 && !bookingRequest?.includes_self) {
    applyBookingAttendeeName(nextState, requestNames[0])
  }

  if (interpreted?.for_whom) applyBookingAttendeeName(nextState, interpreted.for_whom)
  if (!nextState.slots.attendee_name && bookingRequest?.for_whom) {
    applyBookingAttendeeName(nextState, bookingRequest.for_whom)
  }
}

function buildBookingIntentServicePrompt(
  config: SimulatorConfig,
  text: string,
  nextState: SimulatorState
): SimulatorResult {
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

function tryHandleBookingIntentAudiencePolicy(
  config: SimulatorConfig,
  text: string,
  nextState: SimulatorState
): SimulatorResult | null {
  if (shouldBlockByTargetAudience(config, text)) {
    return buildResult(
      buildTargetAudienceRestrictionMessage(config),
      {
        ...nextState,
        step: "qualification",
        slots: { ...nextState.slots, attendee_name: undefined },
      },
      ["Quero agendar"]
    )
  }

  if (needsAudienceClarification(config, text)) {
    return buildResult(
      buildAudienceClarificationMessage(config),
      { ...nextState, step: "qualification" },
      ["Sim, nos encaixamos", "Quero agendar"]
    )
  }

  return null
}

async function parseBookingIntentRequest(params: {
  text: string
  config: SimulatorConfig
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
}): Promise<{
  bookingRequest: BookingIntentRequest
  requestServices: string[]
  requestNames: string[]
}> {
  const { text, config, history, senderDisplayName } = params
  const bookingRequest = await interpretBookingRequestWithAI(
    text,
    { history, sender_display_name: senderDisplayName },
    config
  )
  return {
    bookingRequest,
    requestServices: (bookingRequest?.service_names || []).filter(Boolean),
    requestNames: Array.from(new Set((bookingRequest?.attendee_names || []).filter(Boolean))),
  }
}

function applyBookingIntentRequestedService(params: {
  nextState: SimulatorState
  requestServices: string[]
  orchestrator?: { inferred_service?: string } | null
}): void {
  const { nextState, requestServices, orchestrator } = params
  if (!nextState.slots.service && requestServices.length > 0) {
    applyIdentifiedService(nextState, requestServices.join(", "))
    return
  }

  if (orchestrator?.inferred_service && !nextState.slots.service) {
    applyIdentifiedService(nextState, orchestrator.inferred_service)
  }
}

async function tryHandleBookingIntentSequenceServices(params: {
  config: SimulatorConfig
  text: string
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: ResolveBookingFn
  includeIntro: boolean
}): Promise<SimulatorResult | null> {
  const { config, text, nextState, history, senderDisplayName, resolveBooking, includeIntro } = params
  const sequenceServices = getSequenceServicesFromText(config, text)
  if (sequenceServices.length < 2) return null
  return await handoffIdentifiedServiceBooking({
    config,
    text,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    service: sequenceServices.join(", "),
    includeIntro,
    suppressIntroOnMultiPrompt: true,
  })
}

function tryPromptBookingIntentFirstAttendee(nextState: SimulatorState): SimulatorResult | null {
  return nextState.pending_attendee_name ? buildFirstAttendeePrompt(nextState) : null
}

async function resolveBookingIntentAdditionalState(params: {
  text: string
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  orchestrator?: { inferred_attendees?: string } | null
}): Promise<{
  interpreted: { has_additional?: boolean; count?: number; for_whom?: string } | null
  attendeePrompt: SimulatorResult | null
}> {
  const { text, nextState, history, orchestrator } = params
  const interpreted = nextState.pending_additional_booking
    ? null
    : await interpretAdditionalBookingsWithAI(text, {
        has_completed_booking: false,
        history,
      })

  applyAdditionalBookingState(nextState, interpreted, orchestrator)

  return {
    interpreted,
    attendeePrompt:
      nextState.pending_additional_booking && nextState.pending_attendee_name
        ? buildFirstAttendeePrompt(nextState)
        : null,
  }
}

async function tryResolveBookingIntentIdentifiedService(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: ResolveBookingFn
  includeIntro: boolean
  orchestrator?: { inferred_service?: string } | null
}): Promise<SimulatorResult | null> {
  const {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    includeIntro,
    orchestrator,
  } = params
  const identifiedService = resolveBookingIntentService({
    text,
    config,
    nextState,
    orchestrator,
  })

  if (!identifiedService) return null

  return await handoffIdentifiedServiceBooking({
    config,
    text,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    service: identifiedService,
    includeIntro,
  })
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
  const audiencePolicyResult = tryHandleBookingIntentAudiencePolicy(config, text, nextState)
  if (audiencePolicyResult) return audiencePolicyResult
  enterBookingIntentMode(nextState)

  const { bookingRequest, requestServices, requestNames } = await parseBookingIntentRequest({
    text,
    config,
    history,
    senderDisplayName,
  })

  applyBookingIntentRequestedService({
    nextState,
    requestServices,
    orchestrator,
  })

  applyRequestMultiBookingState({
    nextState,
    bookingRequest,
    requestNames,
  })
  const firstAttendeePrompt = tryPromptBookingIntentFirstAttendee(nextState)
  if (firstAttendeePrompt) return firstAttendeePrompt

  const sequenceServicesResult = await tryHandleBookingIntentSequenceServices({
    config,
    text,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    includeIntro,
  })
  if (sequenceServicesResult) return sequenceServicesResult

  const { interpreted, attendeePrompt } = await resolveBookingIntentAdditionalState({
    text,
    nextState,
    history,
    orchestrator,
  })
  if (attendeePrompt) return attendeePrompt

  hydrateBookingIntentAttendee({
    nextState,
    requestNames,
    bookingRequest,
    interpreted,
  })

  const identifiedServiceResult = await tryResolveBookingIntentIdentifiedService({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    includeIntro,
    orchestrator,
  })
  if (identifiedServiceResult) return identifiedServiceResult

  return buildBookingIntentServicePrompt(config, text, nextState)
}

export async function handoffBookingIntent(params: EnterBookingFromIntentParams): Promise<SimulatorResult> {
  return await enterBookingFromIntent(params)
}


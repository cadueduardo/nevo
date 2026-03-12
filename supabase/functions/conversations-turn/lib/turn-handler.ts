// @ts-nocheck
/**
 * Orquestrador principal do turno do simulador.
 * - processSimulatorMessage: pipeline de fases (qualification_rejected, qualification, fallback); early steps em lib/turn/early/.
 * - handleBookingModeMessage: modo booking; delega para resolve-booking ? BOOKING_HANDLERS em lib/booking/index.ts.
 */

import type { SimulatorConfig, SimulatorState, SimulatorResult, FlowOrchestratorOutput } from "./types.ts"
import type { Phase } from "./flow-pipeline.ts"
import type { SimulatorHandlerContext, ConversationRuntimeContext, TurnPipelineContext } from "./turn-context.ts"
import { runEarlySteps } from "./turn/early/index.ts"
import { buildResult } from "./state.ts"
import { normalizeText } from "./utils.ts"
import {
  isGreeting,
  getGreetingByTime,
  isFinalizedState,
  isPriceQuestion,
  isListServicesQuestion,
  isServiceDetailQuestion,
  isExplicitBookingIntent,
  isVisitRequest,
  isDirectServiceInquiry,
  isPoliteDecline,
  detectModeFromText,
} from "./detection.ts"
import {
  findServiceByExactMatch,
  findServiceFromText,
  getServiceWithPrice,
  getServicesTotalDuration,
  areaMatchesServices,
} from "./services.ts"
import {
  getCordialPrefix,
  getGreetingMessage,
  buildClarificationMessage,
} from "./builders.ts"
import {
  interpretFlowWithAI,
  interpretBookingRequestWithAI,
  answerWithContextualAI,
  extractAttendeeNameForMultiBooking,
} from "./ai.ts"
import {
  applyBookingAttendeeName,
  applyBookingLeadContext,
  applyManualAdditionalBookingState,
  applyIdentifiedService,
  buildFirstAttendeePrompt,
  enterBookingIntentMode,
  handoffBookingIntent,
  handoffIdentifiedServiceBooking,
  handleShortDecline,
  resolveCatalogService,
  resolveServiceMatchSummary,
  buildConfiguredPriceResult,
  buildUnavailablePriceResult,
  buildPriceAiAnswerResult,
  buildCatalogPriceListResult,
} from "./qualification.ts"
import {
  applyConversationRules,
  postServiceResolutionRules,
  isFirstMessage,
  buildGuidedClarification,
} from "./conversation-rules.ts"
import {
  tryResolveNumericServiceSelection,
  tryResolveNumericMultipleServiceSelection,
  getSequenceServicesFromText,
  buildServicesListResult,
  tryHandleServicesQuestionAnytime,
} from "./anytime-handlers.ts"
import {
  handleQualificationRejectedOrchestratorAction,
  handleQualificationOrchestratorAction,
} from "./orchestrator-actions.ts"
import { runPipeline } from "./flow-pipeline.ts"
import { resolveQuote } from "./quote-mode.ts"
import { ensureConversationMode } from "./ensure-mode.ts"
import { resolveBooking } from "./resolve-booking.ts"
import { tryAnswerInformationalQuestion } from "./informational.ts"
function shouldEnterLegacyBookingFromSignals(params: {
  hasStrongBookingIntent: boolean
  bookingIntent?: boolean
  suggested_action?: string
  confidence?: number
  minConfidence: number
}): boolean {
  if (params.hasStrongBookingIntent || params.bookingIntent === true) return true
  return (
    params.suggested_action === "start_booking" &&
    (params.confidence ?? 0) >= params.minConfidence
  )
}

async function tryEnterLegacyBookingIntent(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: typeof resolveBooking
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
  getOrchestrator?: () => Promise<FlowOrchestratorOutput | null>
  hasStrongBookingIntent?: boolean
  minConfidence?: number
  requireSignalDecision: boolean
}): Promise<SimulatorResult | null> {
  const {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    getBookingRequest,
    getOrchestrator,
    hasStrongBookingIntent = false,
    minConfidence = 0,
    requireSignalDecision,
  } = params
  const bookingRequest = await getBookingRequest()
  if (!requireSignalDecision) {
    if (!bookingRequest?.booking_intent) return null
    return await handoffBookingIntent({
      text,
      config,
      nextState,
      history,
      senderDisplayName,
      resolveBooking,
      includeIntro: true,
    })
  }

  const orchestrator = getOrchestrator ? await getOrchestrator() : null
  const shouldEnterFromSignals = shouldEnterLegacyBookingFromSignals({
    hasStrongBookingIntent,
    bookingIntent: bookingRequest?.booking_intent,
    suggested_action: orchestrator?.suggested_action,
    confidence: orchestrator?.confidence,
    minConfidence,
  })
  if (!shouldEnterFromSignals) return null
  return await handoffBookingIntent({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    orchestrator,
    includeIntro: true,
  })
}

async function tryBuildLegacyDirectInquiryRejection(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, isFirst } = params
  if (!isDirectServiceInquiry(text) || (config.services || []).length === 0) return null
  const { match, hasContext, rejectionMessage } = await getLegacyServiceMatchSummary({
    text,
    config,
    isFirst,
  })
  if (!hasContext || match.service) return null
  return buildLegacyRejectionResult(nextState, rejectionMessage)
}

async function getLegacyServiceMatchSummary(params: {
  text: string
  config: SimulatorConfig
  isFirst: boolean
}) {
  return await resolveServiceMatchSummary(params)
}

function buildLegacyStepState(
  nextState: SimulatorState,
  step: SimulatorState["step"],
  options?: { clearMode?: boolean }
): SimulatorState {
  return {
    ...nextState,
    step,
    ...(options?.clearMode ? { mode: undefined } : {}),
  }
}

function buildLegacyRejectedQualificationState(
  nextState: SimulatorState,
  options?: { clearMode?: boolean }
): SimulatorState {
  return buildLegacyStepState(nextState, "qualification_rejected", options)
}

function buildLegacyQualificationGuidanceResult(
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult {
  return buildLegacyMessageResult(nextState, buildGuidedClarification(config))
}

function buildLegacyClarificationResult(
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult {
  return buildLegacyMessageResult(nextState, buildClarificationMessage(config))
}

function buildLegacyMessageResult(
  nextState: SimulatorState,
  message: string,
  options?: { step?: SimulatorState["step"]; clearMode?: boolean; actionOptions?: string[] }
): SimulatorResult {
  const state = options?.step
    ? buildLegacyStepState(nextState, options.step, { clearMode: options?.clearMode })
    : options?.clearMode
      ? { ...nextState, mode: undefined }
      : nextState
  return buildResult(message, state, options?.actionOptions)
}

function buildLegacyQualificationContextResult(
  nextState: SimulatorState,
  rejectionMessage: string
): SimulatorResult {
  return buildLegacyMessageResult(nextState, rejectionMessage, { step: "qualification" })
}

function buildLegacyRejectedQualificationResult(
  nextState: SimulatorState,
  rejectionMessage: string,
  options?: { clearMode?: boolean }
): SimulatorResult {
  return buildLegacyMessageResult(nextState, rejectionMessage, {
    step: "qualification_rejected",
    clearMode: options?.clearMode,
  })
}

function buildLegacyPricedServiceResult(
  nextState: SimulatorState,
  cordial: string,
  service: { name: string; base_price?: number | null }
): SimulatorResult {
  return buildConfiguredPriceResult(nextState, cordial, service)
}

function buildLegacyPriceUnavailableResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  cordial: string,
  serviceName?: string | null
): SimulatorResult {
  return buildUnavailablePriceResult(config, nextState, cordial, serviceName)
}

function buildLegacyPriceAiAnswerResult(
  nextState: SimulatorState,
  aiAnswer: string
): SimulatorResult {
  return buildPriceAiAnswerResult(nextState, aiAnswer)
}

function buildLegacyPriceCatalogListResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  cordial: string
): SimulatorResult {
  return buildCatalogPriceListResult(config, nextState, cordial) as SimulatorResult
}

function buildLegacyAiAnswerResult(
  nextState: SimulatorState,
  aiAnswer: string
): SimulatorResult {
  return buildLegacyMessageResult(nextState, aiAnswer)
}

function buildLegacyRejectionResult(
  nextState: SimulatorState,
  rejectionMessage: string
): SimulatorResult {
  return buildLegacyMessageResult(nextState, rejectionMessage)
}

function resolveLegacyInitialServiceCandidate(
  text: string,
  config: SimulatorConfig
): string | null {
  const exactService = findServiceByExactMatch(text, config.services || [])
  if (exactService) return exactService
  const { serviceName } = resolveCatalogService({ text, config })
  if (serviceName) return serviceName
  return isVisitRequest(text) ? "visita" : null
}

function applyLegacyMatchedServiceSummary(
  nextState: SimulatorState,
  summary: Awaited<ReturnType<typeof getLegacyServiceMatchSummary>>
): string | null {
  if (!summary.match.service) return null
  applyLegacyMatchedServiceState(nextState, summary.match.service)
  return summary.match.service
}

function shouldRejectLegacyMatchSummary(
  summary: Awaited<ReturnType<typeof getLegacyServiceMatchSummary>>
): boolean {
  return Boolean(
    summary.match.reject ||
      (summary.match.inferred_area &&
        summary.match.inferred_area !== "indefinido" &&
        !summary.match.service)
  )
}

function buildLegacyMatchSummaryResult(params: {
  summary: Awaited<ReturnType<typeof getLegacyServiceMatchSummary>>
  nextState: SimulatorState
  rejectedState?: SimulatorState
  fallbackMessage: string
  forceRejectPolicy?: boolean
}): SimulatorResult {
  const { summary, nextState, rejectedState, fallbackMessage, forceRejectPolicy = false } = params
  if (summary.match.reject && rejectedState) {
    return buildLegacyMessageResult(rejectedState, summary.rejectionMessage)
  }
  if (summary.hasContext && (summary.match.reject || forceRejectPolicy)) {
    return buildLegacyMessageResult(nextState, summary.rejectionMessage)
  }
  return buildLegacyMessageResult(nextState, fallbackMessage)
}

async function tryHandleLegacyPriceQuestion(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  cordial: string
  isFirst: boolean
  rejectionState?: SimulatorState
  allowNoPriceFallback: boolean
}): Promise<SimulatorResult | null> {
  const {
    text,
    config,
    nextState,
    history,
    cordial,
    isFirst,
    rejectionState,
    allowNoPriceFallback,
  } = params
  if (!isPriceQuestion(text)) return null

  const { serviceName, service: svc } = resolveCatalogService({
    text,
    config,
  })
  if (serviceName && svc && svc.base_price != null) {
    applyLegacyMatchedServiceState(nextState, svc.name)
    await applyBookingLeadContext({ text, nextState, history })
    return buildLegacyPricedServiceResult(nextState, cordial, svc)
  }

  if (serviceName && svc && allowNoPriceFallback) {
    const aiAnswer = await answerWithContextualAI(config, text, history)
    if (aiAnswer && /R\$\s*\d/.test(aiAnswer)) {
      return buildLegacyPriceAiAnswerResult(nextState, aiAnswer)
    }
    return buildLegacyPriceUnavailableResult(config, nextState, cordial, serviceName)
  }

  if (!serviceName && (config.services || []).length > 0) {
    const { match, hasContext, rejectionMessage } = await getLegacyServiceMatchSummary({
      text,
      config,
      isFirst,
    })
    if (hasContext && !match.service) {
      return buildLegacyRejectionResult(rejectionState || nextState, rejectionMessage)
    }
  }

  const withPrice = (config.services || []).filter((s) => s.base_price != null)
  if (withPrice.length > 0) {
    await applyBookingLeadContext({ text, nextState, history })
    return buildLegacyPriceCatalogListResult(config, nextState, cordial)
  }

  if (!allowNoPriceFallback) return null

  const aiAnswer = await answerWithContextualAI(config, text, history)
  if (aiAnswer && /R\$\s*\d/.test(aiAnswer)) {
    return buildLegacyPriceAiAnswerResult(nextState, aiAnswer)
  }
  return buildLegacyPriceUnavailableResult(config, nextState, cordial)
}

async function resolveLegacyQualificationMatchFallback(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
  rejectedState?: SimulatorState
}): Promise<SimulatorResult> {
  const { text, config, nextState, isFirst, rejectedState } = params
  const summary = await getLegacyServiceMatchSummary({
    text,
    config,
    isFirst,
  })
  if (applyLegacyMatchedServiceSummary(nextState, summary)) {
    return buildLegacyQualificationGuidanceResult(config, nextState)
  }

  return buildLegacyMatchSummaryResult({
    summary,
    nextState,
    rejectedState,
    fallbackMessage: buildGuidedClarification(config),
    forceRejectPolicy: Boolean(config.lead_policy?.reject_unlisted_services),
  })
}

async function tryResolveLegacyQualificationEntryMatch(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, isFirst } = params
  const summary = await getLegacyServiceMatchSummary({
    text,
    config,
    isFirst,
  })
  return buildLegacyQualificationEntryResult({
    config,
    nextState,
    summary,
  })
}

async function tryRejectInvalidLegacyBookingEntry(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
  isAttendeeNameTurn: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, isFirst, isAttendeeNameTurn } = params
  if (
    nextState.mode !== "booking" ||
    nextState.slots.service ||
    isAttendeeNameTurn ||
    !config.lead_policy?.reject_unlisted_services ||
    (config.services || []).length === 0 ||
    isGreeting(text)
  ) {
    return null
  }
  const summary = await getLegacyServiceMatchSummary({
    text,
    config,
    isFirst,
  })
  if (!shouldRejectLegacyMatchSummary(summary)) {
    return null
  }
  return buildLegacyRejectedQualificationResult(nextState, summary.rejectionMessage, {
    clearMode: true,
  })
}

function tryHandleLegacyGreetingEntry(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult | null {
  if (nextState.mode || !isGreeting(text)) return null
  const greeting = getGreetingMessage(config)
  return buildLegacyMessageResult(nextState, greeting, { step: "qualification" })
}

function tryResolveLegacyAskMode(
  text: string,
  nextState: SimulatorState
): SimulatorResult | null {
  if (nextState.step !== "ask_mode" || nextState.mode) return null
  const detected = detectModeFromText(text)
  if (!detected) {
    return buildLegacyMessageResult(
      nextState,
      "Entendi. Voce quer agendar um horario ou pedir um orcamento?"
    )
  }
  nextState.mode = detected
  return null
}

function getLegacyAttendeeTurnSignals(params: {
  text: string
  pendingAttendeeName?: boolean
  lastAssistantMessage: string
  maxLength: number
}): {
  askedForAttendeeName: boolean
  isPlausibleAnswer: boolean
  shouldEnterBooking: boolean
} {
  const { text, pendingAttendeeName, lastAssistantMessage, maxLength } = params
  const normalizedLastAssistant = normalizeText(String(lastAssistantMessage || ""))
  const askedForAttendeeName =
    /(?:de\s+quem\s+)?sera(o)?\s+o\s+(?:primeiro|proximo)\s+agendamento/i.test(normalizedLastAssistant) ||
    ((/\bde\s+quem\b/.test(normalizedLastAssistant) || /\bqual\b.*\bnome\b/.test(normalizedLastAssistant)) &&
      /\bagendamento\b/.test(normalizedLastAssistant))
  const trimmed = text.trim()
  const isPlausibleAnswer =
    trimmed.length >= 2 &&
    trimmed.length <= maxLength &&
    !isExplicitBookingIntent(text) &&
    !isGreeting(text)
  return {
    askedForAttendeeName,
    isPlausibleAnswer,
    shouldEnterBooking: Boolean(pendingAttendeeName || askedForAttendeeName) && isPlausibleAnswer,
  }
}

function getLegacyLastAssistantMessage(
  nextState: SimulatorState,
  history: Array<{ role: string; content: string }>,
  options?: { includeLastPrompt?: boolean }
): string {
  const lastAssistantInHistory =
    history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : ""
  if (options?.includeLastPrompt === false) {
    return String(lastAssistantInHistory || "")
  }
  return `${String(lastAssistantInHistory || "")} ${String(nextState.last_prompt || "")}`.trim()
}

function getLegacyAttendeeGuardContext(params: {
  text: string
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  maxLength: number
  includeLastPrompt?: boolean
}) {
  const { text, nextState, history, maxLength, includeLastPrompt = true } = params
  return getLegacyAttendeeTurnSignals({
    text,
    pendingAttendeeName: nextState.pending_attendee_name,
    lastAssistantMessage: getLegacyLastAssistantMessage(nextState, history, {
      includeLastPrompt,
    }),
    maxLength,
  })
}

function tryApplyLegacyAudienceConfirmation(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult | null {
  if ((config.services || []).length === 0) return null
  const trimmed = normalizeText(text).trim()
  const isAudienceConfirmation =
    /^(1\s*[-�"".)]\s*)?(sim,?\s*nos\s+encaixamos|nos\s+encaixamos)\s*$/i.test(trimmed) ||
    /^sim,?\s*nos\s+encaixamos\s*$/i.test(trimmed) ||
    trimmed === "1" ||
    (trimmed.length <= 60 && /\bnos\s+encaixamos\b/i.test(trimmed))
  if (!isAudienceConfirmation) return null
  enterBookingIntentMode(nextState)
  applyManualAdditionalBookingState(nextState, 1)
  return buildFirstAttendeePrompt(nextState)
}

function dispatchLegacyQualificationAudienceStep(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult | null {
  const infoAnswer = tryAnswerInformationalQuestion(config, text)
  if (infoAnswer) {
    return buildLegacyMessageResult(nextState, infoAnswer)
  }
  return tryApplyLegacyAudienceConfirmation(text, config, nextState)
}

async function tryEnterLegacyBookingFromAttendeeSignals(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  runtime?: ConversationRuntimeContext
  signals: { shouldEnterBooking: boolean }
  immediateHandoff?: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, isFirst, runtime, signals, immediateHandoff } = params
  if (!signals.shouldEnterBooking) return null
  enterBookingIntentMode(nextState)
  applyManualAdditionalBookingState(nextState, nextState.pending_additional_count ?? 1)
  if (!immediateHandoff) return null
  return await handleBookingModeMessage({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    runtime,
  })
}

async function dispatchLegacyAttendeeRecovery(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  runtime?: ConversationRuntimeContext
}): Promise<{ result: SimulatorResult | null; isAttendeeNameTurn: boolean }> {
  const { text, config, nextState, history, senderDisplayName, isFirst, runtime } = params
  const attendeeRecovery = getLegacyAttendeeGuardContext({
    text,
    nextState,
    history,
    maxLength: 150,
  })
  const isAttendeeNameTurn = attendeeRecovery.shouldEnterBooking
  const result = await tryEnterLegacyBookingFromAttendeeSignals({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    runtime,
    signals: {
      shouldEnterBooking: attendeeRecovery.askedForAttendeeName && attendeeRecovery.isPlausibleAnswer,
    },
    immediateHandoff: false,
  })
  return { result, isAttendeeNameTurn }
}

async function tryHandleLegacyPhaseOrchestrator(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  resolveBooking: typeof resolveBooking
  minConfidence: number
  getOrchestrator: () => Promise<FlowOrchestratorOutput | null>
  handler: typeof handleQualificationOrchestratorAction | typeof handleQualificationRejectedOrchestratorAction
}): Promise<SimulatorResult | null> {
  const {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
    minConfidence,
    getOrchestrator,
    handler,
  } = params
  const orchestrator = await getOrchestrator()
  if (!orchestrator || orchestrator.confidence < minConfidence) return null
  return await handler(orchestrator, {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
  })
}

async function tryHandleLegacyAttendeePromptAnswer(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName } = params
  const last =
    nextState.last_prompt ||
    (history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : "") ||
    ""
  const name = await extractAttendeeNameForMultiBooking(text, { lastAssistantMessage: last })
  if (!name) return null
  enterBookingIntentMode(nextState)
  applyManualAdditionalBookingState(nextState, nextState.pending_additional_count ?? 1)
  applyBookingAttendeeName(nextState, name)
  const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
  return buildLegacyMessageResult(result.state, result.message, {
    actionOptions: result.action_options,
  })
}

async function dispatchLegacyQualificationCoreEntry(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, isFirst } = params
  const n = normalizeText(text)
  const isShortDecline =
    /^(entendi|ok|t[a??] ok|tudo bem|obrigado|obrigada|valeu|nao|n??o)$/.test(n) ||
    /^(entendi|ok|tudo bem)[,\s]+(obrigad|valeu)/.test(n) ||
    isPoliteDecline(text)
  if (isShortDecline) return handleShortDecline(config, nextState)

  return await tryBuildLegacyDirectInquiryRejection({
    text,
    config,
    nextState,
    isFirst,
  })
}

async function dispatchLegacyQualificationCoreTail(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  isFirst: boolean
  allowNoPriceFallback: boolean
  rejectionState?: SimulatorState
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, isFirst, allowNoPriceFallback, rejectionState } = params
  const servicesQuestion = tryHandleServicesQuestionAnytime(config, text, nextState)
  if (servicesQuestion) return servicesQuestion

  return await tryHandleLegacyPriceQuestion({
    text,
    config,
    nextState,
    history,
    cordial: getCordialPrefix(config, isFirst),
    isFirst,
    rejectionState,
    allowNoPriceFallback,
  })
}

async function dispatchLegacyQualificationCore(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  resolveBooking: typeof resolveBooking
  hasStrongBookingIntent: boolean
  minOrchestratorConfidence: number
  getOrchestrator: () => Promise<FlowOrchestratorOutput | null>
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
  orchestratorHandler:
    | typeof handleQualificationOrchestratorAction
    | typeof handleQualificationRejectedOrchestratorAction
  allowNoPriceFallback: boolean
  rejectionState?: SimulatorState
}): Promise<SimulatorResult | null> {
  const {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
    hasStrongBookingIntent,
    minOrchestratorConfidence,
    getOrchestrator,
    getBookingRequest,
    orchestratorHandler,
    allowNoPriceFallback,
    rejectionState,
  } = params
  const entryResult = await dispatchLegacyQualificationCoreEntry({
    text,
    config,
    nextState,
    isFirst,
  })
  if (entryResult) return entryResult

  const bookingEntry = await tryEnterLegacyBookingIntent({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    hasStrongBookingIntent,
    minConfidence: minOrchestratorConfidence,
    getOrchestrator,
    getBookingRequest,
    requireSignalDecision: true,
  })
  if (bookingEntry) return bookingEntry

  const handledOrchestrator = await tryHandleLegacyPhaseOrchestrator({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
    minConfidence: minOrchestratorConfidence,
    getOrchestrator,
    handler: orchestratorHandler,
  })
  if (handledOrchestrator) return handledOrchestrator

  return await dispatchLegacyQualificationCoreTail({
    text,
    config,
    nextState,
    history,
    isFirst,
    allowNoPriceFallback,
    rejectionState,
  })
}

async function runLegacyQualificationRejectedPhase(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: typeof resolveBooking
  hasStrongBookingIntent: boolean
  minOrchestratorConfidence: number
  getOrchestrator: () => Promise<FlowOrchestratorOutput | null>
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
}): Promise<SimulatorResult> {
  return await runLegacyQualificationCorePhase({
    ...params,
    isFirst: false,
    orchestratorHandler: handleQualificationRejectedOrchestratorAction,
    allowNoPriceFallback: false,
    resolveFallback: ({ text, config, nextState }) =>
      resolveLegacyRejectedMatchFallback(text, config, nextState),
  })
}

async function runLegacyQualificationCorePhase(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  resolveBooking: typeof resolveBooking
  hasStrongBookingIntent: boolean
  minOrchestratorConfidence: number
  getOrchestrator: () => Promise<FlowOrchestratorOutput | null>
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
  orchestratorHandler:
    | typeof handleQualificationOrchestratorAction
    | typeof handleQualificationRejectedOrchestratorAction
  allowNoPriceFallback: boolean
  rejectionState?: SimulatorState
  preCore?: (params: {
    text: string
    config: SimulatorConfig
    nextState: SimulatorState
    history: Array<{ role: string; content: string }>
    senderDisplayName?: string
    isFirst: boolean
  }) => Promise<SimulatorResult | null>
  resolveFallback: (params: {
    text: string
    config: SimulatorConfig
    nextState: SimulatorState
    history: Array<{ role: string; content: string }>
    isFirst: boolean
    rejectedState?: SimulatorState
  }) => Promise<SimulatorResult>
}): Promise<SimulatorResult> {
  const {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
    hasStrongBookingIntent,
    minOrchestratorConfidence,
    getOrchestrator,
    getBookingRequest,
    orchestratorHandler,
    allowNoPriceFallback,
    rejectionState,
    preCore,
    resolveFallback,
  } = params
  if (preCore) {
    const preCoreResult = await preCore({
      text,
      config,
      nextState,
      history,
      senderDisplayName,
      isFirst,
    })
    if (preCoreResult) return preCoreResult
  }

  const coreResult = await dispatchLegacyQualificationCore({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
    hasStrongBookingIntent,
    minOrchestratorConfidence,
    getOrchestrator,
    getBookingRequest,
    orchestratorHandler,
    allowNoPriceFallback,
    rejectionState,
  })
  if (coreResult) return coreResult

  return await resolveFallback({
    text,
    config,
    nextState,
    history,
    isFirst,
    rejectedState,
  })
}

async function runLegacyQualificationPhase(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  resolveBooking: typeof resolveBooking
  hasStrongBookingIntent: boolean
  minOrchestratorConfidence: number
  getOrchestrator: () => Promise<FlowOrchestratorOutput | null>
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
}): Promise<SimulatorResult> {
  return await runLegacyQualificationCorePhase({
    ...params,
    orchestratorHandler: handleQualificationOrchestratorAction,
    allowNoPriceFallback: true,
    rejectionState: buildLegacyRejectedQualificationState(params.nextState),
    preCore: dispatchLegacyQualificationPreCore,
    resolveFallback: dispatchLegacyQualificationFallback,
  })
}

async function dispatchLegacyQualificationPreCore(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, isFirst } = params

  const audienceStep = dispatchLegacyQualificationAudienceStep(text, config, nextState)
  if (audienceStep) return audienceStep

  return await tryResolveLegacyQualificationServiceGate({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
  })
}

async function dispatchLegacyQualificationFallback(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  isFirst: boolean
  rejectedState: SimulatorState
}): Promise<SimulatorResult> {
  const { text, config, nextState, history, isFirst, rejectedState } = params
  const qualAiAnswer = await answerWithContextualAI(config, text, history)
  if (qualAiAnswer?.trim()) {
    return buildLegacyAiAnswerResult(nextState, qualAiAnswer)
  }

  return await resolveLegacyQualificationMatchFallback({
    text,
    config,
    nextState,
    isFirst,
    rejectedState,
  })
}

function buildLegacyQualificationEntryResult(params: {
  config: SimulatorConfig
  nextState: SimulatorState
  summary: Awaited<ReturnType<typeof getLegacyServiceMatchSummary>>
}): SimulatorResult | null {
  const { config, nextState, summary } = params
  if (applyLegacyMatchedServiceSummary(nextState, summary)) return null
  if (summary.match.reject) {
    return buildLegacyRejectedQualificationResult(nextState, summary.rejectionMessage)
  }
  if (summary.hasContext) {
    return buildLegacyQualificationContextResult(nextState, summary.rejectionMessage)
  }
  return buildLegacyQualificationGuidanceResult(config, buildLegacyStepState(nextState, "qualification"))
}

async function buildLegacyQualificationServiceGateResult(params: {
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  text: string
  summary: Awaited<ReturnType<typeof getLegacyServiceMatchSummary>>
}): Promise<SimulatorResult | null> {
  const { config, nextState, history, senderDisplayName, text, summary } = params
  if (summary.match.service) {
    return await handoffIdentifiedServiceBooking({
      config,
      text,
      nextState,
      history,
      senderDisplayName,
      resolveBooking,
      service: summary.match.service,
      includeIntro: true,
      activateBookingMode: true,
      clearStep: true,
    })
  }

  const areaMatches = areaMatchesServices(summary.match.inferred_area, config.services || [])
  if (summary.match.reject || (summary.hasContext && !summary.match.service && !areaMatches)) {
    return buildLegacyRejectedQualificationResult(nextState, summary.rejectionMessage)
  }

  return null
}

async function tryResolveLegacyQualificationServiceGate(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, isFirst } = params
  if (
    isGreeting(text) ||
    (config.services || []).length === 0 ||
    nextState.slots.service ||
    !(config.lead_policy?.reject_unlisted_services || config.lead_policy?.use_ai_matching)
  ) {
    return null
  }

  const summary = await getLegacyServiceMatchSummary({
    text,
    config,
    isFirst,
  })
  return await buildLegacyQualificationServiceGateResult({
    config,
    nextState,
    history,
    senderDisplayName,
    text,
    summary,
  })
}

async function resolveLegacyRejectedMatchFallback(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): Promise<SimulatorResult> {
  const directInquiryRejected = await tryBuildLegacyDirectInquiryRejection({
    text,
    config,
    nextState,
    isFirst: false,
  })
  if (directInquiryRejected) return directInquiryRejected

  const summary = await getLegacyServiceMatchSummary({
    text,
    config,
    isFirst: false,
  })
  return buildLegacyMatchSummaryResult({
    summary,
    nextState,
    fallbackMessage: buildGuidedClarification(config),
    forceRejectPolicy: true,
  })
}

function applyLegacyMatchedServiceState(nextState: SimulatorState, service: string): void {
  applyIdentifiedService(nextState, service, { clearStep: true })
}

function applyLegacyInitialServiceState(nextState: SimulatorState, service: string): void {
  applyIdentifiedService(nextState, service)
}

async function runLegacyFallbackPhase(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  runtime?: ConversationRuntimeContext
  resolveBooking: typeof resolveBooking
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
}): Promise<SimulatorResult> {
  const {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    runtime,
    resolveBooking,
    getBookingRequest,
  } = params
  const attendeeRecovery = await dispatchLegacyAttendeeRecovery({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    runtime,
  })
  if (attendeeRecovery.result) return attendeeRecovery.result

  const preModeDispatch = await dispatchLegacyFallbackPreMode({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
    getBookingRequest,
    isAttendeeNameTurn: attendeeRecovery.isAttendeeNameTurn,
  })
  if (preModeDispatch) return preModeDispatch

  return await dispatchLegacyModeContinuation({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    runtime,
  })
}

function shouldTryLegacyFallbackQualificationEntry(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
  isAttendeeNameTurn: boolean
}): boolean {
  const { text, config, nextState, isFirst, isAttendeeNameTurn } = params
  return Boolean(
    !nextState.mode &&
      config.lead_policy?.reject_unlisted_services &&
      (config.services || []).length > 0 &&
      !nextState.slots.service &&
      !isAttendeeNameTurn &&
      !isGreeting(text) &&
      !isFirst
  )
}

async function tryResolveLegacyFallbackQualificationEntry(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
  isAttendeeNameTurn: boolean
}): Promise<SimulatorResult | null> {
  if (!shouldTryLegacyFallbackQualificationEntry(params)) return null
  return await tryResolveLegacyQualificationEntryMatch({
    text: params.text,
    config: params.config,
    nextState: params.nextState,
    isFirst: params.isFirst,
  })
}

function shouldTryLegacyFallbackBookingEntry(text: string, nextState: SimulatorState): boolean {
  return !(
    nextState.mode ||
    isPriceQuestion(text) ||
    isListServicesQuestion(text) ||
    isServiceDetailQuestion(text)
  )
}

async function tryResolveLegacyFallbackBookingEntry(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  resolveBooking: typeof resolveBooking
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
}): Promise<SimulatorResult | null> {
  if (!shouldTryLegacyFallbackBookingEntry(params.text, params.nextState)) return null
  return await tryEnterLegacyBookingIntent({
    text: params.text,
    config: params.config,
    nextState: params.nextState,
    history: params.history,
    senderDisplayName: params.senderDisplayName,
    resolveBooking: params.resolveBooking,
    getBookingRequest: params.getBookingRequest,
    requireSignalDecision: false,
  })
}

async function dispatchLegacyFallbackPreMode(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  resolveBooking: typeof resolveBooking
  getBookingRequest: () => Promise<import("./ai.ts").BookingRequestInterpretation | null>
  isAttendeeNameTurn: boolean
}): Promise<SimulatorResult | null> {
  const {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    resolveBooking,
    getBookingRequest,
    isAttendeeNameTurn,
  } = params

  const qualificationEntry = await tryResolveLegacyFallbackQualificationEntry({
    text,
    config,
    nextState,
    isFirst,
    isAttendeeNameTurn,
  })
  if (qualificationEntry) return qualificationEntry

  const anyTurnBookingEntry = await tryResolveLegacyFallbackBookingEntry({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    resolveBooking,
    getBookingRequest,
  })
  if (anyTurnBookingEntry) return anyTurnBookingEntry

  return await dispatchLegacyFallbackResidualPreMode({
    text,
    config,
    nextState,
    isFirst,
    isAttendeeNameTurn,
  })
}

async function dispatchLegacyFallbackResidualPreMode(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
  isAttendeeNameTurn: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, isFirst, isAttendeeNameTurn } = params

  const routingResult = dispatchLegacyFallbackRoutingStep(text, config, nextState)
  if (routingResult) return routingResult

  return await tryRejectInvalidLegacyBookingEntry({
    text,
    config,
    nextState,
    isFirst,
    isAttendeeNameTurn,
  })
}

function dispatchLegacyFallbackRoutingStep(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult | null {
  const greetingEntry = tryHandleLegacyGreetingEntry(text, config, nextState)
  if (greetingEntry) return greetingEntry

  const modeResult = ensureConversationMode(text, config, nextState)
  if (modeResult) return modeResult

  return tryResolveLegacyAskMode(text, nextState)
}

export async function handleBookingModeMessage(context: SimulatorHandlerContext): Promise<SimulatorResult> {
  const { text, config, nextState, history, senderDisplayName } = context
  return await resolveBooking(config, text, nextState, history, senderDisplayName)
}

async function dispatchLegacyModeContinuation(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  runtime?: ConversationRuntimeContext
}): Promise<SimulatorResult> {
  const { text, config, nextState, history, senderDisplayName, isFirst, runtime } = params
  if (nextState.mode === "booking") {
    return await handleBookingModeMessage({
      text,
      config,
      nextState,
      history,
      senderDisplayName,
      isFirst,
      runtime,
    })
  }
  return resolveQuote(config, text, nextState)
}

function resolveLegacyIncomingTurnInput(input: string, state: SimulatorState) {
  const incomingText = input.trim()
  const numericMultiServiceResolved = tryResolveNumericMultipleServiceSelection(incomingText, state)
  const numericServiceResolved = tryResolveNumericServiceSelection(incomingText, state)
  let numericActionResolved: string | null = null
  if (
    /^[1-9]\d*$/.test(incomingText) &&
    Array.isArray(state.last_action_options) &&
    state.last_action_options.length > 0
  ) {
    const idx = parseInt(incomingText, 10) - 1
    if (idx >= 0 && idx < state.last_action_options.length) {
      const raw = String(state.last_action_options[idx] || "").trim()
      numericActionResolved = raw.replace(/^\d+\s*-\s*/, "").trim()
    }
  }

  const text =
    numericActionResolved || numericMultiServiceResolved || numericServiceResolved || incomingText
  const textNorm = normalizeText(text)
  const hasForcedBookingAction = normalizeText(String(numericActionResolved || "")) === "quero agendar"
  const hasStrongBookingIntent =
    hasForcedBookingAction ||
    isExplicitBookingIntent(text) ||
    /\b(quero|gostaria|preciso|pode|sim)\b.*\b(agendar|marcar)\b/.test(textNorm)
  const isNumericOption =
    /^[1-9]\d*$/.test(text) &&
    Array.isArray(state.last_action_options) &&
    state.last_action_options.length > 0

  return {
    text,
    textNorm,
    hasForcedBookingAction,
    hasStrongBookingIntent,
    isNumericOption,
  }
}

function buildLegacyTurnCaches(params: {
  text: string
  history: Array<{ role: string; content: string }>
  nextState: SimulatorState
  config: SimulatorConfig
  senderDisplayName?: string
}) {
  const { text, history, nextState, config, senderDisplayName } = params
  let orchestratorCached: FlowOrchestratorOutput | null | undefined = undefined
  const getOrchestrator = async (): Promise<FlowOrchestratorOutput | null> => {
    if (orchestratorCached !== undefined) return orchestratorCached
    orchestratorCached = await interpretFlowWithAI(text, history, nextState, config)
    return orchestratorCached
  }

  let bookingRequestCached: import("./ai.ts").BookingRequestInterpretation | null | undefined = undefined
  const getBookingRequest = async () => {
    if (bookingRequestCached !== undefined) return bookingRequestCached
    bookingRequestCached = await interpretBookingRequestWithAI(
      text,
      { history, sender_display_name: senderDisplayName },
      config
    )
    return bookingRequestCached
  }

  return {
    getOrchestrator,
    getBookingRequest,
  }
}

function tryHandleLegacyFinalizedThanks(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult | null {
  if (!isFinalizedState(nextState)) return null
  const msg = normalizeText(text)
  if (!/\b(obrigad|valeu|agradec)\b/.test(msg)) return null
  const company = config.business_name ? `A ${config.business_name}` : "A empresa"
  const saudacao = getGreetingByTime()
  nextState.final_thanks_sent = true
  return buildLegacyMessageResult(
    nextState,
    `Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`
  )
}


export async function processSimulatorMessage(
  input: string,
  config: SimulatorConfig,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string,
  runtime?: ConversationRuntimeContext
): Promise<SimulatorResult> {
  const { text, textNorm, hasForcedBookingAction, hasStrongBookingIntent, isNumericOption } =
    resolveLegacyIncomingTurnInput(input, state)

  // Trava mínima: mensagens muito curtas (ex: "O", "a") �" mensagem clara respeitando o tom do negócio.
  const MIN_MSG_LENGTH = 2
  if (text.length > 0 && text.length < MIN_MSG_LENGTH && !isNumericOption) {
    return buildLegacyClarificationResult(config, buildLegacyStepState(state, "qualification"))
  }
  const nextState: SimulatorState = {
    ...state,
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const isFirst = isFirstMessage(state)
  // Hard-guard para multiagendamento:
  // se o turno anterior pediu o nome do primeiro/proximo agendamento, a resposta atual
  // precisa entrar direto no booking (evita cair em fallback/qualificacao generica).
  const attendeeHardGuard = getLegacyAttendeeGuardContext({
    text,
    nextState,
    history,
    maxLength: 200,
  })
  const attendeeHardGuardResult = await tryEnterLegacyBookingFromAttendeeSignals({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    runtime,
    signals: attendeeHardGuard,
    immediateHandoff: true,
  })
  if (attendeeHardGuardResult) return attendeeHardGuardResult

  const minOrchestratorConfidence = 0.5
  const { getOrchestrator, getBookingRequest } = buildLegacyTurnCaches({
    text,
    history,
    nextState,
    config,
    senderDisplayName,
  })

  const ctx: TurnPipelineContext = {
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    isFirst,
    textNorm,
    hasForcedBookingAction,
    hasStrongBookingIntent,
    minOrchestratorConfidence,
    getOrchestrator,
    runtime,
  }
  const earlyResult = await runEarlySteps(ctx)
  if (earlyResult) return earlyResult

  if (!nextState.slots.service) {
    const initialService = resolveLegacyInitialServiceCandidate(text, config)
    if (initialService) applyLegacyInitialServiceState(nextState, initialService)
  }

  const postServiceRuleResult = applyConversationRules(postServiceResolutionRules, { text, config, nextState })
  if (postServiceRuleResult) return postServiceRuleResult

  // Encerrar conversa ap�s agradecimento final para evitar loop
  const finalizedThanksResult = tryHandleLegacyFinalizedThanks(text, config, nextState)
  if (finalizedThanksResult) return finalizedThanksResult

  const phases: Phase<typeof ctx>[] = [
    // Intercepta��o: quando o contexto � "quem ser� o primeiro/pr�ximo agendamento?" e o usu�rio responde, usar IA para extrair o nome e seguir no booking. Roda sempre que a �ltima pergunta pediu o nome (ou state tem pending_attendee_name), mesmo que mode j� seja booking � evita "Pode me dar mais detalhes?" quando o cliente j� disse o nome.
    {
      when: (c) => {
        const last =
          c.nextState.last_prompt ||
          (c.history.length > 0 ? c.history.filter((m) => m.role === "assistant").pop()?.content : undefined)
        const lastNorm = normalizeText(String(last || ""))
        const asked =
          lastNorm && (/(?:de\s+quem\s+)?sera(o)?\s+o\s+(?:primeiro|proximo)\s+agendamento/i.test(lastNorm) || (/\b(?:primeiro|proximo)\b/.test(lastNorm) && /\bagendamento\b/.test(lastNorm)))
        const trimmed = c.text.trim()
        const plausible =
          trimmed.length >= 2 &&
          trimmed.length <= 200 &&
          !isExplicitBookingIntent(c.text) &&
          !isGreeting(c.text)
        return (asked || Boolean(c.nextState.pending_attendee_name)) && plausible
      },
      run: async () =>
        await tryHandleLegacyAttendeePromptAnswer({
          text,
          config,
          nextState,
          history,
          senderDisplayName,
        }),
    },
    {
      when: (c) => c.nextState.step === "qualification_rejected",
      run: async () =>
        await runLegacyQualificationRejectedPhase({
          text,
          config,
          nextState,
          history,
          senderDisplayName,
          resolveBooking,
          hasStrongBookingIntent,
          minOrchestratorConfidence,
          getOrchestrator,
          getBookingRequest,
        }),
    // Prioridade: regex (ágil) ou orquestrador (IA como consierge �" qualquer redação)
    },
    {
      when: (c) => c.nextState.step === "qualification",
      run: async () =>
        await runLegacyQualificationPhase({
          text,
          config,
          nextState,
          history,
          senderDisplayName,
          isFirst,
          resolveBooking,
          hasStrongBookingIntent,
          minOrchestratorConfidence,
          getOrchestrator,
          getBookingRequest,
        }),
    // NÃO chamar a IA primeiro: priorizar entrada em booking e coleta de slots (nome, contato).
    // A IA só é usada como fallback no final do bloco, para perguntas que não são agendamento.

    // Confirmação de público (esclarecimento homens+infantil): "Sim, nos encaixamos" �' fluxo múltiplo (antes da triagem para não ser capturado pela IA)
    // Regex ou orquestrador (IA como consierge �" qualquer estilo)
    // Fallback: IA consierge só quando não entrou em booking nem em nenhum fluxo acima
    },
    {
      when: () => true,
      run: async () =>
        await runLegacyFallbackPhase({
          text,
          config,
          nextState,
          history,
          senderDisplayName,
          isFirst,
          runtime,
          resolveBooking,
          getBookingRequest,
        }),
  // Recupera��o: se a �ltima pergunta foi "quem ser� o primeiro/pr�ximo agendamento" (hist�rico ou last_prompt) e o usu�rio respondeu com texto plaus�vel (nome ou frase curta), for�ar booking e pular o bloco que pede "mais detalhes"
  // Verificar se o serviço existe ANTES de entrar no modo booking
  // Isso previne que o bot tente agendar serviços que não existem
    },
  ]
  return runPipeline(ctx, phases)
}






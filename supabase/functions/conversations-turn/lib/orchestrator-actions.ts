// @ts-nocheck
/** Handlers de acoes do orquestrador (IA): primeira mensagem, qualification, qualification_rejected. */
import { buildResult } from "./state.ts"
import {
  getCordialPrefix,
  getGreetingMessage,
  buildListServicesMessage,
  buildServicesListWithPrices,
  buildClarificationMessage,
  buildGenericFallback,
  generateRejectionMessageWithAI,
} from "./builders.ts"
import { getServiceWithPrice } from "./services.ts"
import { isPriceQuestion } from "./detection.ts"
import {
  applyBookingLeadContext,
  applyIdentifiedService,
  handoffBookingIntent,
  resolveCatalogService,
  resolveServiceMatchSummary,
  buildConfiguredPriceResult,
  buildUnavailablePriceResult,
  buildCatalogPriceListResult,
} from "./qualification.ts"
import { answerWithContextualAI } from "./ai.ts"
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"

export type ResolveBookingFn = (
  config: SimulatorConfig,
  text: string,
  state: SimulatorState,
  history: Array<{ role: string; content: string }>,
  senderDisplayName?: string
) => Promise<SimulatorResult>

export type SimulatorHandlerContext = {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  resolveBooking: ResolveBookingFn
}

export type OrchestratorAction =
  | "no_match_fallback"
  | "answer_price"
  | "list_services"
  | "start_booking"
  | "service_detail"
  | "ask_clarification"

export type OrchestratorActionHandler = () => Promise<SimulatorResult | null>
export type OrchestratorActionHandlers = Partial<Record<OrchestratorAction, OrchestratorActionHandler>>

function resolveOrchestratorCatalogService(params: {
  text: string
  config: SimulatorConfig
  inferredService?: string | null
}): { serviceName: string | null; service: ReturnType<typeof getServiceWithPrice> | null } {
  const { text, config, inferredService } = params
  return resolveCatalogService({
    text,
    config,
    inferredService,
  })
}

function buildOrchestratorServiceOptionsState(
  config: SimulatorConfig,
  nextState: SimulatorState,
  options?: { step?: SimulatorState["step"] }
): { state: SimulatorState; serviceOptions: string[] } {
  const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
  return {
    state: {
      ...nextState,
      ...(options?.step ? { step: options.step } : {}),
      last_service_options: serviceOptions,
    },
    serviceOptions,
  }
}

function buildOrchestratorClarificationResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  clarificationQuestion?: string,
  options?: { step?: SimulatorState["step"] }
): SimulatorResult {
  const message = clarificationQuestion?.trim() || buildClarificationMessage(config)
  return buildOrchestratorMessageResult(nextState, message, {
    step: options?.step,
  })
}

function buildOrchestratorMessageResult(
  nextState: SimulatorState,
  message: string,
  options?: { step?: SimulatorState["step"]; actionOptions?: string[] }
): SimulatorResult {
  const state = options?.step ? { ...nextState, step: options.step } : nextState
  return buildResult(message, state, options?.actionOptions)
}

function buildOrchestratorAiAnswerResult(
  nextState: SimulatorState,
  aiAnswer: string
): SimulatorResult {
  return buildOrchestratorMessageResult(nextState, aiAnswer)
}

function buildOrchestratorRejectionResult(
  nextState: SimulatorState,
  rejectionMessage: string
): SimulatorResult {
  return buildOrchestratorMessageResult(nextState, rejectionMessage)
}

function buildOrchestratorGenericFallbackResult(
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult {
  return buildOrchestratorMessageResult(nextState, buildGenericFallback(config))
}

function buildOrchestratorBookingPromptResult(
  nextState: SimulatorState,
  message: string
): SimulatorResult {
  return buildOrchestratorMessageResult(nextState, message, {
    actionOptions: ["Quero agendar"],
  })
}

async function getOrchestratorServiceMatchSummary(params: {
  text: string
  config: SimulatorConfig
  isFirst: boolean
}) {
  return await resolveServiceMatchSummary(params)
}

async function buildOrchestratorFallbackResult(params: {
  config: SimulatorConfig
  text: string
  history: Array<{ role: string; content: string }>
  nextState: SimulatorState
  step?: SimulatorState["step"]
}): Promise<SimulatorResult> {
  const { config, text, history, nextState, step } = params
  const state = step ? { ...nextState, step } : nextState
  const aiAnswer = await answerWithContextualAI(config, text, history)
  if (aiAnswer) return buildOrchestratorAiAnswerResult(state, aiAnswer)
  return buildOrchestratorGenericFallbackResult(config, state)
}

function buildOrchestratorFallbackHandler(params: {
  config: SimulatorConfig
  text: string
  history: Array<{ role: string; content: string }>
  nextState: SimulatorState
  step?: SimulatorState["step"]
}): OrchestratorActionHandler {
  return async () => buildOrchestratorFallbackResult(params)
}

async function applyOrchestratorPriceBookingLeadContext(params: {
  nextState: SimulatorState
  text: string
  history: Array<{ role: string; content: string }>
  inferredAttendees?: unknown
}): Promise<void> {
  const { nextState, text, history, inferredAttendees } = params
  await applyBookingLeadContext({
    text,
    nextState,
    history,
    inferredAttendees,
  })
}

function buildAfterGenericServicesListResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  step?: SimulatorState["step"]
): SimulatorResult {
  return buildOrchestratorServicesListResult(
    config,
    nextState,
    buildListServicesMessage(config, { intro: "after_generic" }),
    { step }
  )
}

function buildFirstMessageServicesListResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  greeting: string
): SimulatorResult {
  return buildOrchestratorServicesListResult(
    config,
    nextState,
    `${greeting}\n\n${buildServicesListWithPrices(config)}`,
    { step: "qualification" }
  )
}

function buildOrchestratorServicesListResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  message: string,
  options?: { step?: SimulatorState["step"] }
): SimulatorResult {
  const { state, serviceOptions } = buildOrchestratorServiceOptionsState(config, nextState, {
    step: options?.step,
  })
  return buildResult(message, state, serviceOptions)
}

function buildFirstMessageServiceDetailResult(
  config: SimulatorConfig,
  text: string,
  nextState: SimulatorState,
  greeting: string,
  inferredService?: string | null
): SimulatorResult | null {
  const { serviceName, service: svc } = resolveOrchestratorCatalogService({
    text,
    config,
    inferredService,
  })
  if (svc?.description) {
    return buildOrchestratorBookingPromptResult(
      nextState,
      greeting + " " + `${svc.name}: ${svc.description} Quer agendar?`
    )
  }
  if (serviceName) {
    return buildOrchestratorBookingPromptResult(
      nextState,
      greeting +
        " " +
        `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`
    )
  }
  return null
}

function buildStartBookingOrchestratorHandler(
  orchestrator: any,
  context: SimulatorHandlerContext,
  includeIntro: boolean
): OrchestratorActionHandler {
  return async () =>
    handoffBookingIntent({
      text: context.text,
      config: context.config,
      nextState: context.nextState,
      history: context.history,
      senderDisplayName: context.senderDisplayName,
      resolveBooking: context.resolveBooking,
      orchestrator,
      includeIntro,
    })
}

function buildFirstMessageServiceDetailHandler(params: {
  config: SimulatorConfig
  text: string
  nextState: SimulatorState
  greeting: string
  inferredService?: string | null
}): OrchestratorActionHandler {
  return async () =>
    buildFirstMessageServiceDetailResult(
      params.config,
      params.text,
      params.nextState,
      params.greeting,
      params.inferredService
    )
}

async function buildOrchestratorClarificationFallbackOrNull(params: {
  config: SimulatorConfig
  text: string
  history: Array<{ role: string; content: string }>
  nextState: SimulatorState
  clarificationQuestion?: string
}): Promise<SimulatorResult | null> {
  const { config, text, history, nextState, clarificationQuestion } = params
  const aiAnswer = await answerWithContextualAI(config, text, history)
  if (aiAnswer) return buildOrchestratorAiAnswerResult(nextState, aiAnswer)
  if (clarificationQuestion) {
    return buildOrchestratorClarificationResult(config, nextState, clarificationQuestion)
  }
  return null
}

async function buildOrchestratorMatchRejectionOrNull(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, isFirst } = params
  const { match, hasContext, rejectionMessage } = await getOrchestratorServiceMatchSummary({
    text,
    config,
    isFirst,
  })
  if (!hasContext || match.service) return null
  return buildOrchestratorRejectionResult(nextState, rejectionMessage)
}

function buildOrchestratorPricedServiceResult(params: {
  nextState: SimulatorState
  intro: string
  service: { name: string; base_price?: number | null }
}): SimulatorResult {
  const { nextState, intro, service } = params
  applyIdentifiedService(nextState, service.name)
  return buildConfiguredPriceResult(nextState, intro, service)
}

function buildOrchestratorPriceUnavailableResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  intro: string,
  serviceName?: string | null
): SimulatorResult {
  return buildUnavailablePriceResult(config, nextState, intro, serviceName)
}

function buildOrchestratorPriceCatalogListResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  intro: string
): SimulatorResult | null {
  const { state } = buildOrchestratorServiceOptionsState(config, nextState)
  return buildCatalogPriceListResult(config, state, intro)
}

function buildOrchestratorCatalogPriceFallbackResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  intro: string,
  serviceName?: string | null
): SimulatorResult {
  const catalogListResult = buildOrchestratorPriceCatalogListResult(config, nextState, intro)
  if (catalogListResult) return catalogListResult
  return buildOrchestratorPriceUnavailableResult(config, nextState, intro, serviceName)
}

async function buildOrchestratorAnswerPriceResult(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  cordial: string
  isFirst: boolean
  inferredService?: string | null
  inferredAttendees?: unknown
  rejectFromPriceQuestion?: boolean
}): Promise<SimulatorResult | null> {
  const {
    text,
    config,
    nextState,
    history,
    cordial,
    isFirst,
    inferredService,
    inferredAttendees,
    rejectFromPriceQuestion = false,
  } = params
  const svc = inferredService ? getServiceWithPrice(config.services || [], inferredService) : null
  if (inferredService && !svc) {
    const rejectionMessage = await generateRejectionMessageWithAI(inferredService, config, isFirst, true)
    return buildOrchestratorRejectionResult(nextState, rejectionMessage)
  }

  if (!svc && rejectFromPriceQuestion && isPriceQuestion(text) && (config.services || []).length > 0) {
    const rejectionResult = await buildOrchestratorMatchRejectionOrNull({
      text,
      config,
      nextState,
      isFirst,
    })
    if (rejectionResult) return rejectionResult
  }

  if (svc && svc.base_price != null) {
    await applyOrchestratorPriceBookingLeadContext({
      nextState,
      text,
      history,
      inferredAttendees,
    })
    return buildOrchestratorPricedServiceResult({
      nextState,
      intro: cordial,
      service: svc,
    })
  }

  await applyOrchestratorPriceBookingLeadContext({
    nextState,
    text,
    history,
    inferredAttendees,
  })
  return buildOrchestratorPriceCatalogListResult(config, nextState, cordial)
}

async function buildQualificationServicesListOrNull(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
  step?: SimulatorState["step"]
}): Promise<SimulatorResult | null> {
  const { text, config, nextState, isFirst, step } = params
  if (isPriceQuestion(text) && (config.services || []).length > 0) {
    const rejectionResult = await buildOrchestratorMatchRejectionOrNull({
      text,
      config,
      nextState,
      isFirst,
    })
    if (rejectionResult) return rejectionResult
  }
  return buildAfterGenericServicesListResult(config, nextState, step)
}

async function buildFirstMessageAnswerPriceResult(params: {
  orchestrator: any
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  priceIntro: string
}): Promise<SimulatorResult> {
  const { orchestrator, text, config, nextState, priceIntro } = params
  const inferredServiceMatch = await getOrchestratorServiceMatchSummary({
    text,
    config,
    isFirst: true,
  })
  const { serviceName, service: svc } = resolveOrchestratorCatalogService({
    text,
    config,
    inferredService: orchestrator?.inferred_service ?? inferredServiceMatch.match.service,
  })
  if (serviceName && svc && svc.base_price != null) {
    return buildOrchestratorPricedServiceResult({
      nextState,
      intro: priceIntro,
      service: svc,
    })
  }
  if (serviceName && svc) {
    return buildOrchestratorPriceUnavailableResult(config, nextState, priceIntro, serviceName)
  }
  return buildOrchestratorCatalogPriceFallbackResult(config, nextState, priceIntro)
}

function buildFirstMessageClarificationResult(
  config: SimulatorConfig,
  nextState: SimulatorState,
  clarificationQuestion?: string
): SimulatorResult {
  return buildOrchestratorClarificationResult(config, nextState, clarificationQuestion, {
    step: "qualification",
  })
}

function buildFirstMessageClarificationHandler(params: {
  config: SimulatorConfig
  nextState: SimulatorState
  clarificationQuestion?: string
}): OrchestratorActionHandler {
  return async () =>
    buildFirstMessageClarificationResult(
      params.config,
      params.nextState,
      params.clarificationQuestion
    )
}

function buildOrchestratorPriceHandler(params: {
  orchestrator: any
  context: SimulatorHandlerContext
  cordial: string
  isFirst: boolean
  rejectFromPriceQuestion?: boolean
}): OrchestratorActionHandler {
  const { orchestrator, context, cordial, isFirst, rejectFromPriceQuestion = false } = params
  return async () =>
    buildOrchestratorAnswerPriceResult({
      text: context.text,
      config: context.config,
      nextState: context.nextState,
      history: context.history,
      cordial,
      isFirst,
      inferredService: orchestrator.inferred_service,
      inferredAttendees: orchestrator?.inferred_attendees,
      rejectFromPriceQuestion,
    })
}

function buildOrchestratorServicesListHandler(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  isFirst: boolean
  step?: SimulatorState["step"]
  rejectUnknownService?: boolean
}): OrchestratorActionHandler {
  const { text, config, nextState, isFirst, step, rejectUnknownService = false } = params
  return async () =>
    rejectUnknownService
      ? buildQualificationServicesListOrNull({
          text,
          config,
          nextState,
          isFirst,
          step,
        })
      : buildAfterGenericServicesListResult(config, nextState, step)
}

function buildFirstMessagePriceHandler(params: {
  orchestrator: any
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  priceIntro: string
}): OrchestratorActionHandler {
  return async () => buildFirstMessageAnswerPriceResult(params)
}

function buildDefaultOrchestratorHandlers(params: {
  orchestrator: any
  context: SimulatorHandlerContext
  includeIntro: boolean
  fallbackStep?: SimulatorState["step"]
}): Pick<OrchestratorActionHandlers, "no_match_fallback" | "start_booking"> {
  const { orchestrator, context, includeIntro, fallbackStep } = params
  return {
    no_match_fallback: buildOrchestratorFallbackHandler({
      config: context.config,
      text: context.text,
      history: context.history,
      nextState: context.nextState,
      step: fallbackStep,
    }),
    start_booking: buildStartBookingOrchestratorHandler(orchestrator, context, includeIntro),
  }
}

function buildClarificationWithOptionalRejectionHandler(params: {
  text: string
  config: SimulatorConfig
  history: Array<{ role: string; content: string }>
  nextState: SimulatorState
  isFirst: boolean
  clarificationQuestion?: string
  rejectUnknownService: boolean
}): OrchestratorActionHandler {
  const {
    text,
    config,
    history,
    nextState,
    isFirst,
    clarificationQuestion,
    rejectUnknownService,
  } = params
  return async () => {
    if (rejectUnknownService) {
      const rejectionResult = await buildOrchestratorMatchRejectionOrNull({
        text,
        config,
        nextState,
        isFirst,
      })
      if (rejectionResult) return rejectionResult
    }
    return buildOrchestratorClarificationFallbackOrNull({
      config,
      text,
      history,
      nextState,
      clarificationQuestion,
    })
  }
}

function buildQualificationLikeOrchestratorHandlers(params: {
  orchestrator: any
  context: SimulatorHandlerContext
  cordial: string
  isFirst: boolean
  includeIntro: boolean
  listStep?: SimulatorState["step"]
  rejectUnknownServiceForList: boolean
  rejectUnknownServiceForClarification: boolean
  rejectFromPriceQuestion?: boolean
}): OrchestratorActionHandlers {
  const {
    orchestrator,
    context,
    cordial,
    isFirst,
    includeIntro,
    listStep,
    rejectUnknownServiceForList,
    rejectUnknownServiceForClarification,
    rejectFromPriceQuestion = false,
  } = params
  const { text, config, nextState, history } = context

  return {
    ...buildDefaultOrchestratorHandlers({
      orchestrator,
      context,
      includeIntro,
    }),
    answer_price: buildOrchestratorPriceHandler({
      orchestrator,
      context,
      cordial,
      isFirst,
      rejectFromPriceQuestion,
    }),
    list_services: buildOrchestratorServicesListHandler({
      text,
      config,
      nextState,
      isFirst,
      step: listStep,
      rejectUnknownService: rejectUnknownServiceForList,
    }),
    ask_clarification: buildClarificationWithOptionalRejectionHandler({
      text,
      config,
      history,
      nextState,
      isFirst,
      clarificationQuestion: orchestrator?.clarification_question,
      rejectUnknownService: rejectUnknownServiceForClarification,
    }),
  }
}

function buildFirstMessageOrchestratorHandlers(params: {
  orchestrator: any
  context: SimulatorHandlerContext
  greeting: string
  priceIntro: string
}): OrchestratorActionHandlers {
  const { orchestrator, context, greeting, priceIntro } = params
  const { text, config, nextState } = context

  return {
    ...buildDefaultOrchestratorHandlers({
      orchestrator,
      context,
      includeIntro: false,
      fallbackStep: "qualification",
    }),
    answer_price: buildFirstMessagePriceHandler({
      orchestrator,
      text,
      config,
      nextState,
      priceIntro,
    }),
    list_services: async () => buildFirstMessageServicesListResult(config, nextState, greeting),
    service_detail: buildFirstMessageServiceDetailHandler({
      config,
      text,
      nextState,
      greeting,
      inferredService: orchestrator?.inferred_service,
    }),
    ask_clarification: buildFirstMessageClarificationHandler({
      config,
      nextState,
      clarificationQuestion: orchestrator?.clarification_question,
    }),
  }
}

export async function runOrchestratorAction(
  orchestrator: any,
  handlers: OrchestratorActionHandlers
): Promise<SimulatorResult | null> {
  const action = (orchestrator?.suggested_action || "") as OrchestratorAction
  const handler = handlers[action]
  return handler ? await handler() : null
}

export async function handleQualificationRejectedOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const handlers = buildQualificationLikeOrchestratorHandlers({
    orchestrator,
    context,
    cordial: getCordialPrefix(context.config, false),
    isFirst: false,
    includeIntro: true,
    listStep: "qualification",
    rejectUnknownServiceForList: false,
    rejectUnknownServiceForClarification: true,
  })

  return await runOrchestratorAction(orchestrator, handlers)
}

export async function handleQualificationOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const handlers = buildQualificationLikeOrchestratorHandlers({
    orchestrator,
    context,
    cordial: getCordialPrefix(context.config, context.isFirst),
    isFirst: context.isFirst,
    includeIntro: true,
    rejectUnknownServiceForList: true,
    rejectUnknownServiceForClarification: false,
    rejectFromPriceQuestion: true,
  })

  return await runOrchestratorAction(orchestrator, handlers)
}

export async function handleFirstMessageOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const greeting = getGreetingMessage(context.config)
  const priceIntro = `Obrigado por entrar em contato${context.config.business_name ? ` com a ${context.config.business_name}` : ""}.`
  const handlers = buildFirstMessageOrchestratorHandlers({
    orchestrator,
    context,
    greeting,
    priceIntro,
  })

  return await runOrchestratorAction(orchestrator, handlers)
}

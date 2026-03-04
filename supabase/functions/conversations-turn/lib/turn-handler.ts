// @ts-nocheck
/**
 * Orquestrador principal do turno do simulador.
 * - processSimulatorMessage: pipeline de fases (qualification_rejected, qualification, fallback); early steps em lib/turn/early/.
 * - handleBookingModeMessage: modo booking; delega para resolve-booking → BOOKING_HANDLERS em lib/booking/index.ts.
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
  classifyServiceMatch,
  areaMatchesServices,
} from "./services.ts"
import {
  getCordialPrefix,
  getGreetingMessage,
  buildBookingConfirmationIntro,
  buildPriceNotAvailableMessage,
  buildClarificationMessage,
  buildServiceOptions,
  buildServicePrompt,
  buildMultiBookingIntro,
  generateRejectionMessageWithAI,
} from "./builders.ts"
import {
  interpretFlowWithAI,
  interpretAdditionalBookingsWithAI,
  answerWithContextualAI,
  extractAttendeeNameForMultiBooking,
} from "./ai.ts"
import { hasMatchContext, handleShortDecline } from "./qualification.ts"
import {
  applyConversationRules,
  postServiceResolutionRules,
  isFirstMessage,
  buildGuidedClarification,
} from "./conversation-rules.ts"
import {
  tryResolveNumericServiceSelection,
  getSequenceServicesFromText,
  buildServicesListResult,
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
import { getEntryActionOptions } from "./request-helpers.ts"

function handleQuoteModeMessage(config: SimulatorConfig, text: string, nextState: SimulatorState): SimulatorResult {
  return resolveQuote(config, text, nextState)
}

export async function handleBookingModeMessage(context: SimulatorHandlerContext): Promise<SimulatorResult> {
  const { text, config, nextState, history, senderDisplayName, isFirst } = context
  const cordial = getCordialPrefix(config, isFirst)

  if (isPriceQuestion(text)) {
    const serviceName = findServiceFromText(text, config.services || [])
    const svc = getServiceWithPrice(config.services || [], serviceName)
    if (serviceName && svc && svc.base_price != null) {
      nextState.slots.service = svc.name
      nextState.just_identified_service = true
      return buildResult(
        cordial + `O ${svc.name} estÃ¡ R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
        nextState,
        ["Quero agendar", "SÃ³ queria saber"]
      )
    }
    if (serviceName && svc) {
      const noPrice = buildPriceNotAvailableMessage(config, serviceName)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }
    if (!serviceName && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
        return buildResult(rejectionMessage, nextState)
      }
    }
    const withPrice = (config.services || []).filter((s) => s.base_price != null)
    if (withPrice.length > 0) {
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      nextState.last_service_options = serviceOptions
      return buildServicesListResult(config, nextState, cordial)
    }
    const noPrice = buildPriceNotAvailableMessage(config)
    return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
  }

  if (isListServicesQuestion(text)) {
    return buildServicesListResult(config, nextState, cordial)
  }

  if (isServiceDetailQuestion(text)) {
    const serviceName = findServiceFromText(text, config.services || [])
    const svc = getServiceWithPrice(config.services || [], serviceName)
    if (svc?.description) {
      return buildResult(cordial + `${svc.name}: ${svc.description} Quer agendar?`, nextState, ["Quero agendar"])
    }
    if (serviceName) {
      return buildResult(
        cordial + `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`,
        nextState,
        ["Quero agendar"]
      )
    }
  }

  if (isFirst && !isGreeting(text)) {
    const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
    return buildResult(result.message, result.state, result.action_options)
  }

  return await resolveBooking(config, text, nextState, history, senderDisplayName)
}

export async function processSimulatorMessage(
  input: string,
  config: SimulatorConfig,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string,
  runtime?: ConversationRuntimeContext
): Promise<SimulatorResult> {
  const incomingText = input.trim()
  const numericServiceResolved = tryResolveNumericServiceSelection(incomingText, state)
  let numericActionResolved: string | null = null
  if (/^[1-9]\d*$/.test(incomingText) && Array.isArray(state.last_action_options) && state.last_action_options.length > 0) {
    const idx = parseInt(incomingText, 10) - 1
    if (idx >= 0 && idx < state.last_action_options.length) {
      const raw = String(state.last_action_options[idx] || "").trim()
      numericActionResolved = raw.replace(/^\d+\s*-\s*/, "").trim()
    }
  }
  const text = numericActionResolved || numericServiceResolved || incomingText
  const textNorm = normalizeText(text)
  const hasForcedBookingAction = normalizeText(String(numericActionResolved || "")) === "quero agendar"
  const hasStrongBookingIntent =
    hasForcedBookingAction ||
    isExplicitBookingIntent(text) ||
    /\b(quero|gostaria|preciso|pode|sim)\b.*\b(agendar|marcar)\b/.test(textNorm)

  // Trava mÃ­nima: mensagens muito curtas (ex: "O", "a") â€" mensagem clara respeitando o tom do negÃ³cio.
  const MIN_MSG_LENGTH = 2
  const isNumericOption =
    /^[1-9]\d*$/.test(text) && Array.isArray(state.last_action_options) && state.last_action_options.length > 0
  if (text.length > 0 && text.length < MIN_MSG_LENGTH && !isNumericOption) {
    return buildResult(buildClarificationMessage(config), { ...state, step: "qualification" })
  }
  const nextState: SimulatorState = {
    ...state,
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const isFirst = isFirstMessage(state)
  const minOrchestratorConfidence = 0.5
  let orchestratorCached: FlowOrchestratorOutput | null | undefined = undefined
  const getOrchestrator = async (): Promise<FlowOrchestratorOutput | null> => {
    if (orchestratorCached !== undefined) return orchestratorCached
    orchestratorCached = await interpretFlowWithAI(text, history, nextState, config)
    return orchestratorCached
  }

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
    const exactService = findServiceByExactMatch(text, config.services || [])
    if (exactService) {
      nextState.slots.service = exactService
    } else {
      const service = findServiceFromText(text, config.services || [])
      if (service) nextState.slots.service = service
      else if (isVisitRequest(text)) nextState.slots.service = "visita"
    }
  }

  const postServiceRuleResult = applyConversationRules(postServiceResolutionRules, { text, config, nextState })
  if (postServiceRuleResult) return postServiceRuleResult

  // Encerrar conversa após agradecimento final para evitar loop
  if (isFinalizedState(nextState)) {
    const msg = normalizeText(text)
    if (/\b(obrigad|valeu|agradec)\b/.test(msg)) {
      const company = config.business_name ? `A ${config.business_name}` : "A empresa"
      const saudacao = getGreetingByTime()
      nextState.final_thanks_sent = true
      return buildResult(`Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`, nextState)
    }
  }

  const phases: Phase<typeof ctx>[] = [
    // Interceptação: quando o contexto é "quem será o primeiro/próximo agendamento?" e o usuário responde, usar IA para extrair o nome e seguir no booking. Roda sempre que a última pergunta pediu o nome (ou state tem pending_attendee_name), mesmo que mode já seja booking — evita "Pode me dar mais detalhes?" quando o cliente já disse o nome.
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
      run: async () => {
        const last =
          nextState.last_prompt ||
          (history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : "") ||
          ""
        const name = await extractAttendeeNameForMultiBooking(text, { lastAssistantMessage: last })
        if (!name) return null
        nextState.mode = "booking"
        nextState.step = undefined
        nextState.pending_attendee_name = false
        nextState.slots = { ...nextState.slots, attendee_name: name, quote_answers: nextState.slots?.quote_answers || {} }
        if (!nextState.slots.customer_name) nextState.slots.customer_name = name
        nextState.pending_additional_booking = true
        nextState.pending_additional_count = Math.max(1, nextState.pending_additional_count ?? 2)
        if (nextState.expected_additional_count == null) nextState.expected_additional_count = nextState.pending_additional_count
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        return buildResult(result.message, result.state, result.action_options)
      },
    },
    {
      when: (c) => c.nextState.step === "qualification_rejected",
      run: async () => {
    const n = normalizeText(text)
    const isShortDecline =
      /^(entendi|ok|t[a??] ok|tudo bem|obrigado|obrigada|valeu|nao|n??o)$/.test(n) ||
      /^(entendi|ok|tudo bem)[,\s]+(obrigad|valeu)/.test(n) ||
      isPoliteDecline(text)
    if (isShortDecline) return handleShortDecline(config, nextState)

    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }

    // Prioridade: regex (Ã¡gil) ou orquestrador (IA como consierge â€" qualquer redaÃ§Ã£o)
    let shouldEnterBooking = hasStrongBookingIntent
    const orchForBooking = await getOrchestrator()
    if (
      !shouldEnterBooking &&
      orchForBooking?.suggested_action === "start_booking" &&
      (orchForBooking.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBooking = true
    }
    if (shouldEnterBooking) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBooking?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBooking.inferred_service
        nextState.just_identified_service = true
      }
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState, history, senderDisplayName)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    const orchestrator = await getOrchestrator()
    if (orchestrator && orchestrator.confidence >= minOrchestratorConfidence) {
      const handled = await handleQualificationRejectedOrchestratorAction(orchestrator, {
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        isFirst: false,
        resolveBooking,
      })
      if (handled) return handled
    }

    if (isPriceQuestion(text)) {
      const cordial = getCordialPrefix(config, false)
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        return buildResult(
          cordial + `O ${svc.name} estÃ¡ R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "SÃ³ queria saber"]
        )
      }
      if (!serviceName && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
          return buildResult(rejectionMessage, nextState)
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildServicesListResult(config, nextState, cordial)
      }
    }

    // Regex ou orquestrador (IA como consierge â€" qualquer estilo)
    let shouldEnterBooking2 = hasStrongBookingIntent
    const orchForBooking2 = await getOrchestrator()
    if (
      !shouldEnterBooking2 &&
      orchForBooking2?.suggested_action === "start_booking" &&
      (orchForBooking2.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBooking2 = true
    }
    if (shouldEnterBooking2) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBooking2?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBooking2.inferred_service
        nextState.just_identified_service = true
      }
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState, history, senderDisplayName)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }

    const match = await classifyServiceMatch(text, config)
    const hasContext = hasMatchContext(match)
    const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, hasContext)
    return buildResult(rejectionMessage, nextState)
      }
    },
    {
      when: (c) => c.nextState.step === "qualification",
      run: async () => {
    // NÃƒO chamar a IA primeiro: priorizar entrada em booking e coleta de slots (nome, contato).
    // A IA sÃ³ Ã© usada como fallback no final do bloco, para perguntas que nÃ£o sÃ£o agendamento.
    const infoAnswer = tryAnswerInformationalQuestion(config, text)
    if (infoAnswer) {
      return buildResult(infoAnswer, nextState)
    }

    // ConfirmaÃ§Ã£o de pÃºblico (esclarecimento homens+infantil): "Sim, nos encaixamos" â†' fluxo mÃºltiplo (antes da triagem para nÃ£o ser capturado pela IA)
    const nQual = normalizeText(text)
    const trimmedQual = nQual.trim()
    const isAudienceConfirmation =
      /^(1\s*[-â€"".)]\s*)?(sim,?\s*nos\s+encaixamos|nos\s+encaixamos)\s*$/i.test(trimmedQual) ||
      /^sim,?\s*nos\s+encaixamos\s*$/i.test(trimmedQual) ||
      trimmedQual === "1" ||
      (trimmedQual.length <= 60 && /\bnos\s+encaixamos\b/i.test(trimmedQual))
    if (isAudienceConfirmation && (config.services || []).length > 0) {
      nextState.mode = "booking"
      nextState.step = undefined
      nextState.pending_additional_booking = true
      nextState.pending_attendee_name = true
      nextState.pending_additional_count = 2
      nextState.expected_additional_count = 2
      return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
    }

    // Triagem: SEMPRE verificar contexto da mensagem antes de mostrar menu
    if (
      !isGreeting(text) &&
      (config.services || []).length > 0 &&
      !nextState.slots.service &&
      (config.lead_policy?.reject_unlisted_services || config.lead_policy?.use_ai_matching)
    ) {
      const match = await classifyServiceMatch(text, config)
      const hasContext = hasMatchContext(match)
      if (match.service) {
        nextState.slots.service = match.service
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const areaMatches = areaMatchesServices(match.inferred_area, config.services || [])
      if (match.reject || (hasContext && !match.service && !areaMatches)) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
      }
    }

    const cordial = getCordialPrefix(config, isFirst)
    const n = normalizeText(text)
    const isShortDecline =
      /^(entendi|ok|t[a??] ok|tudo bem|obrigado|obrigada|valeu|nao|n??o)$/.test(n) ||
      /^(entendi|ok|tudo bem)[,\s]+(obrigad|valeu)/.test(n) ||
      isPoliteDecline(text)
    if (isShortDecline) return handleShortDecline(config, nextState)

    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
        return buildResult(rejectionMessage, nextState)
      }
    }

    // Regex ou orquestrador (IA como consierge â€" qualquer estilo)
    let shouldEnterBookingQ = hasStrongBookingIntent
    const orchForBookingQ = await getOrchestrator()
    if (
      !shouldEnterBookingQ &&
      orchForBookingQ?.suggested_action === "start_booking" &&
      (orchForBookingQ.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBookingQ = true
    }
    if (shouldEnterBookingQ) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBookingQ?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBookingQ.inferred_service
        nextState.just_identified_service = true
      }
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    const orchestrator = await getOrchestrator()
    if (orchestrator && orchestrator.confidence >= minOrchestratorConfidence) {
      const handled = await handleQualificationOrchestratorAction(orchestrator, {
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

    // Ãšltima chance: regex ou orquestrador (IA como consierge â€" qualquer estilo)
    let shouldEnterBookingQ2 = hasStrongBookingIntent
    const orchForBookingQ2 = await getOrchestrator()
    if (
      !shouldEnterBookingQ2 &&
      orchForBookingQ2?.suggested_action === "start_booking" &&
      (orchForBookingQ2.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBookingQ2 = true
    }
    if (shouldEnterBookingQ2) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBookingQ2?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBookingQ2.inferred_service
        nextState.just_identified_service = true
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    if (isListServicesQuestion(text)) {
      return buildServicesListResult(config, nextState, cordial)
    }

    if (isPriceQuestion(text)) {
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        return buildResult(
          cordial + `O ${svc.name} estÃ¡ R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "SÃ³ queria saber"]
        )
      }
      if (serviceName && svc) {
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer && /R\$\s*\d/.test(aiAnswer)) return buildResult(aiAnswer, nextState, ["Quero agendar", "SÃ³ queria saber"])
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
      }
      if (!serviceName && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
          return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildServicesListResult(config, nextState, cordial)
      }
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer && /R\$\s*\d/.test(aiAnswer)) return buildResult(aiAnswer, nextState, ["Quero agendar", "SÃ³ queria saber"])
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }

    // Fallback: IA consierge sÃ³ quando nÃ£o entrou em booking nem em nenhum fluxo acima
    const qualAiAnswer = await answerWithContextualAI(config, text, history)
    if (qualAiAnswer?.trim()) {
      return buildResult(qualAiAnswer, nextState)
    }

    const match = await classifyServiceMatch(text, config)
    if (match.service) {
      nextState.slots.service = match.service
      nextState.just_identified_service = true
      nextState.step = undefined
    } else if (match.reject || config.lead_policy?.reject_unlisted_services) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      if (match.reject) return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
      if (hasContext && (config.services || []).length > 0) {
        return buildResult(rejectionMessage, nextState)
      }
      return buildResult(buildGuidedClarification(config), nextState)
    } else {
      const hasContext = hasMatchContext(match)
      if (hasContext && (config.services || []).length > 0) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, nextState)
      }
      return buildResult(buildGuidedClarification(config), nextState)
    }
  }
    },
    {
      when: () => true,
      run: async () => {
  // Recuperação: se a última pergunta foi "quem será o primeiro/próximo agendamento" (histórico ou last_prompt) e o usuário respondeu com texto plausível (nome ou frase curta), forçar booking e pular o bloco que pede "mais detalhes"
  const lastAssistantInHistory = history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : undefined
  const lastPrompt = nextState.last_prompt || ""
  const lastAssistantText = normalizeText(String(lastAssistantInHistory || "") + " " + String(lastPrompt || ""))
  const askedForAttendeeName =
    /(?:de\s+quem\s+)?sera(o)?\s+o\s+(?:primeiro|proximo)\s+agendamento/i.test(lastAssistantText) ||
    (/\b(?:primeiro|proximo)\b/.test(lastAssistantText) && /\bagendamento\b/.test(lastAssistantText))
  const trimmed = text.trim()
  const isPlausibleAnswer =
    trimmed.length >= 2 &&
    trimmed.length <= 150 &&
    !isExplicitBookingIntent(text) &&
    !isGreeting(text)
  if (askedForAttendeeName && isPlausibleAnswer) {
    nextState.mode = "booking"
    nextState.pending_attendee_name = true
    nextState.pending_additional_booking = true
    nextState.pending_additional_count = Math.max(1, nextState.pending_additional_count ?? 2)
    if (nextState.expected_additional_count === undefined) nextState.expected_additional_count = nextState.pending_additional_count
  }

  // Se Ã© primeira mensagem, SEMPRE verificar contexto primeiro (mesmo que comece com "oi")
  // Isso garante que mensagens como "oi, prenderam meu filho" sejam processadas corretamente

  if (
    !nextState.mode &&
    config.lead_policy?.reject_unlisted_services &&
    (config.services || []).length > 0 &&
    !nextState.slots.service &&
    !isGreeting(text) &&
    !isFirst
  ) {
    const match = await classifyServiceMatch(text, config)
    if (match.service) {
      nextState.slots.service = match.service
      nextState.just_identified_service = true
    } else if (match.reject) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
    } else {
      // Verificar se hÃ¡ contexto suficiente
      const hasContext = hasMatchContext(match)
      if (hasContext) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, { ...nextState, step: "qualification" })
      }
      return buildResult(buildGuidedClarification(config), {
        ...nextState,
        step: "qualification",
      })
    }
  }

  if (!nextState.mode && isGreeting(text)) {
    const greeting = getGreetingMessage(config)
    return buildResult(greeting, { ...nextState, step: "qualification" })
  }

  const modeResult = ensureConversationMode(text, config, nextState)
  if (modeResult) return modeResult

  if (nextState.step === "ask_mode" && !nextState.mode) {
    const detected = detectModeFromText(text)
    if (!detected) {
      return buildResult("Entendi. Voce quer agendar um horario ou pedir um orcamento?", nextState)
    }
    nextState.mode = detected
  }

  // Verificar se o serviÃ§o existe ANTES de entrar no modo booking
  // Isso previne que o bot tente agendar serviÃ§os que nÃ£o existem
  if (nextState.mode === "booking" &&
      !nextState.slots.service &&
      config.lead_policy?.reject_unlisted_services &&
      (config.services || []).length > 0 &&
      !isGreeting(text)) {
    const match = await classifyServiceMatch(text, config)
    if (match.reject || (match.inferred_area && match.inferred_area !== "indefinido" && !match.service)) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected", mode: undefined })
    }
  }

  if (nextState.mode === "booking") {
    return await handleBookingModeMessage({
      text,
      config,
      nextState,
      history,
      senderDisplayName,
      isFirst,
    })
  }

  return resolveQuote(config, text, nextState)
      }
    },
  ]
  return runPipeline(ctx, phases)
}

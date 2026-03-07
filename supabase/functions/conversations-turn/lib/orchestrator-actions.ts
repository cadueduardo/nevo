// @ts-nocheck
/** Handlers de ações do orquestrador (IA): primeira mensagem, qualification, qualification_rejected. */
import { normalizeText } from "./utils.ts"
import { buildResult } from "./state.ts"
import {
  getCordialPrefix,
  getGreetingMessage,
  buildListServicesMessage,
  buildServicePrompt,
  buildBookingConfirmationIntro,
  buildMultiBookingIntro,
  buildPriceNotAvailableMessage,
  buildServicesListWithPrices,
  buildClarificationMessage,
  buildGenericFallback,
  buildServiceOptions,
  generateRejectionMessageWithAI,
} from "./builders.ts"
import {
  findServiceFromText,
  getServiceWithPrice,
  classifyServiceMatch,
} from "./services.ts"
import { isPriceQuestion } from "./detection.ts"
import { hasMatchContext, enterBookingFromIntent } from "./qualification.ts"
import {
  interpretAdditionalBookingsWithAI,
  answerWithContextualAI,
} from "./ai.ts"
import { buildServicesListResult, getSequenceServicesFromText } from "./anytime-handlers.ts"
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
  const { text, config, nextState, history, senderDisplayName, resolveBooking } = context

  const handlers: OrchestratorActionHandlers = {
    no_match_fallback: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      return buildResult(buildGenericFallback(config), nextState)
    },
    answer_price: async () => {
      const cordial = getCordialPrefix(config, false)
      const svc = orchestrator.inferred_service
        ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
        : null
      if (orchestrator.inferred_service && !svc) {
        const rejectionMessage = await generateRejectionMessageWithAI(
          orchestrator.inferred_service,
          config,
          false,
          true
        )
        return buildResult(rejectionMessage, nextState)
      }
      if (svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, {
          has_completed_booking: false,
          history,
        })
        if (
          interpreted?.has_additional ||
          (typeof interpreted?.count === "number" && interpreted.count > 0)
        ) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        return buildResult(
          cordial +
            `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, {
          has_completed_booking: false,
          history,
        })
        if (
          interpreted?.has_additional ||
          (typeof interpreted?.count === "number" && interpreted.count > 0)
        ) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildServicesListResult(config, nextState, getCordialPrefix(config, false))
      }
      return null
    },
    list_services: async () => {
      const listMsg = buildListServicesMessage(config, { intro: "after_generic" })
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(
        listMsg,
        { ...nextState, step: "qualification", last_service_options: serviceOptions },
        serviceOptions
      )
    },
    start_booking: async () =>
      enterBookingFromIntent({
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        resolveBooking,
        orchestrator,
        includeIntro: true,
      }),
    ask_clarification: async () => {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        return buildResult(
          await generateRejectionMessageWithAI(match.inferred_area, config, false, true),
          nextState
        )
      }
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      if (orchestrator.clarification_question)
        return buildResult(orchestrator.clarification_question, nextState)
      return null
    },
  }

  return await runOrchestratorAction(orchestrator, handlers)
}

export async function handleQualificationOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, isFirst, resolveBooking } = context
  const cordial = getCordialPrefix(config, isFirst)

  const handlers: OrchestratorActionHandlers = {
    no_match_fallback: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      return buildResult(buildGenericFallback(config), nextState)
    },
    answer_price: async () => {
      const svc = orchestrator.inferred_service
        ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
        : null
      if (orchestrator.inferred_service && !svc) {
        const rejectionMessage = await generateRejectionMessageWithAI(
          orchestrator.inferred_service,
          config,
          isFirst,
          true
        )
        return buildResult(rejectionMessage, nextState)
      }
      if (!svc && isPriceQuestion(text) && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(
            match.inferred_area,
            config,
            isFirst,
            true
          )
          return buildResult(rejectionMessage, nextState)
        }
      }
      if (svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, {
          has_completed_booking: false,
          history,
        })
        if (
          interpreted?.has_additional ||
          (typeof interpreted?.count === "number" && interpreted.count > 0) ||
          orchestrator?.inferred_attendees === "multiple"
        ) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        return buildResult(
          cordial +
            `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, {
          has_completed_booking: false,
          history,
        })
        if (
          interpreted?.has_additional ||
          (typeof interpreted?.count === "number" && interpreted.count > 0) ||
          orchestrator?.inferred_attendees === "multiple"
        ) {
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
      return null
    },
    list_services: async () => {
      if (isPriceQuestion(text) && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(
            match.inferred_area,
            config,
            isFirst,
            true
          )
          return buildResult(rejectionMessage, nextState)
        }
      }
      const listMsg = buildListServicesMessage(config, { intro: "after_generic" })
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(listMsg, { ...nextState, last_service_options: serviceOptions }, serviceOptions)
    },
    start_booking: async () =>
      enterBookingFromIntent({
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        resolveBooking,
        orchestrator,
        includeIntro: true,
      }),
    ask_clarification: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      if (orchestrator.clarification_question)
        return buildResult(orchestrator.clarification_question, nextState)
      return null
    },
  }

  return await runOrchestratorAction(orchestrator, handlers)
}

export async function handleFirstMessageOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, resolveBooking } = context
  const greeting = getGreetingMessage(config)
  const priceIntro = `Obrigado por entrar em contato${config.business_name ? ` com a ${config.business_name}` : ""}.`

  const handlers: OrchestratorActionHandlers = {
    answer_price: async () => {
      const serviceName =
        orchestrator?.inferred_service ??
        findServiceFromText(text, config.services || []) ??
        (await classifyServiceMatch(text, config)).service
      const svc = serviceName ? getServiceWithPrice(config.services || [], serviceName) : null
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        return buildResult(
          priceIntro +
            " " +
            `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (serviceName && svc) {
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(priceIntro + " " + noPrice.message, nextState, noPrice.action_options)
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.last_service_options = (config.services || []).map((s) => s.name).filter(Boolean)
        return buildServicesListResult(config, nextState, priceIntro)
      }
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(priceIntro + " " + noPrice.message, nextState, noPrice.action_options)
    },
    list_services: async () => {
      const listMsg = buildServicesListWithPrices(config)
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(
        `${greeting}\n\n${listMsg}`,
        { ...nextState, step: "qualification", last_service_options: serviceOptions },
        serviceOptions
      )
    },
    start_booking: async () =>
      enterBookingFromIntent({
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        resolveBooking,
        orchestrator,
        includeIntro: false,
      }),
    service_detail: async () => {
      const serviceName = orchestrator?.inferred_service ?? findServiceFromText(text, config.services || [])
      const svc = serviceName ? getServiceWithPrice(config.services || [], serviceName) : null
      if (svc?.description) {
        return buildResult(
          greeting + " " + `${svc.name}: ${svc.description} Quer agendar?`,
          nextState,
          ["Quero agendar"]
        )
      }
      if (serviceName) {
        return buildResult(
          greeting +
            " " +
            `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`,
          nextState,
          ["Quero agendar"]
        )
      }
      return null
    },
    ask_clarification: async () => {
      const msg = orchestrator?.clarification_question?.trim() || buildClarificationMessage(config)
      return buildResult(msg, { ...nextState, step: "qualification" })
    },
    no_match_fallback: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, { ...nextState, step: "qualification" })
      return buildResult(buildGenericFallback(config), { ...nextState, step: "qualification" })
    },
  }

  return await runOrchestratorAction(orchestrator, handlers)
}



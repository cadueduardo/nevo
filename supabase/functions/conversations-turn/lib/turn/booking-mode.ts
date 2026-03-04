// @ts-nocheck
/** Handler de mensagem em modo booking: preço, lista/detalhe de serviço, resolveBooking. */
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "../types.ts"
import type { SimulatorHandlerContext } from "../turn-context.ts"
import { buildResult } from "../state.ts"
import { getCordialPrefix, getGreetingMessage, buildBookingConfirmationIntro, buildPriceNotAvailableMessage, buildServiceOptions, buildServicePrompt, buildMultiBookingIntro, generateRejectionMessageWithAI } from "../builders.ts"
import { findServiceFromText, getServiceWithPrice, classifyServiceMatch } from "../services.ts"
import { hasMatchContext } from "../qualification.ts"
import { buildServicesListResult } from "../anytime-handlers.ts"
import { isPriceQuestion, isListServicesQuestion, isServiceDetailQuestion, isGreeting } from "../detection.ts"
import { resolveBooking } from "../resolve-booking.ts"

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
        cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
        nextState,
        ["Quero agendar", "Só queria saber"]
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

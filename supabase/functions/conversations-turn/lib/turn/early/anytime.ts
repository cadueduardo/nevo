// @ts-nocheck
/** Early steps: ator externo (agenda), cancelamento, preço/serviços/disponibilidade anytime. */
import type { SimulatorResult } from "../../types.ts"
import type { TurnPipelineContext } from "../../turn-context.ts"
import { buildResult } from "../../state.ts"
import { tryHandleCancellationAnytime } from "../../cancellation.ts"
import { tryHandlePriceQuestionAnytime, tryHandleServicesQuestionAnytime, tryHandleAvailabilityQuestionAnytime } from "../../anytime-handlers.ts"
import { resolveBooking } from "../../resolve-booking.ts"

/** Retorna resultado se algum handler anytime aplicar; senão null. */
export async function runAnytimeSteps(ctx: TurnPipelineContext): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, textNorm, runtime } = ctx

  if (runtime?.isExternalActor) {
    const agendaQueryPattern =
      /\b(quais?\s+s[ãa]o\s+(os\s+)?meus?\s+agendamentos?)\b/i.test(textNorm) ||
      /\b(meus?\s+compromissos?|minha\s+agenda|agenda\s+de\s+hoje|agendamentos?\s+de\s+hoje)\b/i.test(textNorm) ||
      /\b(quero\s+ver\s+(os\s+)?(meus?\s+)?agendamentos?)\b/i.test(textNorm)
    if (agendaQueryPattern) {
      return buildResult(
        "Posso te ajudar a agendar uma visita ou tirar dúvidas sobre nossos serviços. O que você prefere?",
        nextState,
        ["Quero agendar", "Tirar dúvidas"]
      )
    }
  }

  if (runtime) {
    const cancellationResult = await tryHandleCancellationAnytime(
      { ...runtime, resolveBooking },
      text,
      nextState,
      senderDisplayName
    )
    if (cancellationResult) return cancellationResult
  }

  const priceResult = tryHandlePriceQuestionAnytime(config, text, nextState)
  if (priceResult) return priceResult

  const servicesResult = tryHandleServicesQuestionAnytime(config, text, nextState)
  if (servicesResult) return servicesResult

  const availabilityResult = await tryHandleAvailabilityQuestionAnytime(config, text, nextState, history)
  if (availabilityResult) return availabilityResult

  return null
}

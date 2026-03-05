// @ts-nocheck
/** Early step: conversa já finalizada (obrigado, minha marcação, informativo, IA). */
import type { SimulatorResult } from "../../types.ts"
import type { TurnPipelineContext } from "../../turn-context.ts"
import { buildResult } from "../../state.ts"
import { normalizeText } from "../../utils.ts"
import { isFinalizedState, isThanksOrClosingPhrase, getGreetingByTime } from "../../detection.ts"
import { tryAnswerInformationalQuestion, isMyBookingQuestion, getMyBookingAnswer } from "../../informational.ts"
import { answerWithContextualAI } from "../../ai.ts"

/** Retorna resultado se estado finalizado; senão null. */
export async function runFinalizedStep(ctx: TurnPipelineContext): Promise<SimulatorResult | null> {
  const { text, config, nextState, history } = ctx

  // Enquanto houver uma ação pendente de fechamento (ex.: adicionar no calendário),
  // este step não deve interceptar a resposta do cliente.
  if (nextState.pending_calendar_offer || nextState.pending_final_confirmation) return null

  if (!isFinalizedState(nextState)) return null

  const msg = normalizeText(text)
  const isThanks =
    /^(muito\s+)?(obrigad|valeu|agradec)[oas]?\.?$/.test(msg) ||
    /^(obrigad|valeu)[oas]?,\s*(obrigad|valeu)[oas]?\.?$/.test(msg) ||
    isThanksOrClosingPhrase(text)
  if (isThanks) {
    const company = config.business_name ? `A ${config.business_name}` : "A empresa"
    const saudacao = getGreetingByTime()
    nextState.final_thanks_sent = true
    return buildResult(
      `Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`,
      nextState
    )
  }
  if (isMyBookingQuestion(msg)) {
    const myBookingAnswer = getMyBookingAnswer(nextState)
    if (myBookingAnswer) {
      nextState.final_thanks_sent = true
      return buildResult(myBookingAnswer, nextState)
    }
  }
  const infoAnswer = tryAnswerInformationalQuestion(config, text)
  if (infoAnswer) {
    nextState.final_thanks_sent = true
    return buildResult(infoAnswer, nextState)
  }
  const aiAnswer = await answerWithContextualAI(config, text, history, true)
  if (aiAnswer?.trim()) {
    nextState.final_thanks_sent = true
    return buildResult(aiAnswer, nextState)
  }
  nextState.final_thanks_sent = true
  return buildResult("Se precisar de algo no futuro, fico à disposição.", nextState)
}

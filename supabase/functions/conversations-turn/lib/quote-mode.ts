// @ts-nocheck
/** Modo orcamento: coleta variaveis e mensagens de confirmacao. */

import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"
import { buildResult } from "./state.ts"

export function resolveQuote(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState
): SimulatorResult {
  const nextState: SimulatorState = {
    ...state,
    step: "quote",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const variables = config.dynamic_variables?.filter((v) => !v.context || v.context === "quote") || []

  if (variables.length === 0) {
    if (state.step !== "quote_free_text") {
      nextState.step = "quote_free_text"
      return buildResult("Me conta os detalhes do que voce precisa para eu preparar o orcamento.", nextState)
    }
    return buildResult("Obrigado! Vou analisar e te retorno com o orcamento o quanto antes.", nextState)
  }

  if (state.pending_quote_key) {
    nextState.slots.quote_answers = {
      ...(nextState.slots.quote_answers || {}),
      [state.pending_quote_key]: text.trim(),
    }
    nextState.pending_quote_key = undefined
  }

  const nextVar = variables.find((v) => !nextState.slots.quote_answers?.[v.key])
  if (nextVar) {
    nextState.pending_quote_key = nextVar.key
    return buildResult(`${nextVar.label}?`, nextState)
  }

  return buildResult("Perfeito, obrigado! Vou analisar e te retorno com o orcamento.", nextState)
}

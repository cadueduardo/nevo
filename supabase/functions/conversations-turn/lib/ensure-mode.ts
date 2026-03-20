// @ts-nocheck
/** Define modo da conversa (booking/quote) quando ainda não definido. */

import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"
import { buildResult } from "./state.ts"
import { detectModeFromText } from "./detection.ts"
import { resolveConfiguredServicesFromConfig } from "./canonical-services.ts"

export function ensureConversationMode(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult | null {
  if (nextState.mode) return null

  const canSetMode =
    nextState.slots.service ||
    !config.lead_policy?.reject_unlisted_services ||
    resolveConfiguredServicesFromConfig(config).length === 0

  if (!canSetMode) {
    if (!nextState.step) {
      return buildResult("Para eu te ajudar melhor, qual o assunto ou area que voce precisa?", { ...nextState, step: "qualification" })
    }
    return null
  }

  if (config.context_mode && config.context_mode !== "both") {
    nextState.mode = config.context_mode
    return null
  }

  const detected = detectModeFromText(text)
  if (!detected) {
    return buildResult("Voce prefere agendar um horario ou pedir um orcamento?", { ...nextState, step: "ask_mode" })
  }
  nextState.mode = detected
  return null
}

// @ts-nocheck
/** Regras de conversa (early/post) e helpers de primeira mensagem. */
import { buildResult } from "./state.ts"
import {
  shouldBlockByTargetAudience,
  buildTargetAudienceRestrictionMessage,
  needsAudienceClarification,
  buildAudienceClarificationMessage,
} from "./policies.ts"
import { isWhoAreYou, isConfused } from "./detection.ts"
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"

export type RuleInput = {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
}

export type ConversationRule = (input: RuleInput) => SimulatorResult | null

export function applyConversationRules(rules: ConversationRule[], input: RuleInput): SimulatorResult | null {
  for (const rule of rules) {
    const result = rule(input)
    if (result) return result
  }
  return null
}

export function isFirstMessage(state: SimulatorState & { _isFirstMessage?: boolean }): boolean {
  if (state._isFirstMessage === true) return true
  const hasNoHistory = !state.mode && !state.step && !state.slots?.service && !state.last_prompt
  const hasEmptySlots =
    !state.slots ||
    Object.keys(state.slots).length === 0 ||
    (Object.keys(state.slots).length === 1 &&
      state.slots.quote_answers &&
      Object.keys(state.slots.quote_answers).length === 0)
  return Boolean(hasNoHistory && hasEmptySlots)
}

export function buildIdentityAndBookingMessage(config: SimulatorConfig): string {
  const name = config.business_name ? `da ${config.business_name}` : "da empresa"
  return `Oi! Sou a assistente virtual ${name}. Se quiser, já te ajudo a agendar um horário.`
}

export function buildGuidedClarification(config: SimulatorConfig): string {
  const business = config.business_name || "nossa empresa"
  return `Claro! Somos da ${business}. Pode me contar mais detalhes do que você precisa? Se quiser, já te ajudo a agendar um horário.`
}

export const earlyConversationRules: ConversationRule[] = [
  ({ config, text, nextState }) => {
    if (!shouldBlockByTargetAudience(config, text)) return null
    return buildResult(
      buildTargetAudienceRestrictionMessage(config),
      {
        ...nextState,
        slots: { ...nextState.slots, attendee_name: undefined },
        step: "qualification",
      },
      ["Quero agendar"]
    )
  },
  ({ config, text, nextState }) => {
    if (!needsAudienceClarification(config, text)) return null
    return buildResult(
      buildAudienceClarificationMessage(config),
      { ...nextState, step: "qualification" },
      ["Sim, nos encaixamos", "Quero agendar"]
    )
  },
]

export const postServiceResolutionRules: ConversationRule[] = [
  ({ config, text, nextState }) => {
    if (!isWhoAreYou(text)) return null
    return buildResult(buildIdentityAndBookingMessage(config), nextState, ["Quero agendar"])
  },
  ({ text, nextState }) => {
    if (!isConfused(text)) return null
    const fallback = nextState.last_prompt || "Como posso te ajudar hoje?"
    return buildResult(`Tudo bem! Posso repetir: ${fallback}`, nextState)
  },
]

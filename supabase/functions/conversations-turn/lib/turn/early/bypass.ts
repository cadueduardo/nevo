// @ts-nocheck
/** Early steps: "Quero agendar" forçado, regras iniciais, confirmação de público (nos encaixamos). */
import type { SimulatorResult } from "../../types.ts"
import type { TurnPipelineContext } from "../../turn-context.ts"
import { buildResult } from "../../state.ts"
import { normalizeText } from "../../utils.ts"
import { applyConversationRules, earlyConversationRules } from "../../conversation-rules.ts"
import { buildMultiBookingIntro } from "../../builders.ts"
import { resolveBooking } from "../../resolve-booking.ts"

/** Retorna resultado se algum bypass aplicar; senão null. */
export async function runBypassSteps(ctx: TurnPipelineContext): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName } = ctx

  if (ctx.hasForcedBookingAction) {
    nextState.mode = "booking"
    nextState.step = undefined
    return await resolveBooking(config, "quero agendar", nextState, history, senderDisplayName)
  }

  const earlyRuleResult = applyConversationRules(earlyConversationRules, { text, config, nextState })
  if (earlyRuleResult) return earlyRuleResult

  if (nextState.step === "qualification" && (config.services || []).length > 0) {
    const nBypass = normalizeText(text).trim()
    const isAudienceConfirmationBypass =
      /^(1\s*[-–—.)]\s*)?(sim,?\s*nos\s+encaixamos|nos\s+encaixamos)\s*$/i.test(nBypass) ||
      nBypass === "1" ||
      (nBypass.length <= 60 && /\bnos\s+encaixamos\b/i.test(nBypass))
    if (isAudienceConfirmationBypass) {
      nextState.mode = "booking"
      nextState.step = undefined
      nextState.pending_additional_booking = true
      nextState.pending_attendee_name = true
      nextState.pending_additional_count = 2
      nextState.expected_additional_count = 2
      return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
    }
  }

  return null
}

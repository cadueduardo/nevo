// @ts-nocheck
import type { SemanticPolicyOutcome, SemanticTurnContext, TurnSemanticSnapshot } from "./types.ts"
import {
  buildAudienceConfirmationMessage,
  buildAudienceRestrictionMessage,
} from "./renderers/prompt-library.ts"

export function applyAudiencePolicy(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticPolicyOutcome | null {
  if (!snapshot.intents.booking) return null

  const brain = context.business_brain

  if (snapshot.risks.audience?.inferred_fit === false) {
    const restrictionPrompt = buildAudienceRestrictionMessage(brain)
    return {
      should_clarify: true,
      clarification_reason: "target_audience_blocked",
      clarification_prompt: restrictionPrompt,
      adjusted_snapshot: {
        ...snapshot,
        risks: {
          ...snapshot.risks,
          audience: {
            ...(snapshot.risks.audience || {}),
            requires_confirmation: true,
            blocked: true,
            reason: "target_audience_blocked",
            prompt: restrictionPrompt,
            inferred_fit: false,
          },
        },
      },
    }
  }

  if (snapshot.risks.audience?.requires_confirmation) {
    const confirmationPrompt = buildAudienceConfirmationMessage(brain)
    return {
      should_clarify: false,
      adjusted_snapshot: {
        ...snapshot,
        risks: {
          ...snapshot.risks,
          audience: {
            ...(snapshot.risks.audience || {}),
            requires_confirmation: true,
            blocked: false,
            reason: "audience_needs_confirmation",
            prompt: confirmationPrompt,
            inferred_fit: null,
          },
        },
      },
    }
  }

  return null
}

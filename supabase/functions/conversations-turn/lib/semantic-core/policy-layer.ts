// @ts-nocheck
import type {
  SemanticPolicyOutcome,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"
import {
  buildAudienceClarificationMessage,
  buildTargetAudienceRestrictionMessage,
  needsAudienceClarification,
  shouldBlockByTargetAudience,
} from "../policies.ts"

const BOOKING_CONFIDENCE_THRESHOLD = 0.55
const GENERAL_CONFIDENCE_THRESHOLD = 0.4

function shouldClarifyByConfidence(snapshot: TurnSemanticSnapshot): boolean {
  if (snapshot.intents.primary === "booking" || snapshot.intents.primary === "booking_sequence") {
    return snapshot.intents.confidence < BOOKING_CONFIDENCE_THRESHOLD
  }
  return snapshot.intents.confidence < GENERAL_CONFIDENCE_THRESHOLD
}

function buildClarificationPrompt(snapshot: TurnSemanticSnapshot): string {
  if (snapshot.intents.primary === "booking" || snapshot.intents.primary === "booking_sequence") {
    return "Voce quer fazer um agendamento agora ou prefere tirar uma duvida primeiro?"
  }
  return "Quero ter certeza de que entendi. Voce pode me explicar um pouco melhor o que precisa?"
}

export function applySemanticPolicies(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticPolicyOutcome {
  const rawConfig = context.business_brain.raw_config
  const message = snapshot.meta.raw_user_message

  if (snapshot.intents.booking) {
    if (shouldBlockByTargetAudience(rawConfig, message)) {
      return {
        should_clarify: true,
        clarification_reason: "target_audience_blocked",
        clarification_prompt: buildTargetAudienceRestrictionMessage(rawConfig),
        adjusted_snapshot: {
          ...snapshot,
          risks: {
            ...snapshot.risks,
            audience: {
              requires_confirmation: true,
              blocked: true,
              reason: "target_audience_blocked",
              prompt: buildTargetAudienceRestrictionMessage(rawConfig),
              inferred_fit: false,
            },
          },
        },
      }
    }

    if (needsAudienceClarification(rawConfig, message)) {
      return {
        should_clarify: false,
        adjusted_snapshot: {
          ...snapshot,
          risks: {
            ...snapshot.risks,
            audience: {
              requires_confirmation: true,
              blocked: false,
              reason: "audience_needs_confirmation",
              prompt: buildAudienceClarificationMessage(rawConfig),
              inferred_fit: null,
            },
          },
        },
      }
    }
  }

  if (shouldClarifyByConfidence(snapshot)) {
    return {
      should_clarify: true,
      clarification_reason: "low_intent_confidence",
      clarification_prompt: buildClarificationPrompt(snapshot),
      adjusted_snapshot: snapshot,
    }
  }

  return {
    should_clarify: false,
    adjusted_snapshot: snapshot,
  }
}

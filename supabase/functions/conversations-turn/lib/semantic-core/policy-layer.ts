// @ts-nocheck
import type {
  SemanticPolicyOutcome,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"

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
  _context: SemanticTurnContext
): SemanticPolicyOutcome {
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

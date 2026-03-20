// @ts-nocheck
import type {
  SemanticPolicyOutcome,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"
import { applyAudiencePolicy } from "./audience-triage.ts"

const BOOKING_CONFIDENCE_THRESHOLD = 0.55
const GENERAL_CONFIDENCE_THRESHOLD = 0.4

function shouldClarifyByConfidence(snapshot: TurnSemanticSnapshot): boolean {
  const source = snapshot.intents.source || "deterministic_fallback"

  if (source === "continuation" || source === "quote_rule") {
    return snapshot.intents.primary === "fallback" && snapshot.intents.confidence < GENERAL_CONFIDENCE_THRESHOLD
  }

  if (source === "deterministic_fallback") {
    return snapshot.intents.primary === "fallback" && snapshot.intents.confidence < GENERAL_CONFIDENCE_THRESHOLD
  }

  if (snapshot.intents.primary === "booking" || snapshot.intents.primary === "booking_sequence") {
    return snapshot.intents.confidence < BOOKING_CONFIDENCE_THRESHOLD
  }
  return snapshot.intents.confidence < GENERAL_CONFIDENCE_THRESHOLD
}

function buildClarificationPrompt(snapshot: TurnSemanticSnapshot): string {
  if (snapshot.intents.primary === "booking" || snapshot.intents.primary === "booking_sequence") {
    return "Você quer fazer um agendamento agora ou prefere tirar uma dúvida primeiro?"
  }
  return "Quero ter certeza de que entendi. Você pode me explicar um pouco melhor o que precisa?"
}

export function applySemanticPolicies(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticPolicyOutcome {
  // Nunca entrar em "clarificação geral" quando estamos no meio de um fluxo de agendamento
  // já com estado pendente. Isso evita que respostas curtas/ambíguas (ex.: "sim") façam a
  // IA sair do booking e cair num prompt genérico.
  const hasPendingBookingStep = Boolean(
    context.state.pending_audience_confirmation === true ||
      context.state.pending_attendee_name === true ||
      (Array.isArray(context.state.pending_attendee_queue) && context.state.pending_attendee_queue.length > 0) ||
      context.state.pending_contact_field === "contact_preference" ||
      context.state.pending_contact_field === "phone" ||
      context.state.pending_final_confirmation === true ||
      context.state.pending_calendar_offer === true ||
      context.state.pending_template_choice === true ||
      context.state.pending_second_service_choice === true
  )

  const audiencePolicy = applyAudiencePolicy(snapshot, context)
  if (audiencePolicy) {
    return audiencePolicy
  }

  if (!hasPendingBookingStep && shouldClarifyByConfidence(snapshot)) {
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

// @ts-nocheck
import { findServiceFromText } from "../services.ts"
import { normalizeText } from "../utils.ts"
import type { SemanticTurnContext, TurnSemanticSnapshot } from "./types.ts"

const GENERIC_DISCOVERY_PATTERNS = [
  /\b(quais?|que)\s+(servicos?|serviços?)\b/i,
  /\bo que (voces|vocês|voce|você) (fazem|oferecem)\b/i,
  /\bquero ver (os )?(servicos?|serviços?)\b/i,
  /\bme mostra (os )?(servicos?|serviços?)\b/i,
]

const SERVICE_REQUEST_PATTERNS = [
  /\b(quero|preciso|gostaria|procuro)\b/i,
  /\b(tem|faz|fazem|trabalha|trabalham|atende|atendem|oferece|oferecem)\b/i,
  /\b(agendar|marcar|contratar)\b/i,
]

function isGenericServiceDiscovery(message: string): boolean {
  return GENERIC_DISCOVERY_PATTERNS.some((pattern) => pattern.test(message))
}

function looksLikeScopedServiceRequest(message: string): boolean {
  return SERVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(message))
}

export function shouldRedirectOutOfScopeServiceRequest(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): boolean {
  const brain = context.business_brain
  if (!brain.policies.reject_unlisted_services) return false
  if (!Array.isArray(brain.services) || brain.services.length === 0) return false

  const message = String(snapshot.meta.raw_user_message || "").trim()
  if (!message) return false
  if (isGenericServiceDiscovery(message)) return false
  if (!looksLikeScopedServiceRequest(message)) return false

  if (snapshot.intents.primary !== "fallback") return false
  if (snapshot.entities.services?.length) return false

  const normalized = normalizeText(message)
  if (normalized.length < 6) return false

  const matched = findServiceFromText(message, brain.services)
  return !matched
}

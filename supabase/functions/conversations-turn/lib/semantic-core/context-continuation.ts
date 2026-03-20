// @ts-nocheck
import { isPriceQuestion } from "../detection.ts"
import { normalizeText } from "../utils.ts"
import type { SemanticContinuationKind, SemanticTurnContext } from "./types.ts"

export interface SemanticContinuationSignal {
  kind: SemanticContinuationKind
  matched_option?: string
}

function normalizeOption(option?: string): string {
  return normalizeText(option || "").replace(/^\d+\s*-\s*/, "").trim()
}

export function getLastActionOptions(context: Pick<SemanticTurnContext, "state">): string[] {
  return Array.isArray(context.state.last_action_options) ? context.state.last_action_options : []
}

export function matchLastActionOption(
  message: string,
  context: Pick<SemanticTurnContext, "state">
): string | undefined {
  const normalizedMessage = normalizeText(message).trim()
  if (!normalizedMessage) return undefined

  for (const option of getLastActionOptions(context)) {
    const normalizedOption = normalizeOption(option)
    if (!normalizedOption) continue
    if (
      normalizedOption === normalizedMessage ||
      normalizedOption.includes(normalizedMessage) ||
      normalizedMessage.includes(normalizedOption)
    ) {
      return option
    }
  }

  return undefined
}

function isAwaitingAudienceConfirmation(context: Pick<SemanticTurnContext, "state">): boolean {
  if (context.state.pending_audience_confirmation === true) return true
  const lastPrompt = normalizeText(context.state.last_prompt || "")
  return (
    getLastActionOptions(context).some((option) => normalizeOption(option).includes("nos encaixamos")) ||
    lastPrompt.includes("voces se encaixam nesse perfil") ||
    lastPrompt.includes("voce se encaixa nesse perfil") ||
    lastPrompt.includes("se encaixa") ||
    lastPrompt.includes("nesse perfil")
  )
}

/** Respostas curtas afirmativas: aceita "sim", "ok", "claro", "pode ser", etc. para não repetir a pergunta. */
function isAudienceConfirmationMessage(message: string): boolean {
  const normalized = normalizeText(message).trim()
  if (!normalized || normalized.length > 80) return false
  return (
    /^(sim|ok|beleza|claro|isso|isso mesmo|pode ser|com certeza|quero|positivo|e isso|eh isso)$/.test(normalized) ||
    /^(yes|okay)$/.test(normalized) ||
    normalized.includes("nos encaixamos") ||
    normalized.includes("me encaixo") ||
    normalized.includes("quero agendar") ||
    normalized === "1"
  )
}

function isAwaitingPriceFollowup(context: Pick<SemanticTurnContext, "state">): boolean {
  const lastPrompt = normalizeText(context.state.last_prompt || "")
  const lastOptions = getLastActionOptions(context)
  if (lastOptions.length === 0) return false
  return (
    lastPrompt.includes("qual servico voce quer consultar") ||
    lastPrompt.includes("posso te informar os valores certinhos")
  )
}

function isAwaitingCalendarResponse(context: Pick<SemanticTurnContext, "state">): boolean {
  if (context.state.pending_calendar_offer === true) return true
  return getLastActionOptions(context).some((option) => normalizeOption(option).includes("adicionar no calendario"))
}

function isCalendarAcceptance(message: string): boolean {
  const normalized = normalizeText(message).trim()
  return normalized === "1" || /\b(adicionar|pode adicionar|sim|quero|manda|coloca)\b/.test(normalized)
}

function isCalendarDecline(message: string): boolean {
  const normalized = normalizeText(message).trim()
  return normalized === "2" || /\b(nao|nao obrigado|dispensa|deixa|sem calendario)\b/.test(normalized)
}

function isAwaitingContactPreference(context: Pick<SemanticTurnContext, "state">): boolean {
  return context.state.pending_contact_field === "contact_preference"
}

export function detectSemanticContinuation(
  message: string,
  context: Pick<SemanticTurnContext, "state">
): SemanticContinuationSignal | null {
  const matchedOption = matchLastActionOption(message, context)

  if (isAwaitingAudienceConfirmation(context) && isAudienceConfirmationMessage(message)) {
    return {
      kind: "audience_confirmation",
      matched_option: matchedOption,
    }
  }

  if (
    isAwaitingPriceFollowup(context) &&
    !isPriceQuestion(message) &&
    matchedOption
  ) {
    return {
      kind: "price_followup",
      matched_option: matchedOption,
    }
  }

  if (isAwaitingCalendarResponse(context) && (isCalendarAcceptance(message) || isCalendarDecline(message))) {
    return {
      kind: "calendar_response",
      matched_option: matchedOption,
    }
  }

  if (isAwaitingContactPreference(context) && matchedOption) {
    return {
      kind: "contact_preference",
      matched_option: matchedOption,
    }
  }

  return null
}

// @ts-nocheck
import { getMyBookingAnswer, isAddressQuestion, isScheduleQuestion, tryAnswerInformationalQuestion } from "../informational.ts"
import { resolveConfiguredServicesFromConfig } from "../canonical-services.ts"
import { calculateRange } from "../quote-engine.ts"
import { findServiceFromText } from "../services.ts"
import type { SemanticQuoteEstimate, SemanticTurnContext, TurnSemanticSnapshot } from "./types.ts"

export interface SemanticInformationalContext {
  answer?: string
  service_names: string[]
  business_name?: string
  selected_service_name?: string
  selected_service_description?: string
  selected_service_price?: number
  quote?: SemanticQuoteEstimate
}

function getRawConfiguredServices(context: SemanticTurnContext) {
  return resolveConfiguredServicesFromConfig(context.business_brain.raw_config || {})
}

function getSelectedService(snapshot: TurnSemanticSnapshot, context: SemanticTurnContext) {
  const selectedName =
    snapshot.entities.services?.[0]?.name ||
    snapshot.meta.continuation?.matched_option ||
    context.state.slots?.service ||
    snapshot.meta.raw_user_message ||
    undefined
  if (!selectedName) return null
  const normalized = String(selectedName).trim().toLowerCase()
  const exact = (
    context.business_brain.services.find((service) => service.normalized_name === normalized) ||
    context.business_brain.services.find((service) => service.name === selectedName) ||
    null
  )
  if (exact) return exact

  const fuzzy = findServiceFromText(selectedName, context.business_brain.services)
  if (!fuzzy) return null
  return context.business_brain.services.find((service) => service.name === fuzzy) || null
}

function getSelectedServicePrice(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext,
  selectedServiceName?: string
) {
  if (!selectedServiceName) return undefined
  const rawServices = getRawConfiguredServices(context)
  const exact =
    rawServices.find((service) => service.name.trim().toLowerCase() === selectedServiceName.trim().toLowerCase()) ||
    null
  if (typeof exact?.base_price === "number" && !Number.isNaN(exact.base_price)) return exact.base_price

  const rawMatchName = findServiceFromText(selectedServiceName, rawServices as any)
  if (!rawMatchName) return undefined
  const rawMatch = rawServices.find((service) => service.name === rawMatchName) || null
  return typeof rawMatch?.base_price === "number" && !Number.isNaN(rawMatch.base_price)
    ? rawMatch.base_price
    : undefined
}

function deriveQuoteEstimate(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticQuoteEstimate | undefined {
  const quoteServiceCandidate = snapshot.entities.quote_service
  if (!quoteServiceCandidate) return undefined

  const quoteServices = Array.isArray(context.business_brain.raw_config.quote_services)
    ? context.business_brain.raw_config.quote_services
    : []
  const service = quoteServices.find((item) => item.id === quoteServiceCandidate.id) ||
    quoteServices.find((item) => item.name === quoteServiceCandidate.name)
  if (!service) return undefined

  const slots = snapshot.signals.quote_slots || {}
  const requiredKeys =
    quoteServiceCandidate.required_keys?.length > 0
      ? quoteServiceCandidate.required_keys
      : ["largura_cm", "altura_cm"]
  const missingKeys = requiredKeys.filter((key) => slots[key] == null || slots[key] === "")
  const estimate: SemanticQuoteEstimate = {
    service,
    slots,
    required_keys: requiredKeys,
    missing_keys: missingKeys,
  }
  if (missingKeys.length === 0) {
    const range = calculateRange(service as any, slots as any)
    estimate.range = {
      min: range.min,
      max: range.max,
      currency: range.currency,
    }
  }
  return estimate
}

export function deriveInformationalContext(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticInformationalContext {
  const message = snapshot.meta.raw_user_message || ""
  const selectedService = getSelectedService(snapshot, context)
  const informationalAnswer = tryAnswerInformationalQuestion(context.business_brain.raw_config, message)
  const answer =
    (isAddressQuestion(message) ? informationalAnswer : null) ||
    getMyBookingAnswer(context.state) ||
    informationalAnswer ||
    undefined
  const selectedServicePrice =
    selectedService?.base_price ?? getSelectedServicePrice(snapshot, context, selectedService?.name)

  return {
    answer,
    service_names: context.business_brain.services.map((service) => service.name),
    business_name: context.business_brain.business_name,
    selected_service_name: selectedService?.name,
    selected_service_description: selectedService?.description,
    selected_service_price: selectedServicePrice,
    quote: deriveQuoteEstimate(snapshot, context),
  }
}

export function isFaqLikeMessage(snapshot: TurnSemanticSnapshot): boolean {
  const message = snapshot.meta.raw_user_message || ""
  return isAddressQuestion(message) || isScheduleQuestion(message)
}

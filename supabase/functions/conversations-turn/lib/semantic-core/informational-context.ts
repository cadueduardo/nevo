// @ts-nocheck
import { getMyBookingAnswer, isAddressQuestion, isScheduleQuestion, tryAnswerInformationalQuestion } from "../informational.ts"
import type { SemanticTurnContext, TurnSemanticSnapshot } from "./types.ts"

export interface SemanticInformationalContext {
  answer?: string
  service_names: string[]
  business_name?: string
  selected_service_name?: string
  selected_service_description?: string
  selected_service_price?: number
}

function getSelectedService(snapshot: TurnSemanticSnapshot, context: SemanticTurnContext) {
  const selectedName =
    snapshot.entities.services?.[0]?.name ||
    context.state.slots?.service ||
    undefined
  if (!selectedName) return null
  const normalized = String(selectedName).trim().toLowerCase()
  return (
    context.business_brain.services.find((service) => service.normalized_name === normalized) ||
    context.business_brain.services.find((service) => service.name === selectedName) ||
    null
  )
}

export function deriveInformationalContext(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticInformationalContext {
  const message = snapshot.meta.raw_user_message || ""
  const selectedService = getSelectedService(snapshot, context)
  const answer =
    getMyBookingAnswer(context.state) ||
    tryAnswerInformationalQuestion(context.business_brain.raw_config, message) ||
    undefined

  return {
    answer,
    service_names: context.business_brain.services.map((service) => service.name),
    business_name: context.business_brain.business_name,
    selected_service_name: selectedService?.name,
    selected_service_description: selectedService?.description,
    selected_service_price: selectedService?.base_price,
  }
}

export function isFaqLikeMessage(snapshot: TurnSemanticSnapshot): boolean {
  const message = snapshot.meta.raw_user_message || ""
  return isAddressQuestion(message) || isScheduleQuestion(message)
}

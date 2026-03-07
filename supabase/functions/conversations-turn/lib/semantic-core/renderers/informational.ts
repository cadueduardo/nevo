// @ts-nocheck
import type { SemanticRuntimeResult } from "../runtime.ts"
import {
  buildFallbackClarificationMessage,
  buildFaqFallbackMessage,
  buildIdentityMessage,
  buildServicePriceMessage,
  buildServiceDetailMessage,
  buildServiceListMessage,
} from "./prompt-library.ts"
import type { RenderedSemanticMessage } from "./shared.ts"
import { deriveInformationalContext } from "../informational-context.ts"

export function renderInformational(semantic: SemanticRuntimeResult): RenderedSemanticMessage {
  const info = deriveInformationalContext(semantic.snapshot, semantic.context)
  const decision = semantic.decision
  const services = info.service_names
  const businessName = info.business_name

  switch (decision.action) {
    case "ask_clarification":
      return {
        message: decision.next_question || buildFallbackClarificationMessage(),
        action_options: ["Quero agendar", "Quero tirar uma duvida"],
      }
    case "reply_faq":
      return {
        message: info.answer || buildFaqFallbackMessage(businessName),
        action_options: ["Quero agendar"],
      }
    case "reply_identity":
      return {
        message: buildIdentityMessage(businessName),
        action_options: ["Quero agendar"],
      }
    case "reply_price":
      return {
        message: buildServicePriceMessage(info.selected_service_name, info.selected_service_price),
        action_options: services,
      }
    case "reply_service_detail":
      return {
        message: buildServiceDetailMessage(info.selected_service_name, info.selected_service_description),
        action_options: ["Quero agendar"],
      }
    case "reply_service_list":
      return {
        message: buildServiceListMessage(businessName),
        action_options: services,
      }
    default:
      return {
        message: buildFallbackClarificationMessage(),
        action_options: ["Quero agendar"],
      }
  }
}

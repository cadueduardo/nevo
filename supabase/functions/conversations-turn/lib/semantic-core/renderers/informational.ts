// @ts-nocheck
import type { SemanticRuntimeResult } from "../runtime.ts"
import {
  buildFallbackClarificationMessage,
  buildIdentityMessage,
  buildPriceGuidanceMessage,
  buildServiceDetailMessage,
  buildServiceListMessage,
} from "./prompt-library.ts"
import type { RenderedSemanticMessage } from "./shared.ts"

export function renderInformational(semantic: SemanticRuntimeResult): RenderedSemanticMessage {
  const brain = semantic.business_brain
  const decision = semantic.decision
  const services = brain.services.map((service) => service.name)
  const businessName = brain.business_name

  switch (decision.action) {
    case "reply_identity":
      return {
        message: buildIdentityMessage(businessName),
        action_options: ["Quero agendar"],
      }
    case "reply_price":
      return {
        message: buildPriceGuidanceMessage(),
        action_options: services,
      }
    case "reply_service_detail":
      return {
        message: buildServiceDetailMessage(),
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

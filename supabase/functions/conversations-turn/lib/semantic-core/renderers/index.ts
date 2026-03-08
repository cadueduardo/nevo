// @ts-nocheck
import type { SimulatorResult, SimulatorState } from "../../types.ts"
import { logSemanticRender } from "../logging.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"
import { renderBooking } from "./booking.ts"
import { renderGreeting } from "./greeting.ts"
import { renderInformational } from "./informational.ts"
import { buildFallbackClarificationMessage } from "./prompt-library.ts"
import { buildSemanticResult, type RenderedSemanticMessage } from "./shared.ts"

export async function renderSemanticSimulatorResult(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult
): Promise<SimulatorResult> {
  let rendered: RenderedSemanticMessage

  switch (semantic.decision.action) {
    case "ask_clarification":
      rendered = renderInformational(semantic)
      break
    case "reply_greeting":
      rendered = await renderGreeting(semantic)
      break
    case "reply_identity":
    case "reply_price":
    case "reply_service_detail":
    case "reply_service_list":
      rendered = renderInformational(semantic)
      break
    case "ask_audience_confirmation":
    case "ask_attendee_name":
    case "ask_service":
    case "offer_sequence_template":
    case "ask_date":
    case "ask_time":
    case "ask_contact":
    case "confirm_booking":
    case "offer_calendar":
      rendered = renderBooking(semantic)
      break
    default:
      rendered = {
        message: buildFallbackClarificationMessage(),
        action_options: ["Quero agendar"],
      }
  }

  const result = buildSemanticResult(baseState, semantic, rendered)
  logSemanticRender(semantic.context, {
    message: rendered.message,
    action_options: rendered.action_options,
    fallback_reason: semantic.decision.action === "handoff_fallback" ? semantic.decision.reason : undefined,
  })
  return result
}

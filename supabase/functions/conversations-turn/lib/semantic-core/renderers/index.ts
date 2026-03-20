// @ts-nocheck
import type { SimulatorResult, SimulatorState } from "../../types.ts"
import { logSemanticRender } from "../logging.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"
import { renderBooking } from "./booking.ts"
import { renderGreeting } from "./greeting.ts"
import { renderInformational } from "./informational.ts"
import { buildSemanticResult, type RenderedSemanticMessage } from "./shared.ts"

export async function renderSemanticSimulatorResult(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult
): Promise<SimulatorResult> {
  let rendered: RenderedSemanticMessage

  switch (semantic.decision.action) {
    case "ask_clarification":
      rendered = await renderInformational(semantic)
      break
    case "reply_greeting":
      rendered = await renderGreeting(semantic)
      break
    case "reply_identity":
    case "reply_faq":
    case "reply_closing":
    case "reply_calendar_confirmed":
    case "reply_calendar_declined":
    case "reply_price":
    case "ask_quote_measurements":
    case "reply_quote_estimate":
    case "reply_service_detail":
    case "reply_service_list":
      rendered = await renderInformational(semantic)
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
      rendered = await renderBooking(semantic)
      break
    default:
      rendered = await renderInformational(semantic)
  }

  const result = buildSemanticResult(baseState, semantic, rendered)
  logSemanticRender(semantic.context, {
    message: rendered.message,
    action_options: rendered.action_options,
    fallback_reason: semantic.decision.action === "handoff_fallback" ? semantic.decision.reason : undefined,
  })
  return result
}



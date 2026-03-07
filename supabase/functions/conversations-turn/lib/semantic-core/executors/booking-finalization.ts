// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { buildCompletedBookingDraft, buildPostConfirmationPlan } from "../booking-lifecycle.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingFinalization(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const completedBooking = buildCompletedBookingDraft(snapshot, decision, context)
  const postConfirmationPlan = buildPostConfirmationPlan(context, snapshot)
  return buildExecutorResult({
    executor: "booking-finalization",
    decision,
    slot_updates: decision.slot_updates,
    state_patch: {
      pending_final_confirmation: true,
      last_confirm_options: ["Confirmar agendamento"],
    },
    metadata: {
      attendee_name: completedBooking.attendee_name || null,
      service_names: completedBooking.service_names,
      date: completedBooking.date || null,
      time: completedBooking.time || null,
      completed_booking: completedBooking,
      post_confirmation_plan: postConfirmationPlan,
    },
  })
}

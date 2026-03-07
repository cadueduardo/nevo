// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult, TurnSemanticSnapshot } from "../types.ts"

export function executeBookingFinalization(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot
): SemanticExecutorResult {
  return {
    executor: "booking-finalization",
    slot_updates: decision.slot_updates,
    state_patch: {
      pending_final_confirmation: true,
      last_confirm_options: ["Confirmar agendamento"],
      last_prompt: decision.next_question || "confirm_booking_summary",
    },
    prompt_key: decision.next_question || "confirm_booking_summary",
    metadata: {
      attendee_name: decision.slot_updates?.attendee_name || snapshot.attendee_names?.[0] || null,
      service_names: snapshot.service_candidates.map((service) => service.name),
      date: decision.slot_updates?.date || snapshot.date_candidate?.iso_date || null,
      time: decision.slot_updates?.time || snapshot.time_candidate?.hhmm || null,
    },
  }
}

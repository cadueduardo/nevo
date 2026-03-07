// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult, TurnSemanticSnapshot } from "../types.ts"
import { buildExecutorResult } from "./shared.ts"

export function executeBookingFinalization(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot
): SemanticExecutorResult {
  return buildExecutorResult({
    executor: "booking-finalization",
    decision,
    slot_updates: decision.slot_updates,
    state_patch: {
      pending_final_confirmation: true,
      last_confirm_options: ["Confirmar agendamento"],
    },
    metadata: {
      attendee_name: decision.slot_updates?.attendee_name || snapshot.attendee_names?.[0] || null,
      service_names: snapshot.service_candidates.map((service) => service.name),
      date: decision.slot_updates?.date || snapshot.date_candidate?.iso_date || null,
      time: decision.slot_updates?.time || snapshot.time_candidate?.hhmm || null,
    },
  })
}

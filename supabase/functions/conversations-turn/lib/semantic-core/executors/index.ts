// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { executeBookingAttendee } from "./booking-attendee.ts"
import { executeBookingContact } from "./booking-contact.ts"
import { executeBookingDate } from "./booking-date.ts"
import { executeBookingFinalization } from "./booking-finalization.ts"
import { executeBookingSequence } from "./booking-sequence.ts"
import { executeBookingService } from "./booking-service.ts"
import { executeBookingTime } from "./booking-time.ts"

export function executeSemanticDecision(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult | null {
  switch (decision.action) {
    case "ask_attendee_name":
      return executeBookingAttendee(decision, snapshot, context)
    case "ask_service":
      return executeBookingService(decision, snapshot, context)
    case "ask_date":
      return executeBookingDate(decision, snapshot)
    case "ask_time":
      return executeBookingTime(decision, snapshot)
    case "ask_contact":
      return executeBookingContact(decision, snapshot, context)
    case "offer_sequence_template":
      return executeBookingSequence(decision, snapshot, context)
    case "confirm_booking":
      return executeBookingFinalization(decision, snapshot)
    default:
      return null
  }
}

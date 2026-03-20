// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { buildSemanticClarificationDecision } from "../runtime-helpers.ts"
import { buildBookingDecisionFromSuggestedAction, decideBooking } from "./booking.ts"
import { decideFallback } from "./fallback.ts"
import { decideGreeting } from "./greeting.ts"
import { decideInformational } from "./informational.ts"

function coerceSnapshotToBookingContinuation(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): TurnSemanticSnapshot {
  const isAdditional = Boolean(
    context.state.pending_additional_booking ||
      (Array.isArray(context.state.completed_bookings) && context.state.completed_bookings.length > 0) ||
      (Array.isArray(context.state.pending_attendee_queue) && context.state.pending_attendee_queue.length > 0)
  )
  return {
    ...snapshot,
    intents: {
      ...snapshot.intents,
      primary: isAdditional ? "booking_sequence" : "booking",
      booking: true,
      source: "continuation",
      confidence: Math.max(snapshot.intents.confidence || 0, 0.82),
    },
  }
}

/** A sugestão da IA só vale se corresponder ao passo que realmente falta (slots saneados). */
function isAiBookingActionAllowedForMissingStep(
  action: string,
  missing: ReturnType<typeof deriveBookingContext>["missing_step"]
): boolean {
  const a = String(action || "").trim()
  switch (missing) {
    case "audience":
      return a === "ask_audience_confirmation"
    case "attendee":
      return a === "ask_attendee_name"
    case "service":
      return a === "ask_service" || a === "offer_sequence_template"
    case "date":
      return a === "ask_date"
    case "time":
      return a === "ask_time"
    case "contact":
      return a === "ask_contact"
    case "confirm":
      return a === "confirm_booking" || a === "offer_calendar"
    default:
      return false
  }
}

export function decideNextSemanticAction(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult {
  const hasPendingBookingContinuation = Boolean(
    context.state.pending_audience_confirmation === true ||
      context.state.pending_contact_field === "contact_preference" ||
      context.state.pending_contact_field === "phone" ||
      context.state.pending_final_confirmation === true ||
      context.state.pending_template_choice === true ||
      context.state.pending_second_service_choice === true ||
      (Array.isArray(context.state.last_time_options) && context.state.last_time_options.length > 0)
  )
  const normalizedSnapshot =
    snapshot.intents.primary === "fallback" && hasPendingBookingContinuation
      ? coerceSnapshotToBookingContinuation(snapshot, context)
      : snapshot
  if (normalizedSnapshot.risks.audience?.blocked) {
    return buildSemanticClarificationDecision({
      confidence: normalizedSnapshot.intents.confidence,
      reason: normalizedSnapshot.risks.audience.reason || "target_audience_blocked",
      next_question: normalizedSnapshot.risks.audience.prompt,
    })
  }

  if (normalizedSnapshot.intents.primary === "greeting") {
    return decideGreeting(normalizedSnapshot, context)
  }

  const informational = decideInformational(normalizedSnapshot, context)
  if (informational) return informational

  // Booking: a IA é o atendente — decide o que preencher e o que perguntar (sem ordem fixa).
  // Quando a IA retorna uma ação (suggested_booking_action), usamos ela. Só usamos o fluxo
  // determinístico por missing_step quando a IA não está disponível (ex.: sem OPENAI_API_KEY).
  if (normalizedSnapshot.intents.primary === "booking" || normalizedSnapshot.intents.primary === "booking_sequence") {
    // Guard: algumas etapas são “estado pendente” e precisam ser tratadas determinísticamente.
    // Ex.: pending_calendar_offer=true: quando o cliente responde "sim" para o calendário,
    // a IA não pode sobrescrever e pedir contato novamente.
    if (
      // Nunca deixar a IA pular confirmação de público (senão "sim" vira outra continuação
      // e audience_confirmed nunca é setado).
      normalizedSnapshot.risks.audience?.requires_confirmation === true ||
      context.state.pending_secondary_contact ||
      (context.state.pending_calendar_offer === true && !context.state.pending_secondary_contact) ||
      context.state.pending_contact_field === "phone"
    ) {
      const booking = decideBooking(normalizedSnapshot, context)
      if (booking) return booking
    }

    const suggested = normalizedSnapshot.meta.suggested_booking_action
    if (suggested) {
      const bookingCtx = deriveBookingContext(normalizedSnapshot, context)
      if (isAiBookingActionAllowedForMissingStep(suggested, bookingCtx.missing_step)) {
        const aiDecision = buildBookingDecisionFromSuggestedAction(normalizedSnapshot, context, suggested)
        if (aiDecision) return aiDecision
      }
    }
    const booking = decideBooking(normalizedSnapshot, context)
    if (booking) return booking
  }

  if (context.state.pending_contact_field === "contact_preference") {
    const booking = deriveBookingContext(normalizedSnapshot, context)
    if (!booking.has_contact) {
      return decideBooking(normalizedSnapshot, context)
    }
  }

  if (Array.isArray(context.state.last_time_options) && context.state.last_time_options.length > 0 && !normalizedSnapshot.entities.time?.hhmm) {
    const booking = deriveBookingContext(normalizedSnapshot, context)
    if (booking.has_date && !booking.has_time) {
      return decideBooking(normalizedSnapshot, context)
    }
  }

  return decideFallback(normalizedSnapshot, context)
}

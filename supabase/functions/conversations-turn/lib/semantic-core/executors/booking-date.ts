// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import { getSemanticDayOptions } from "../availability-planner.ts"
import { getTodayIsoBusinessTz } from "../../utils.ts"
import { buildExecutorResult, buildBookingQueueState } from "./shared.ts"

function looksLikePhoneOnly(value?: string): boolean {
  const d = String(value || "").replace(/\D/g, "")
  return d.length >= 10 && d.length <= 13
}

/** Rejeita datas no passado ou vindas de raw_text que é telefone (evita alucinação 2023). */
function resolveDateForBooking(
  snapshot: TurnSemanticSnapshot,
  decision: SemanticDecisionResult,
  context: SemanticTurnContext
): string | undefined {
  const raw = snapshot.entities.date?.raw_text
  const fromSnapshot = snapshot.entities.date?.iso_date
  const fromDecision = decision.slot_updates?.date
  const fromState = context.state.slots?.date
  const today = getTodayIsoBusinessTz()

  const rejectPast = (v: string | undefined): boolean => {
    if (!v || v === "hoje" || v === "amanha") return false
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v < today) return true
    return false
  }

  if (looksLikePhoneOnly(raw)) {
    const fallback = fromDecision || fromState
    return fallback && !rejectPast(fallback) ? fallback : undefined
  }
  const candidate = fromSnapshot || fromDecision || fromState
  if (!candidate) return undefined
  if (candidate === "hoje" || candidate === "amanha") return candidate
  if (rejectPast(candidate)) return undefined
  return candidate
}

export function executeBookingDate(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const isoDate = resolveDateForBooking(snapshot, decision, context)
  const queueState = buildBookingQueueState(decision, snapshot, context)
  const dayOptions = getSemanticDayOptions(
    context.business_brain,
    context.state.slots?.staff_name
  )
  return buildExecutorResult({
    executor: "booking-date",
    decision,
    slot_updates: {
      ...(decision.slot_updates || {}),
      ...(queueState.attendee_name ? { attendee_name: queueState.attendee_name } : {}),
      ...(isoDate ? { date: isoDate } : {}),
    },
    state_patch: {
      ...(snapshot.signals.contact_preference || decision.slot_updates?.customer_phone || decision.slot_updates?.customer_email
        ? {
            pending_contact_field: undefined,
            contact_preference: snapshot.signals.contact_preference || context.state.contact_preference,
          }
        : {}),
      pending_date_confirmation: isoDate || undefined,
      pending_attendee_queue: queueState.remaining_queue,
    },
    action_options: dayOptions,
    metadata: {
      attendee_name: queueState.attendee_name || null,
      iso_date: isoDate || null,
      raw_text: snapshot.entities.date?.raw_text || null,
      day_options: dayOptions,
    },
  })
}

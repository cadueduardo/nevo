// @ts-nocheck
/**
 * Entrada do fluxo de agendamento (chamado pelo turn-handler quando mode === "booking").
 * Monta o BookingContext e delega em ordem para BOOKING_HANDLERS em lib/booking/index.ts
 * (confirmação → ai-slots → service → staff-and-date → contact → time-and-availability → finalization).
 */
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"
import { buildStaffDayOptions } from "./staff.ts"
import { normalizeText, hasExplicitDate } from "./utils.ts"
import {
  interpretAdditionalBookingsWithAI,
  interpretSlotsFromMessageWithAI,
} from "./ai.ts"
import { findServiceFromText } from "./services.ts"
import type { BookingContext } from "./booking/context.ts"
import { BOOKING_HANDLERS } from "./booking/index.ts"

export async function resolveBooking(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string
): Promise<SimulatorResult> {
  const toNumberedOptions = (options: string[]): string[] =>
    options.map((option, idx) => `${idx + 1} - ${option}`)
  const getOtherDayOptions = (schedule?: { days_of_week?: string[] } | null): string[] => {
    const dayOptions = buildStaffDayOptions(schedule?.days_of_week || [])
    return dayOptions.length > 0 ? dayOptions : ["Outro dia"]
  }

  const nextState: SimulatorState = {
    ...state,
    step: "booking",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
    completed_bookings: state.completed_bookings ? [...state.completed_bookings] : [],
  }

  const pref = nextState.contact_preference ?? state.contact_preference ?? "both"
  const hasPhone = Boolean(nextState.slots.customer_phone)
  const hasEmail = Boolean(nextState.slots.customer_email)
  const primaryContactFromCompleted = (nextState.completed_bookings || []).some(
    (b) => Boolean((b as any).customer_phone || (b as any).customer_email)
  )
  const contactOk =
    pref === "phone"
      ? hasPhone
      : pref === "email"
        ? hasEmail
        : pref === "skip_primary"
          ? primaryContactFromCompleted
          : hasPhone && hasEmail
  const bookingComplete =
    Boolean(nextState.slots.service) &&
    Boolean(nextState.slots.date) &&
    Boolean(nextState.slots.time) &&
    Boolean(nextState.slots.customer_name) &&
    contactOk

  const cp = state.contact_preference ?? "both"
  const hasCompletedBooking =
    Boolean(state.slots?.service) &&
    Boolean(state.slots?.date) &&
    Boolean(state.slots?.time) &&
    Boolean(state.slots?.customer_name) &&
    (cp === "phone"
      ? Boolean(state.slots?.customer_phone)
      : cp === "email"
        ? Boolean(state.slots?.customer_email)
        : Boolean(state.slots?.customer_phone) && Boolean(state.slots?.customer_email))

  const interpretedAdditional = await interpretAdditionalBookingsWithAI(text, {
    has_completed_booking: hasCompletedBooking,
    history,
  })
  const interpretedCountRaw =
    typeof interpretedAdditional?.count === "number" ? interpretedAdditional.count : null
  const interpretedCount = interpretedCountRaw !== null ? Math.max(0, interpretedCountRaw) : null
  const interpretedHasAdditional =
    interpretedAdditional?.has_additional === true ||
    (interpretedCount !== null && interpretedCount > 0)

  const lastAssistantMsg =
    state.last_prompt ||
    (history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : undefined)
  const hasPendingServiceChoice =
    Array.isArray(state.last_service_options) &&
    state.last_service_options.length > 0 &&
    !state.pending_template_choice &&
    !state.pending_second_service_choice &&
    !nextState.pending_attendee_name

  const waitingFor = nextState.pending_attendee_name
    ? "attendee_name"
    : hasPendingServiceChoice
      ? "service"
    : !nextState.slots.service
      ? "service"
      : !nextState.slots.date
        ? "date"
        : !nextState.slots.time
          ? "time"
          : undefined

  const slotsInterpretation =
    waitingFor || nextState.pending_attendee_name
      ? await interpretSlotsFromMessageWithAI(
          text,
          {
            waiting_for: waitingFor,
            current_slots: nextState.slots,
            services: config.services || [],
            history,
            last_assistant_message: lastAssistantMsg,
            sender_display_name: senderDisplayName,
          },
          config
        )
      : null

  const normalizedText = normalizeText(text)
  const allowAiDateAutofill =
    hasExplicitDate(text) ||
    normalizedText.includes("hoje") ||
    normalizedText.includes("amanha")
  const isDigitOnly = /^[1-9]\d*$/.test(text.trim())
  const explicitService = findServiceFromText(text, config.services || []) ?? null
  const wasAdditionalPending = Boolean(
    state.pending_additional_booking || state.pending_additional_count
  )

  const ctx: BookingContext = {
    config,
    text,
    state,
    nextState,
    history,
    senderDisplayName,
    toNumberedOptions,
    getOtherDayOptions,
    contactOk,
    bookingComplete,
    slotsInterpretation: slotsInterpretation ?? undefined,
    interpretedAdditional: interpretedAdditional ?? undefined,
    interpretedCount,
    interpretedHasAdditional,
    lastAssistantMsg,
    waitingFor,
    normalizedText,
    allowAiDateAutofill,
    isDigitOnly,
    explicitService,
    wasAdditionalPending,
    hasCompletedBooking,
  }

  for (const handler of BOOKING_HANDLERS) {
    const result = await handler(ctx)
    if (result != null) return result
  }

  throw new Error(
    "resolve-booking: nenhum handler retornou resultado (finalization deveria ser fallback)"
  )
}

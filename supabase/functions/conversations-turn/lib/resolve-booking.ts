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
import { tryHandleServicesQuestionAnytime } from "./anytime-handlers.ts"
import { findServiceFromText } from "./services.ts"
import type { BookingContext } from "./booking/context.ts"
import { BOOKING_HANDLERS } from "./booking/index.ts"

function buildBookingNextState(state: SimulatorState): SimulatorState {
  return {
    ...state,
    step: "booking",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
    completed_bookings: state.completed_bookings ? [...state.completed_bookings] : [],
  }
}

function resolveLegacyContactPreference(
  state: SimulatorState,
  nextState?: SimulatorState
): "phone" | "email" | "both" | "skip_primary" {
  return (nextState?.contact_preference ?? state.contact_preference ?? "both") as
    | "phone"
    | "email"
    | "both"
    | "skip_primary"
}

function hasRequiredContactForPreference(params: {
  state: SimulatorState
  nextState?: SimulatorState
  preference: "phone" | "email" | "both" | "skip_primary"
}): boolean {
  const { state, nextState, preference } = params
  const sourceState = nextState || state
  const hasPhone = Boolean(sourceState.slots.customer_phone)
  const hasEmail = Boolean(sourceState.slots.customer_email)
  const primaryContactFromCompleted = (sourceState.completed_bookings || []).some(
    (b) => Boolean((b as any).customer_phone || (b as any).customer_email)
  )
  return preference === "phone"
    ? hasPhone
    : preference === "email"
      ? hasEmail
      : preference === "skip_primary"
        ? primaryContactFromCompleted
        : hasPhone && hasEmail
}

function hasRequiredBookingCoreSlots(state: SimulatorState): boolean {
  return (
    Boolean(state.slots?.service) &&
    Boolean(state.slots?.date) &&
    Boolean(state.slots?.time) &&
    Boolean(state.slots?.customer_name)
  )
}

function hasCompletedBookingState(
  state: SimulatorState,
  preference = resolveLegacyContactPreference(state)
): boolean {
  return hasRequiredBookingCoreSlots(state) && hasRequiredContactForPreference({ state, preference })
}

function resolveBookingContactState(
  state: SimulatorState,
  nextState: SimulatorState
): {
  contactOk: boolean
  bookingComplete: boolean
  hasCompletedBooking: boolean
} {
  const pref = resolveLegacyContactPreference(state, nextState)
  const contactOk = hasRequiredContactForPreference({
    state,
    nextState,
    preference: pref,
  })
  const bookingComplete = hasRequiredBookingCoreSlots(nextState) && contactOk

  const hasCompletedBooking = hasCompletedBookingState(state)

  return { contactOk, bookingComplete, hasCompletedBooking }
}

async function interpretBookingAdditionalContext(params: {
  text: string
  history: Array<{ role: string; content: string }>
  hasCompletedBooking: boolean
}): Promise<{
  interpretedAdditional: { has_additional?: boolean; count?: number } | null
  interpretedCount: number | null
  interpretedHasAdditional: boolean
}> {
  const { text, history, hasCompletedBooking } = params

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

  return {
    interpretedAdditional,
    interpretedCount,
    interpretedHasAdditional,
  }
}

function resolveBookingWaitingState(params: {
  state: SimulatorState
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
}): {
  lastAssistantMsg?: string
  waitingFor?: "attendee_name" | "service" | "date" | "time"
} {
  const { state, nextState, history } = params
  const lastAssistantMsg = resolveBookingLastAssistantMessage(state, history)
  const hasPendingServiceChoice = hasPendingBookingServiceChoice(state, nextState)
  const missingSlot = resolveBookingMissingSlot(nextState)

  const waitingFor = nextState.pending_attendee_name
    ? "attendee_name"
    : hasPendingServiceChoice
      ? "service"
      : missingSlot

  return { lastAssistantMsg, waitingFor }
}

function resolveBookingLastAssistantMessage(
  state: SimulatorState,
  history: Array<{ role: string; content: string }>
): string | undefined {
  return (
    state.last_prompt ||
    (history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : undefined)
  )
}

function hasPendingBookingServiceChoice(
  state: SimulatorState,
  nextState: SimulatorState
): boolean {
  return Boolean(
    Array.isArray(state.last_service_options) &&
      state.last_service_options.length > 0 &&
      !state.pending_template_choice &&
      !state.pending_second_service_choice &&
      !nextState.pending_attendee_name
  )
}

function resolveBookingMissingSlot(
  nextState: SimulatorState
): "service" | "date" | "time" | undefined {
  return !nextState.slots.service
    ? "service"
    : !nextState.slots.date
      ? "date"
      : !nextState.slots.time
        ? "time"
        : undefined
}

async function interpretBookingSlotsContext(params: {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  waitingFor?: "attendee_name" | "service" | "date" | "time"
  lastAssistantMsg?: string
}) {
  const { text, config, nextState, history, senderDisplayName, waitingFor, lastAssistantMsg } = params
  if (!(waitingFor || nextState.pending_attendee_name)) return null
  return await interpretSlotsFromMessageWithAI(
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
}

function resolveBookingTurnSignals(params: {
  text: string
  config: SimulatorConfig
  state: SimulatorState
}): {
  normalizedText: string
  allowAiDateAutofill: boolean
  isDigitOnly: boolean
  explicitService: string | null
  wasAdditionalPending: boolean
} {
  const { text, config, state } = params
  const normalizedText = normalizeText(text)
  return {
    normalizedText,
    allowAiDateAutofill:
      hasExplicitDate(text) || normalizedText.includes("hoje") || normalizedText.includes("amanha"),
    isDigitOnly: /^[1-9]\d*$/.test(text.trim()),
    explicitService: findServiceFromText(text, config.services || []) ?? null,
    wasAdditionalPending: Boolean(state.pending_additional_booking || state.pending_additional_count),
  }
}

function buildBookingContext(params: {
  config: SimulatorConfig
  text: string
  state: SimulatorState
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  toNumberedOptions: (options: string[]) => string[]
  getOtherDayOptions: (schedule?: { days_of_week?: string[] } | null) => string[]
  contactOk: boolean
  bookingComplete: boolean
  slotsInterpretation?: unknown
  interpretedAdditional?: { has_additional?: boolean; count?: number } | null
  interpretedCount: number | null
  interpretedHasAdditional: boolean
  lastAssistantMsg?: string
  waitingFor?: "attendee_name" | "service" | "date" | "time"
  normalizedText: string
  allowAiDateAutofill: boolean
  isDigitOnly: boolean
  explicitService: string | null
  wasAdditionalPending: boolean
  hasCompletedBooking: boolean
}): BookingContext {
  const {
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
    slotsInterpretation,
    interpretedAdditional,
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
  } = params
  return {
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
}

function buildBookingRuntimeHelpers() {
  return {
    toNumberedOptions: (options: string[]): string[] =>
      options.map((option, idx) => `${idx + 1} - ${option}`),
    getOtherDayOptions: (schedule?: { days_of_week?: string[] } | null): string[] => {
      const dayOptions = buildStaffDayOptions(schedule?.days_of_week || [])
      return dayOptions.length > 0 ? dayOptions : ["Outro dia"]
    },
  }
}

async function resolveBookingDerivedContext(params: {
  config: SimulatorConfig
  text: string
  state: SimulatorState
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
}) {
  const { config, text, state, nextState, history, senderDisplayName } = params
  const { contactOk, bookingComplete, hasCompletedBooking } = resolveBookingContactState(
    state,
    nextState
  )

  const { interpretedAdditional, interpretedCount, interpretedHasAdditional } =
    await interpretBookingAdditionalContext({
      text,
      history,
      hasCompletedBooking,
    })

  const { lastAssistantMsg, waitingFor } = resolveBookingWaitingState({
    state,
    nextState,
    history,
  })

  const slotsInterpretation = await interpretBookingSlotsContext({
    text,
    config,
    nextState,
    history,
    senderDisplayName,
    waitingFor,
    lastAssistantMsg,
  })

  return {
    contactOk,
    bookingComplete,
    hasCompletedBooking,
    interpretedAdditional,
    interpretedCount,
    interpretedHasAdditional,
    lastAssistantMsg,
    waitingFor,
    slotsInterpretation,
    ...resolveBookingTurnSignals({
      text,
      config,
      state,
    }),
  }
}

function tryHandleBookingInformationalEntry(
  config: SimulatorConfig,
  text: string,
  nextState: SimulatorState
): SimulatorResult | null {
  return tryHandleServicesQuestionAnytime(config, text, nextState)
}

async function runBookingHandlers(ctx: BookingContext): Promise<SimulatorResult> {
  for (const handler of BOOKING_HANDLERS) {
    const result = await handler(ctx)
    if (result != null) return result
  }

  throw new Error(
    "resolve-booking: nenhum handler retornou resultado (finalization deveria ser fallback)"
  )
}

export async function resolveBooking(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string
): Promise<SimulatorResult> {
  const { toNumberedOptions, getOtherDayOptions } = buildBookingRuntimeHelpers()
  const nextState = buildBookingNextState(state)

  const informationalResult = tryHandleBookingInformationalEntry(config, text, nextState)
  if (informationalResult) return informationalResult

  const derived = await resolveBookingDerivedContext({
    config,
    text,
    state,
    nextState,
    history,
    senderDisplayName,
  })

  const ctx = buildBookingContext({
    config,
    text,
    state,
    nextState,
    history,
    senderDisplayName,
    toNumberedOptions,
    getOtherDayOptions,
    contactOk: derived.contactOk,
    bookingComplete: derived.bookingComplete,
    slotsInterpretation: derived.slotsInterpretation,
    interpretedAdditional: derived.interpretedAdditional,
    interpretedCount: derived.interpretedCount,
    interpretedHasAdditional: derived.interpretedHasAdditional,
    lastAssistantMsg: derived.lastAssistantMsg,
    waitingFor: derived.waitingFor,
    normalizedText: derived.normalizedText,
    allowAiDateAutofill: derived.allowAiDateAutofill,
    isDigitOnly: derived.isDigitOnly,
    explicitService: derived.explicitService,
    wasAdditionalPending: derived.wasAdditionalPending,
    hasCompletedBooking: derived.hasCompletedBooking,
  })

  return await runBookingHandlers(ctx)
}

// @ts-nocheck
import type {
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"
import { parseTemplateChoice } from "../utils.ts"
import { planSequentialBooking } from "./sequence-planner.ts"

export interface DerivedBookingContext {
  template_choice?: "same_next" | "same_day" | "other_day" | "other_staff" | null
  people_queue: string[]
  slot_updates: {
    attendee_name?: string
    service?: string
    date?: string
    time?: string
    staff_name?: string
  }
  has_attendee: boolean
  has_service: boolean
  has_date: boolean
  has_time: boolean
  has_contact: boolean
  has_completed_bookings: boolean
  is_additional_booking: boolean
  current_attendee_name?: string
  service_options: string[]
  contact_options: string[]
  sequence_anchor_booking?: Record<string, unknown>
  sequence_suggestion?: {
    available: boolean
    suggested_date?: string
    suggested_time?: string
    suggested_staff_name?: string
    has_other_staff_same_day: boolean
  }
  should_offer_sequence_template: boolean
  missing_step: "audience" | "attendee" | "service" | "date" | "time" | "contact" | "confirm"
}

function normalizeName(value?: string): string {
  return String(value || "").trim().toLowerCase()
}

function uniqueOrderedNames(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const value of values) {
    const trimmed = String(value || "").trim()
    const normalized = normalizeName(trimmed)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    ordered.push(trimmed)
  }
  return ordered
}

function getCompletedAttendeeNames(context: SemanticTurnContext): string[] {
  const completed = Array.isArray(context.state.completed_bookings) ? context.state.completed_bookings : []
  const names = completed.map((booking) => booking?.attendee_name).filter(Boolean)
  if (context.state.last_booking?.attendee_name) {
    names.push(context.state.last_booking.attendee_name)
  }
  return uniqueOrderedNames(names)
}

export function shiftCurrentAttendeeFromQueue(queue: string[], currentAttendeeName?: string): string[] {
  const normalizedCurrent = normalizeName(currentAttendeeName)
  if (!normalizedCurrent) return queue
  const firstMatches = normalizeName(queue[0]) === normalizedCurrent
  if (firstMatches) return queue.slice(1)
  return queue.filter((name) => normalizeName(name) !== normalizedCurrent)
}

export function buildDynamicPeopleQueue(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): string[] {
  const completedNames = new Set(getCompletedAttendeeNames(context).map((name) => normalizeName(name)))
  const candidates = uniqueOrderedNames([
    context.state.slots?.attendee_name,
    ...(Array.isArray(context.state.pending_attendee_queue) ? context.state.pending_attendee_queue : []),
    ...(Array.isArray(snapshot.entities.attendee_names) ? snapshot.entities.attendee_names : []),
  ])
  return candidates.filter((name) => !completedNames.has(normalizeName(name)))
}

function inferSlotUpdates(snapshot: TurnSemanticSnapshot) {
  const firstService = snapshot.entities.services?.[0]?.name
  const firstAttendee = snapshot.entities.attendee_names?.[0]
  return {
    attendee_name: firstAttendee,
    service: firstService,
    date: snapshot.entities.date?.iso_date || undefined,
    time: snapshot.entities.time?.hhmm || undefined,
  }
}

export function deriveBookingContext(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): DerivedBookingContext {
  const peopleQueue = buildDynamicPeopleQueue(snapshot, context)
  const slotUpdates = inferSlotUpdates(snapshot)
  const templateChoice = parseTemplateChoice(
    snapshot.meta.raw_user_message,
    context.state.last_template_options
  )
  const hasAttendee = Boolean(snapshot.entities.attendee_names?.length || context.state.slots?.attendee_name)
  const hasService = Boolean(snapshot.entities.services?.length || context.state.slots?.service)
  const sequenceAnchorBooking =
    (Array.isArray(context.state.completed_bookings) && context.state.completed_bookings.length > 0
      ? context.state.completed_bookings[context.state.completed_bookings.length - 1]
      : undefined) ||
    context.state.last_booking ||
    undefined
  const selectedServiceValue = slotUpdates.service || context.state.slots?.service
  const sequenceSuggestion =
    templateChoice === "same_next" && sequenceAnchorBooking && selectedServiceValue
      ? planSequentialBooking(
          context.business_brain,
          context.state,
          sequenceAnchorBooking as any,
          selectedServiceValue
        )
      : undefined
  if (templateChoice === "same_next" && sequenceSuggestion?.available) {
    slotUpdates.date = sequenceSuggestion.suggested_date
    slotUpdates.time = sequenceSuggestion.suggested_time
    slotUpdates.staff_name = sequenceSuggestion.suggested_staff_name
  } else if (templateChoice === "same_day" && sequenceAnchorBooking?.date) {
    slotUpdates.date = sequenceAnchorBooking.date
    slotUpdates.staff_name = sequenceAnchorBooking.staff_name
  }
  const hasDate = Boolean(slotUpdates.date || snapshot.entities.date?.iso_date || context.state.slots?.date)
  const hasTime = Boolean(slotUpdates.time || snapshot.entities.time?.hhmm || context.state.slots?.time)
  const hasContact = Boolean(
    context.state.contact_preference || context.state.slots?.customer_phone || context.state.slots?.customer_email
  )
  const hasCompletedBookings = Boolean(context.state.completed_bookings?.length)
  const isAdditionalBooking = Boolean(context.state.pending_additional_booking || hasCompletedBookings)
  const currentAttendeeName =
    slotUpdates.attendee_name ||
    context.state.slots?.attendee_name ||
    peopleQueue[0] ||
    undefined
  const effectiveQueue = currentAttendeeName
    ? uniqueOrderedNames([currentAttendeeName, ...peopleQueue])
    : peopleQueue
  const serviceOptions = context.business_brain.services.map((service) => service.name)
  const contactOptions = isAdditionalBooking
    ? ["So celular", "So email", "Celular e email", "Pular (usar contato do titular)"]
    : ["So celular", "So email", "Celular e email"]
  const shouldOfferSequenceTemplate = Boolean(
    hasCompletedBookings &&
    (snapshot.signals.sequence_request || context.state.pending_template_choice) &&
    !templateChoice
  )

  let missingStep: DerivedBookingContext["missing_step"] = "confirm"
  if (snapshot.risks.audience?.requires_confirmation) missingStep = "audience"
  else if (!hasAttendee) missingStep = "attendee"
  else if (!hasService) missingStep = "service"
  else if (shouldOfferSequenceTemplate) missingStep = "date"
  else if (templateChoice === "same_next" && !sequenceSuggestion?.available) missingStep = "date"
  else if (!hasDate) missingStep = "date"
  else if (!hasTime) missingStep = "time"
  else if (!hasContact) missingStep = "contact"

  return {
    template_choice: templateChoice,
    people_queue: effectiveQueue,
    slot_updates: slotUpdates,
    has_attendee: Boolean(currentAttendeeName),
    has_service: hasService,
    has_date: hasDate,
    has_time: hasTime,
    has_contact: hasContact,
    has_completed_bookings: hasCompletedBookings,
    is_additional_booking: isAdditionalBooking,
    current_attendee_name: currentAttendeeName,
    service_options: serviceOptions,
    contact_options: contactOptions,
    sequence_anchor_booking: sequenceAnchorBooking,
    sequence_suggestion: sequenceSuggestion,
    should_offer_sequence_template: shouldOfferSequenceTemplate,
    missing_step: missingStep,
  }
}

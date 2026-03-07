// @ts-nocheck
import type {
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"

export interface DerivedBookingContext {
  people_queue: string[]
  slot_updates: {
    attendee_name?: string
    service?: string
    date?: string
    time?: string
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
  should_offer_sequence_template: boolean
  missing_step: "audience" | "attendee" | "service" | "date" | "time" | "contact" | "confirm"
}

function inferPeopleQueue(snapshot: TurnSemanticSnapshot): string[] {
  const names = Array.isArray(snapshot.attendee_names) ? snapshot.attendee_names.filter(Boolean) : []
  return Array.from(new Set(names))
}

function inferSlotUpdates(snapshot: TurnSemanticSnapshot) {
  const firstService = snapshot.service_candidates?.[0]?.name
  const firstAttendee = snapshot.attendee_names?.[0]
  return {
    attendee_name: firstAttendee,
    service: firstService,
    date: snapshot.date_candidate?.iso_date || undefined,
    time: snapshot.time_candidate?.hhmm || undefined,
  }
}

export function deriveBookingContext(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): DerivedBookingContext {
  const peopleQueue = inferPeopleQueue(snapshot)
  const slotUpdates = inferSlotUpdates(snapshot)
  const hasAttendee = Boolean(snapshot.attendee_names?.length || context.state.slots?.attendee_name)
  const hasService = Boolean(snapshot.service_candidates?.length || context.state.slots?.service)
  const hasDate = Boolean(snapshot.date_candidate?.iso_date || context.state.slots?.date)
  const hasTime = Boolean(snapshot.time_candidate?.hhmm || context.state.slots?.time)
  const hasContact = Boolean(
    context.state.contact_preference || context.state.slots?.customer_phone || context.state.slots?.customer_email
  )
  const hasCompletedBookings = Boolean(context.state.completed_bookings?.length)
  const isAdditionalBooking = Boolean(context.state.pending_additional_booking || hasCompletedBookings)
  const currentAttendeeName =
    slotUpdates.attendee_name ||
    context.state.slots?.attendee_name ||
    context.state.pending_attendee_queue?.[0] ||
    undefined
  const serviceOptions = context.business_brain.services.map((service) => service.name)
  const contactOptions = isAdditionalBooking
    ? ["So celular", "So email", "Celular e email", "Pular (usar contato do titular)"]
    : ["So celular", "So email", "Celular e email"]
  const sequenceAnchorBooking =
    (Array.isArray(context.state.completed_bookings) && context.state.completed_bookings.length > 0
      ? context.state.completed_bookings[context.state.completed_bookings.length - 1]
      : undefined) ||
    context.state.last_booking ||
    undefined
  const shouldOfferSequenceTemplate = Boolean(snapshot.sequence_request && hasCompletedBookings)

  let missingStep: DerivedBookingContext["missing_step"] = "confirm"
  if (snapshot.audience_risk?.requires_confirmation) missingStep = "audience"
  else if (!hasAttendee) missingStep = "attendee"
  else if (!hasService) missingStep = "service"
  else if (shouldOfferSequenceTemplate) missingStep = "date"
  else if (!hasDate) missingStep = "date"
  else if (!hasTime) missingStep = "time"
  else if (!hasContact) missingStep = "contact"

  return {
    people_queue: peopleQueue,
    slot_updates: slotUpdates,
    has_attendee: hasAttendee,
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
    should_offer_sequence_template: shouldOfferSequenceTemplate,
    missing_step: missingStep,
  }
}

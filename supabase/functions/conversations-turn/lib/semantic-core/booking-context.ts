// @ts-nocheck
import type {
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"
import { parseTemplateChoice, getTodayIsoBusinessTz } from "../utils.ts"
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
    customer_phone?: string
    customer_email?: string
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

function inferMissingStepFromHint(
  nextQuestionHint?: string
): DerivedBookingContext["missing_step"] | undefined {
  switch (nextQuestionHint) {
    case "confirm_audience_fit":
      return "audience"
    case "ask_attendee_name":
    case "ask_first_attendee_name":
    case "ask_next_attendee_name":
      return "attendee"
    case "ask_service":
    case "ask_service_selection":
      return "service"
    case "ask_date":
    case "ask_date_preference":
      return "date"
    case "ask_time":
    case "ask_time_preference":
      return "time"
    case "ask_contact":
    case "ask_contact_preference":
      return "contact"
    default:
      return undefined
  }
}

function normalizeName(value?: string): string {
  const v = String(value || "").trim().toLowerCase()
  if (!v) return ""
  if (v === "-" || v === "--") return ""
  if (v === "desconhecido" || v === "unknown" || v === "n/a" || v === "na") return ""
  if (v === "cliente" || v === "pessoa" || v === "proxima pessoa") return ""
  if (
    /\bconfirmar\b/.test(v) ||
    v === "pode confirmar" ||
    v.startsWith("confirmar ") ||
    v === "otimo" ||
    v === "perfeito" ||
    v === "obrigado" ||
    v === "obrigada" ||
    v === "legal" ||
    v === "valeu"
  ) {
    return ""
  }
  const yesTokens = new Set([
    "sim",
    "ok",
    "claro",
    "beleza",
    "pode ser",
    "tudo bem",
    "isso",
    "isso mesmo",
    "quero",
    "eh isso",
    "yes",
    "okay",
  ])
  if (yesTokens.has(v)) return ""
  if (/^\d+$/.test(v) && v.length <= 4) return ""
  return v
}

const BOOKING_STEP_RANK: Record<DerivedBookingContext["missing_step"], number> = {
  audience: 0,
  attendee: 1,
  service: 2,
  date: 3,
  time: 4,
  contact: 5,
  confirm: 6,
}

function bookingStepRank(step: string): number {
  return step in BOOKING_STEP_RANK ? BOOKING_STEP_RANK[step as DerivedBookingContext["missing_step"]] : 99
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
  const serviceLower = new Set(
    (context.business_brain?.services || [])
      .map((s) => String(s?.name || "").trim().toLowerCase())
      .filter(Boolean)
  )
  const candidates = uniqueOrderedNames([
    context.state.slots?.attendee_name,
    ...(Array.isArray(context.state.pending_attendee_queue) ? context.state.pending_attendee_queue : []),
    ...(Array.isArray(snapshot.entities.attendee_names) ? snapshot.entities.attendee_names : []),
  ])
  return candidates.filter((name) => {
    const key = String(name || "").trim().toLowerCase()
    if (!normalizeName(name)) return false
    if (serviceLower.has(key)) return false
    return !completedNames.has(normalizeName(name))
  })
}

function looksLikePhoneOnly(value?: string): boolean {
  const digits = String(value || "").replace(/\D/g, "")
  return digits.length >= 10 && digits.length <= 13
}

export function isValidBookingHHMM(value?: string): boolean {
  if (!value || typeof value !== "string") return false
  if (/nan/i.test(value)) return false
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(value.trim())
}

function isPlausibleBookingIsoDate(iso?: string): boolean {
  if (!iso || String(iso).trim() === "-" || String(iso).trim() === "--") return false
  if (looksLikePhoneOnly(iso)) return false
  const s = String(iso).trim().toLowerCase()
  if (s === "hoje" || s === "amanha") return true
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso).trim())
}

function filterValidServiceNames(names: string[], serviceOptions: string[]): string[] {
  const cleaned = names.map((n) => String(n || "").trim()).filter((n) => n && n !== "-" && n !== "--")
  const opts = (serviceOptions || []).map((x) => String(x).trim()).filter(Boolean)
  if (!opts.length) return cleaned
  const lowerOpts = opts.map((o) => o.toLowerCase())
  return cleaned.filter((n) => {
    const low = n.toLowerCase()
    return lowerOpts.some((o) => o === low || low.includes(o) || o.includes(low))
  })
}

function inferSlotUpdates(snapshot: TurnSemanticSnapshot, serviceOptions: string[]) {
  const rawServices = snapshot.entities.services?.map((service) => service?.name).filter(Boolean) || []
  const selectedServices = filterValidServiceNames(rawServices, serviceOptions)
  const firstAttendeeRaw = snapshot.entities.attendee_names?.[0]
  const firstAttendee = normalizeName(firstAttendeeRaw)
    ? String(firstAttendeeRaw || "").trim()
    : undefined

  const dateRaw = String(snapshot.entities.date?.raw_text || "").toLowerCase()
  let dateIso: string | undefined = snapshot.entities.date?.iso_date
    ? String(snapshot.entities.date.iso_date).trim()
    : undefined
  if (dateRaw.includes("hoje")) {
    dateIso = "hoje"
  } else if (dateRaw.includes("amanh")) {
    dateIso = "amanha"
  } else if (!isPlausibleBookingIsoDate(dateIso)) {
    dateIso = undefined
  } else if (looksLikePhoneOnly(snapshot.entities.date?.raw_text) || looksLikePhoneOnly(dateIso)) {
    dateIso = undefined
  }
  if (dateIso && /^\d{4}-\d{2}-\d{2}$/.test(dateIso) && dateIso < getTodayIsoBusinessTz()) {
    dateIso = undefined
  }

  let timeVal = snapshot.entities.time?.hhmm
  if (!isValidBookingHHMM(timeVal)) timeVal = undefined
  const timeRawDigits = String(snapshot.entities.time?.raw_text || "").replace(/\D/g, "")
  if (timeRawDigits.length >= 10 && timeRawDigits.length <= 13) {
    timeVal = undefined
  }

  return {
    attendee_name: firstAttendee,
    service: selectedServices.length > 0 ? selectedServices.join(", ") : undefined,
    date: dateIso || undefined,
    time: timeVal || undefined,
    customer_phone: snapshot.signals.contact_phone || undefined,
    customer_email: snapshot.signals.contact_email || undefined,
  }
}

export function deriveBookingContext(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): DerivedBookingContext {
  const serviceOptions = (context.business_brain?.services || []).map((service) => service.name)
  const peopleQueue = buildDynamicPeopleQueue(snapshot, context)
  const slotUpdates = inferSlotUpdates(snapshot, serviceOptions)
  const sequenceEnabled = context.business_brain?.policies?.sequence_enabled === true
  const inferredServices = filterValidServiceNames(
    snapshot.entities.services?.map((s) => s?.name).filter(Boolean) || [],
    serviceOptions
  )
  if (!sequenceEnabled && inferredServices.length >= 2) {
    slotUpdates.service = undefined
  } else if (!sequenceEnabled && inferredServices.length === 1) {
    slotUpdates.service = inferredServices[0]
  }
  const parsedTemplateChoice =
    parseTemplateChoice(
      snapshot.meta.raw_user_message,
      context.state.last_template_options
    ) ||
    (context.state.pending_second_service_choice ? "same_next" : null)
  const inferredSameNext =
    !parsedTemplateChoice &&
    !context.state.pending_template_choice &&
    Boolean(context.state.completed_bookings?.length) &&
    snapshot.signals.sequence_request === true
      ? ("same_next" as const)
      : null
  const templateChoice = parsedTemplateChoice || inferredSameNext
  const hasStateAttendee = Boolean(normalizeName(context.state.slots?.attendee_name))
  const hasSnapshotAttendee = Boolean(
    Array.isArray(snapshot.entities.attendee_names) &&
      snapshot.entities.attendee_names.some((n) => Boolean(normalizeName(n)))
  )
  const hasAttendee = Boolean(hasStateAttendee || hasSnapshotAttendee)
  const stateSvcRaw = context.state.slots?.service ? String(context.state.slots.service).trim() : ""
  const stateServiceOk =
    stateSvcRaw &&
    stateSvcRaw !== "-" &&
    stateSvcRaw !== "--" &&
    (filterValidServiceNames([stateSvcRaw], serviceOptions).length > 0 || !serviceOptions.length)
  const hasService = Boolean(
    (sequenceEnabled ? inferredServices.length >= 1 : inferredServices.length === 1) ||
      stateServiceOk ||
      slotUpdates.service
  )
  const sequenceAnchorBooking =
    (Array.isArray(context.state.completed_bookings) && context.state.completed_bookings.length > 0
      ? context.state.completed_bookings[context.state.completed_bookings.length - 1]
      : undefined) ||
    context.state.last_booking ||
    undefined
  const selectedServiceValue = slotUpdates.service || context.state.slots?.service
  const rawSnapshotDate = snapshot.entities.date?.iso_date
    ? String(snapshot.entities.date.iso_date).trim()
    : undefined
  if (!slotUpdates.date && rawSnapshotDate && rawSnapshotDate === sequenceAnchorBooking?.date) {
    slotUpdates.date = rawSnapshotDate
  }
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

  const stateDate = context.state.slots?.date
  const stateTime = context.state.slots?.time
  const stateDateOk =
    stateDate &&
    (String(stateDate).toLowerCase() === "hoje" ||
      String(stateDate).toLowerCase().startsWith("amanh") ||
      isPlausibleBookingIsoDate(String(stateDate)))
  const stateTimeOk = isValidBookingHHMM(String(stateTime || ""))
  const hasDate = Boolean(
    (slotUpdates.date && isPlausibleBookingIsoDate(slotUpdates.date)) ||
      (stateDateOk ? stateDate : false)
  )
  const hasTime = Boolean(
    (slotUpdates.time && isValidBookingHHMM(slotUpdates.time)) || stateTimeOk
  )
  const hasContact = Boolean(
    snapshot.signals.contact_preference ||
    snapshot.signals.contact_phone ||
    snapshot.signals.contact_email ||
    context.state.contact_preference ||
    context.state.slots?.customer_phone ||
    context.state.slots?.customer_email
  )
  const hasCompletedBookings = Boolean(context.state.completed_bookings?.length)
  const isAdditionalBooking = Boolean(context.state.pending_additional_booking || hasCompletedBookings)
  const hasImplicitSelfAttendee = Boolean(
    !isAdditionalBooking &&
    snapshot.signals.includes_self === true &&
    !hasStateAttendee &&
    !hasSnapshotAttendee
  )
  const stateAttendee = normalizeName(context.state.slots?.attendee_name)
    ? String(context.state.slots?.attendee_name || "").trim()
    : undefined
  const currentAttendeeName = slotUpdates.attendee_name || stateAttendee || peopleQueue[0] || undefined
  const effectiveQueue = currentAttendeeName
    ? uniqueOrderedNames([currentAttendeeName, ...peopleQueue])
    : peopleQueue
  const contactOptions = isAdditionalBooking
    ? ["So celular", "So email", "Celular e email", "Pular (usar contato do titular)"]
    : ["So celular", "So email", "Celular e email"]
  const shouldOfferSequenceTemplate = Boolean(
    hasCompletedBookings &&
    currentAttendeeName &&
    (snapshot.signals.sequence_request || context.state.pending_template_choice) &&
    !hasDate &&
    !hasTime &&
    !templateChoice
  )

  let missingStep: DerivedBookingContext["missing_step"] = "confirm"
  if (snapshot.risks.audience?.requires_confirmation) missingStep = "audience"
  else if (!hasAttendee && !(hasImplicitSelfAttendee && hasService && !hasDate && !hasTime && !hasContact)) missingStep = "attendee"
  else if (shouldOfferSequenceTemplate) missingStep = "date"
  else if (!hasService) missingStep = "service"
  else if (templateChoice === "same_next" && !sequenceSuggestion?.available) missingStep = "date"
  else if (!hasDate) missingStep = "date"
  else if (!hasTime) missingStep = "time"
  else if (!hasContact) missingStep = "contact"

  const audienceConfirmed = context.state.audience_confirmed === true
  if (
    missingStep === "contact" &&
    !audienceConfirmed &&
    !hasCompletedBookings &&
    !context.state.last_booking &&
    (snapshot.risks.audience?.requires_confirmation === true || !hasAttendee || !hasService || !hasDate || !hasTime)
  ) {
    if (snapshot.risks.audience?.requires_confirmation === true) missingStep = "audience"
    else if (!hasAttendee && !(hasImplicitSelfAttendee && hasService && !hasDate && !hasTime && !hasContact)) missingStep = "attendee"
    else if (!hasService) missingStep = "service"
    else if (!hasDate) missingStep = "date"
    else if (!hasTime) missingStep = "time"
  }

  const audienceStillPending =
    snapshot.risks.audience?.requires_confirmation === true && context.state.audience_confirmed !== true
  if (!audienceStillPending) {
    const hinted = inferMissingStepFromHint(snapshot.signals.next_question_hint)
    if (hinted && bookingStepRank(hinted) <= bookingStepRank(missingStep)) {
      if (hinted === "service" && !hasService) missingStep = "service"
      else if (hinted === "date" && !hasDate) missingStep = "date"
      else if (hinted === "time" && !hasTime) missingStep = "time"
      else if (hinted === "contact" && !hasContact) missingStep = "contact"
      else if (hinted === "attendee" && !hasAttendee) missingStep = "attendee"
    }
  }

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

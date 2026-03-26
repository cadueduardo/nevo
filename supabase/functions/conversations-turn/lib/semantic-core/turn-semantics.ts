// @ts-nocheck
import {
  getBookingNextActionFromAI,
  interpretSemanticTurnWithAI,
  type BookingRequestInterpretation,
  type FlowOrchestratorOutput,
  type SlotsInterpretation,
} from "../ai.ts"
import { deriveBookingContext } from "./booking-context.ts"
import {
  isConversationClosing,
  isAvailabilityQuestion,
  isGreeting,
  isBusinessContextQuestion,
  isExplicitBookingIntent,
  isListServicesQuestion,
  isPriceQuestion,
  isServiceDetailQuestion,
  isWhoAreYou,
  looksLikeAttendeeName,
} from "../detection.ts"
import { isAddressQuestion, isScheduleQuestion } from "../informational.ts"
import { extractQuoteSlotsFromText } from "../quote-engine.ts"
import { findServicesFromText } from "../services.ts"
import { normalizeText, parseDateOrWeekday, parseEmail, parsePhone, parseTime } from "../utils.ts"
import {
  detectSemanticContinuation,
  getLastActionOptions,
  matchLastActionOption,
} from "./context-continuation.ts"
import type {
  BusinessBrain,
  SemanticAudienceRisk,
  SemanticContinuationKind,
  SemanticIntentsSnapshot,
  SemanticPersonCandidate,
  SemanticPrimaryIntent,
  SemanticQuoteServiceCandidate,
  SemanticSecondaryIntent,
  SemanticServiceCandidate,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"

const MALE_RELATIONS = ["irmao", "irmão", "marido", "pai", "primo", "amigo", "namorado", "filho", "menino", "garoto"]
const FEMALE_RELATIONS = ["irma", "irmã", "esposa", "mae", "mãe", "prima", "amiga", "namorada", "filha", "menina", "garota"]
const CHILD_RELATIONS = ["filho", "filha", "crianca", "criança", "bebe", "bebê", "menino", "menina", "muleque", "moleque"]

function inferWaitingFor(
  state: SemanticTurnContext["state"]
): "attendee_name" | "service" | "date" | "time" | "contact" | undefined {
  if (state.pending_attendee_name) return "attendee_name"
  if (state.pending_second_service_choice || state.service_selection_multi || !state.slots?.service) return "service"
  if (state.pending_date_confirmation || !state.slots?.date) return "date"
  if (state.last_time_options?.length || !state.slots?.time) return "time"
  if (state.pending_contact_field === "contact_preference") return "contact"
  return undefined
}

export function inferContactPreferenceSignal(
  message: string,
  context: Pick<SemanticTurnContext, "state">,
  waitingFor?: "attendee_name" | "service" | "date" | "time" | "contact"
): "phone" | "email" | "both" | "skip_primary" | undefined {
  if (waitingFor !== "contact" && context.state.pending_contact_field !== "contact_preference") return undefined

  const phoneFromMessage = parsePhone(message)
  const emailFromMessage = parseEmail(message)
  if (phoneFromMessage && emailFromMessage) return "both"
  if (phoneFromMessage) return "phone"
  if (emailFromMessage) return "email"

  const normalized = normalizeText(message).trim()
  const lastOptions = getLastActionOptions(context)
  const hasSkipPrimaryOption = lastOptions.some((option) => normalizeText(option).includes("usar contato do titular"))

  if (
    /\b(usa|usar|quero usar|pode usar|reutiliza|reaproveita)\b/.test(normalized) &&
    /\b(mesmo|titular|contato|celular|numero|telefone)\b/.test(normalized)
  ) {
    return hasSkipPrimaryOption ? "skip_primary" : undefined
  }
  if (hasSkipPrimaryOption && /\b(esse mesmo|o mesmo|mesmo contato|mesmo numero|mesmo celular|pular|titular)\b/.test(normalized)) {
    return "skip_primary"
  }
  // "O meu mesmo", "pode ser o meu", "usa o meu" etc. = usar o contato já disponível (ex.: WhatsApp do remetente).
  if (/\b(o )?meu mesmo\b/.test(normalized) || /\b(pode ser|pode usar|quero usar)\s+(o )?meu\b/.test(normalized)) {
    return "phone"
  }
  if (/\b(usa|usar)\s+(o )?meu\b/.test(normalized) || (normalized.length <= 15 && /^o\s+meu\s*$/.test(normalized))) {
    return "phone"
  }
  if (normalized === "4" && hasSkipPrimaryOption) return "skip_primary"
  if (normalized === "3" || /\b(os dois|ambos|celular e email|email e celular)\b/.test(normalized)) return "both"
  if (normalized === "2" || /\b(email|e-mail)\b/.test(normalized)) return "email"
  if (normalized === "1" || /\b(celular|telefone|whatsapp|numero)\b/.test(normalized)) return "phone"
  return undefined
}

export function inferCalendarResponseSignal(
  message: string,
  context: Pick<SemanticTurnContext, "state">
): "accept" | "decline" | undefined {
  const lastOptions = getLastActionOptions(context)
  const isCalendarPrompt =
    context.state.pending_calendar_offer === true ||
    lastOptions.some((option) => normalizeText(option).includes("adicionar no calendario"))
  if (!isCalendarPrompt) return undefined

  const normalized = normalizeText(message).trim()
  if (normalized === "1" || /\b(adicionar|pode adicionar|sim|quero|manda|coloca)\b/.test(normalized)) {
    return "accept"
  }
  if (normalized === "2" || /\b(nao|nao obrigado|dispensa|deixa|sem calendario)\b/.test(normalized)) {
    return "decline"
  }
  return undefined
}

function inferQuoteServiceCandidate(
  message: string,
  brain: BusinessBrain
): SemanticQuoteServiceCandidate | null {
  const quoteServices = Array.isArray(brain.raw_config.quote_services) ? brain.raw_config.quote_services : []
  if (quoteServices.length === 0) return null

  const normalizedMessage = normalizeText(message)
  const measuredSlots = extractQuoteSlotsFromText(message)
  const hasMeasures = ["largura_cm", "altura_cm"].some((key) => measuredSlots[key] != null)

  for (const service of quoteServices) {
    const normalizedName = normalizeText(service?.name || "")
    const keywords = Array.isArray(service?.keywords)
      ? service.keywords.map((keyword) => normalizeText(keyword || "")).filter(Boolean)
      : []
    if (
      (normalizedName && normalizedMessage.includes(normalizedName)) ||
      keywords.some((keyword) => keyword && normalizedMessage.includes(keyword))
    ) {
      return {
        id: service.id,
        name: service.name,
        pricing_type: service.pricing_type,
        required_keys:
          Array.isArray(service?.external_variable_keys) && service.external_variable_keys.length > 0
            ? service.external_variable_keys.filter((key): key is string => typeof key === "string" && key.trim().length > 0)
            : ["largura_cm", "altura_cm"],
        confidence: 0.9,
      }
    }
  }

  if (quoteServices.length === 1 && isPriceQuestion(message) && hasMeasures) {
    const service = quoteServices[0]
    return {
      id: service.id,
      name: service.name,
      pricing_type: service.pricing_type,
      required_keys:
        Array.isArray(service?.external_variable_keys) && service.external_variable_keys.length > 0
          ? service.external_variable_keys.filter((key): key is string => typeof key === "string" && key.trim().length > 0)
          : ["largura_cm", "altura_cm"],
      confidence: 0.7,
    }
  }

  return null
}

function inferPrimaryIntentFromSuggestedAction(
  flow: FlowOrchestratorOutput | null,
  bookingRequest: BookingRequestInterpretation | null
): SemanticPrimaryIntent | null {
  if (bookingRequest?.booking_intent && flow?.suggested_action !== "answer_price") {
    return bookingRequest.additional_count > 0 ? "booking_sequence" : "booking"
  }

  switch (flow?.suggested_action) {
    case "start_booking":
      return flow.inferred_attendees === "multiple" ? "booking_sequence" : "booking"
    case "answer_price":
      return "price"
    case "list_services":
      return "service_list"
    case "service_detail":
      return "service_detail"
    default:
      return null
  }
}

type ResolvedPrimaryIntent = {
  primary: SemanticPrimaryIntent
  source: NonNullable<SemanticIntentsSnapshot["source"]>
}

type DeterministicBookingHints = {
  booking_intent: boolean
  includes_self: boolean
  date?: string
  time?: string
  needs_availability_check: boolean
}

export function inferDeterministicBookingHints(
  message: string,
  waitingFor?: "attendee_name" | "service" | "date" | "time" | "contact",
  continuationKind?: SemanticContinuationKind
): DeterministicBookingHints {
  const normalized = normalizeText(message)
  const availabilityCheck = isAvailabilityQuestion(message)
  const explicitBooking =
    isExplicitBookingIntent(message) ||
    /\b(agendamento|agendar|marcar|marcacao|marcacao)\b/.test(normalized)
  const hasBookingContext = Boolean(continuationKind) || waitingFor === "date" || waitingFor === "time" || waitingFor === "contact"
  const date = parseDateOrWeekday(message) || undefined
  const time = parseTime(message) || undefined
  const bookingIntent =
    explicitBooking ||
    availabilityCheck ||
    (hasBookingContext && Boolean(date || time)) ||
    (Boolean(date || time) && /\b(vaga|horario|disponibilidade)\b/.test(normalized))
  const mentionsOtherPerson =
    /\b(meu|minha|pro|pra|para)\s+(filho|filha|marido|esposa|irmao|irmão|irma|irmã|pai|mae|mãe|amigo|amiga|namorado|namorada)\b/.test(normalized)
  const includesSelf = bookingIntent && !mentionsOtherPerson
  return {
    booking_intent: bookingIntent,
    includes_self: includesSelf,
    date,
    time,
    needs_availability_check: availabilityCheck,
  }
}

export function resolvePrimaryIntent(
  message: string,
  brain: BusinessBrain,
  flow: FlowOrchestratorOutput | null,
  bookingRequest: BookingRequestInterpretation | null,
  continuationKind?: SemanticContinuationKind,
  waitingFor?: "attendee_name" | "service" | "date" | "time" | "contact",
  fallbackAttendeeNames: string[] = [],
  isAdditionalBooking = false
): ResolvedPrimaryIntent {
  if (continuationKind === "audience_confirmation") return { primary: "booking", source: "continuation" }
  if (continuationKind === "price_followup") return { primary: "price", source: "continuation" }
  if (continuationKind === "calendar_response") return { primary: "fallback", source: "continuation" }
  if (waitingFor === "attendee_name" && fallbackAttendeeNames.length > 0) {
    return { primary: isAdditionalBooking ? "booking_sequence" : "booking", source: "continuation" }
  }
  if (inferQuoteServiceCandidate(message, brain)) return { primary: "quote", source: "quote_rule" }

  const interpretedIntent = inferPrimaryIntentFromSuggestedAction(flow, bookingRequest)
  if (interpretedIntent) return { primary: interpretedIntent, source: "unified_ai" }

  if (isConversationClosing(message)) return { primary: "closing", source: "deterministic_fallback" }
  if (isGreeting(message)) return { primary: "greeting", source: "deterministic_fallback" }
  if (isWhoAreYou(message)) return { primary: "identity", source: "deterministic_fallback" }
  if (isAddressQuestion(message) || isScheduleQuestion(message) || isBusinessContextQuestion(message)) return { primary: "faq", source: "deterministic_fallback" }
  if (isPriceQuestion(message)) return { primary: "price", source: "deterministic_fallback" }
  if (isListServicesQuestion(message)) return { primary: "service_list", source: "deterministic_fallback" }
  if (isServiceDetailQuestion(message)) return { primary: "service_detail", source: "deterministic_fallback" }
  if (bookingRequest?.booking_intent) {
    return {
      primary: bookingRequest.additional_count > 0 ? "booking_sequence" : "booking",
      source: "deterministic_fallback",
    }
  }

  return { primary: "fallback", source: "deterministic_fallback" }
}

function inferSecondaryIntents(
  message: string,
  primary: SemanticPrimaryIntent,
  bookingRequest: BookingRequestInterpretation | null,
  continuationKind?: SemanticContinuationKind
): SemanticSecondaryIntent[] {
  const secondary = new Set<SemanticSecondaryIntent>()
  const normalized = normalizeText(message)
  if (continuationKind === "audience_confirmation") secondary.add("audience_confirmation")
  if (continuationKind === "price_followup") secondary.add("booking_with_price")
  if (continuationKind === "calendar_response") secondary.add("calendar_request")
  if (primary === "booking" || primary === "booking_sequence") {
    if (isPriceQuestion(message)) secondary.add("booking_with_price")
    if (/\b(depois do outro|um depois do outro|em sequencia|em sequência|logo depois|proximo horario|próximo horário)\b/.test(normalized)) {
      secondary.add("availability_check")
    }
    if (bookingRequest?.additional_count && bookingRequest.additional_count > 0) {
      secondary.add("booking_with_faq")
    }
  }
  return Array.from(secondary)
}


function inferAudienceHint(relation?: string, includesSelf?: boolean): SemanticPersonCandidate["audience_hint"] {
  const rel = normalizeText(relation || "")
  if (!rel) return includesSelf ? "unknown" : undefined
  if (CHILD_RELATIONS.some((token) => rel.includes(normalizeText(token)))) return "child"
  if (MALE_RELATIONS.some((token) => rel.includes(normalizeText(token)))) return "man"
  if (FEMALE_RELATIONS.some((token) => rel.includes(normalizeText(token)))) return "woman"
  return "unknown"
}

function inferFallbackAttendeeNames(
  message: string,
  waitingFor?: "attendee_name" | "service" | "date" | "time" | "contact"
): string[] {
  if (waitingFor !== "attendee_name") return []
  const trimmed = String(message || "").trim()
  if (!looksLikeAttendeeName(trimmed)) return []
  return [trimmed]
}

function buildPeople(
  bookingRequest: BookingRequestInterpretation | null,
  slots: SlotsInterpretation | null,
  fallbackAttendeeNames: string[] = []
): SemanticPersonCandidate[] {
  const people: SemanticPersonCandidate[] = []
  if (bookingRequest?.includes_self) {
    people.push({ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 })
  }
  for (const name of bookingRequest?.attendee_names || []) {
    people.push({ name, confidence: 0.85 })
  }
  for (const name of fallbackAttendeeNames) {
    const exists = people.some((person) => normalizeText(person.name || "") === normalizeText(name || ""))
    if (!exists) {
      people.push({ name, confidence: 0.82 })
    }
  }
  if (slots?.attendee_name) {
    const exists = people.some((person) => normalizeText(person.name || "") === normalizeText(slots.attendee_name || ""))
    if (!exists) {
      people.push({ name: slots.attendee_name, confidence: 0.8 })
    }
  }
  if (slots?.relationship_only && slots?.relationship) {
    people.push({
      relation: slots.relationship,
      audience_hint: inferAudienceHint(slots.relationship),
      confidence: 0.7,
    })
  } else if (bookingRequest?.for_whom) {
    people.push({
      relation: bookingRequest.for_whom,
      audience_hint: inferAudienceHint(bookingRequest.for_whom),
      confidence: 0.7,
    })
  }
  return people
}

function buildServiceCandidates(
  message: string,
  brain: BusinessBrain,
  bookingRequest: BookingRequestInterpretation | null,
  flow: FlowOrchestratorOutput | null,
  slots: SlotsInterpretation | null
): SemanticServiceCandidate[] {
  const known = new Map<string, SemanticServiceCandidate>()
  const addCandidate = (name?: string | null, confidence = 0.7) => {
    const normalized = normalizeText(name || "")
    if (!normalized) return
    const match = brain.services.find((service) => service.normalized_name === normalized)
    const finalName = match?.name || name || ""
    const finalNormalized = match?.normalized_name || normalized
    if (!known.has(finalNormalized)) {
      known.set(finalNormalized, {
        name: finalName,
        normalized_name: finalNormalized,
        confidence,
      })
    }
  }

  for (const service of findServicesFromText(message, brain.services)) addCandidate(service, 0.75)
  for (const service of bookingRequest?.service_names || []) addCandidate(service, 0.85)
  addCandidate(flow?.inferred_service, 0.75)
  addCandidate(slots?.service, 0.8)
  return Array.from(known.values())
}

function buildAudienceRisk(
  brain: BusinessBrain,
  people: SemanticPersonCandidate[],
  includesSelf: boolean,
  audienceConfirmed = false
): SemanticAudienceRisk {
  const modes = brain.audience?.modes || ["all"]
  if (modes.includes("all") || modes.includes("custom")) {
    return { requires_confirmation: false, inferred_fit: true }
  }

  if (audienceConfirmed) {
    return { requires_confirmation: false, inferred_fit: true }
  }

  // Ninguém foi mencionado (sem nome, sem "para meu filho" etc.): não pedir confirmação de público.
  if (people.length === 0) {
    return { requires_confirmation: false, inferred_fit: null }
  }

  // Agendamento único para si: cliente não mencionou outra pessoa (ex.: "para meu filho").
  // Não exibir CTA "Sim, nos encaixamos?"; a IA segue direto para serviço/data/horário.
  const onlySelf =
    includesSelf &&
    people.length <= 1 &&
    people.every((p) => p.includes_self === true)
  if (onlySelf) {
    return { requires_confirmation: false, inferred_fit: true }
  }

  if (!includesSelf && people.length === 0) {
    return { requires_confirmation: false, inferred_fit: null }
  }

  const hints = people.map((person) => person.audience_hint).filter(Boolean)
  const hasUnknown = includesSelf || hints.length === 0 || hints.includes("unknown")
  const allowsMan = modes.includes("men_only")
  const allowsWoman = modes.includes("women_only")
  const allowsChild = modes.includes("kids_only")

  for (const hint of hints) {
    if (hint === "man" && !allowsMan) {
      return { requires_confirmation: true, reason: "person_outside_audience", inferred_fit: false }
    }
    if (hint === "woman" && !allowsWoman) {
      return { requires_confirmation: true, reason: "person_outside_audience", inferred_fit: false }
    }
    if (hint === "child" && !allowsChild) {
      return { requires_confirmation: true, reason: "person_outside_audience", inferred_fit: false }
    }
  }

  if (hasUnknown) {
    return { requires_confirmation: true, reason: "audience_ambiguous", inferred_fit: null }
  }

  return { requires_confirmation: false, inferred_fit: true }
}

function inferAmbiguities(
  primary: SemanticPrimaryIntent,
  people: SemanticPersonCandidate[],
  services: SemanticServiceCandidate[],
  audienceRisk: SemanticAudienceRisk
): string[] {
  const ambiguities: string[] = []
  if ((primary === "booking" || primary === "booking_sequence") && people.length === 0) ambiguities.push("missing_attendee")
  if ((primary === "booking" || primary === "booking_sequence") && services.length === 0) ambiguities.push("missing_service")
  if (audienceRisk.requires_confirmation) ambiguities.push(audienceRisk.reason || "audience_confirmation")
  return ambiguities
}

function mapWaitingForToQuestionHint(
  waitingFor?: "attendee_name" | "service" | "date" | "time" | "contact",
  isAdditionalBooking = false
): string | undefined {
  switch (waitingFor) {
    case "attendee_name":
      return isAdditionalBooking ? "ask_next_attendee_name" : "ask_first_attendee_name"
    case "service":
      return "ask_service_selection"
    case "date":
      return "ask_date_preference"
    case "time":
      return "ask_time_preference"
    case "contact":
      return "ask_contact_preference"
    default:
      return undefined
  }
}

export function resolveNextQuestionHint(
  primary: SemanticPrimaryIntent,
  people: SemanticPersonCandidate[],
  services: SemanticServiceCandidate[],
  audienceRisk: SemanticAudienceRisk,
  slots: SlotsInterpretation | null,
  waitingFor?: "attendee_name" | "service" | "date" | "time" | "contact",
  isAdditionalBooking = false
): string | undefined {
  if (primary !== "booking" && primary !== "booking_sequence") return undefined
  if (audienceRisk.requires_confirmation) return "confirm_audience_fit"
  if (people.length === 0 || slots?.relationship_only) {
    return waitingFor === "attendee_name"
      ? mapWaitingForToQuestionHint(waitingFor, isAdditionalBooking)
      : "ask_attendee_name"
  }
  if (services.length === 0) {
    return waitingFor === "service" ? mapWaitingForToQuestionHint(waitingFor, isAdditionalBooking) : "ask_service"
  }
  if (!slots?.date) {
    return waitingFor === "date" ? mapWaitingForToQuestionHint(waitingFor, isAdditionalBooking) : "ask_date"
  }
  if (!slots?.time) {
    return waitingFor === "time" ? mapWaitingForToQuestionHint(waitingFor, isAdditionalBooking) : "ask_time"
  }
  return "ask_contact"
}

function inferSequenceRequest(message: string, bookingRequest: BookingRequestInterpretation | null): boolean {
  const normalized = normalizeText(message)
  if (bookingRequest?.additional_count && bookingRequest.additional_count > 0) return true
  return /\b(em sequencia|em sequência|um depois do outro|logo depois|proximo horario|próximo horário|na sequencia|na sequência|tambem|também|mais um|tbm)\b/.test(normalized)
}

function deriveIntentConfidence(
  resolvedIntent: ResolvedPrimaryIntent,
  flow: FlowOrchestratorOutput | null,
  bookingRequest: BookingRequestInterpretation | null
): number {
  const flowConfidence =
    typeof flow?.confidence === "number" ? Math.max(0, Math.min(1, flow.confidence)) : null

  if (resolvedIntent.source === "unified_ai" && flowConfidence != null) {
    return flowConfidence
  }

  switch (resolvedIntent.primary) {
    case "greeting":
    case "identity":
      return resolvedIntent.source === "deterministic_fallback" ? 0.92 : flowConfidence ?? 0.92
    case "faq":
    case "price":
    case "service_detail":
    case "service_list":
    case "quote":
      if (flowConfidence != null && resolvedIntent.source === "unified_ai") return flowConfidence
      if (resolvedIntent.source === "continuation") return 0.9
      if (resolvedIntent.source === "quote_rule") return 0.9
      return 0.88
    case "booking":
    case "booking_sequence":
      if (flowConfidence != null) return flowConfidence
      if (resolvedIntent.source === "continuation") return 0.9
      return bookingRequest?.booking_intent ? 0.8 : 0.6
    case "fallback":
    default:
      if (flowConfidence != null) return flowConfidence
      return 0.35
  }
}

export async function buildTurnSemanticSnapshot(
  message: string,
  context: SemanticTurnContext
): Promise<TurnSemanticSnapshot> {
  const trimmedMessage = (message || "").trim()
  const brain = context.business_brain
  const config = brain.raw_config
  const waitingFor = inferWaitingFor(context.state)
  const continuation = detectSemanticContinuation(trimmedMessage, context)
  const semanticContext = continuation
    ? {
        kind: continuation.kind,
        matched_option: continuation.matched_option,
        last_prompt: context.state.last_prompt,
        last_action_options: getLastActionOptions(context),
      }
    : undefined

  const interpretation = await interpretSemanticTurnWithAI(
    trimmedMessage,
    {
      history: context.history,
      state: context.state,
      sender_display_name: context.sender_display_name,
      waiting_for: waitingFor,
      current_slots: context.state.slots,
      services: brain.services.map((service) => ({ name: service.name })),
      last_assistant_message: context.state.last_prompt,
      continuation: semanticContext,
      business_brain: brain,
      agent_narrative: brain.agent_narrative,
    },
    config
  )
  const flow = interpretation?.flow || null
  const deterministicHints = inferDeterministicBookingHints(trimmedMessage, waitingFor, continuation?.kind)
  const rawBookingRequest = interpretation?.booking_request || null
  const bookingRequest = rawBookingRequest
    ? {
        ...rawBookingRequest,
        booking_intent: rawBookingRequest.booking_intent === true || deterministicHints.booking_intent,
        includes_self:
          rawBookingRequest.includes_self === true ||
          (deterministicHints.includes_self && !(rawBookingRequest.attendee_names?.length || 0) && !rawBookingRequest.for_whom),
      }
    : deterministicHints.booking_intent
      ? {
          booking_intent: true,
          includes_self: deterministicHints.includes_self,
          attendee_names: [],
          additional_count: 0,
          for_whom: null,
          service_names: [],
        }
      : null
  const slots = {
    ...(interpretation?.slots || {}),
    ...(deterministicHints.date ? { date: deterministicHints.date } : {}),
    ...(deterministicHints.time ? { time: deterministicHints.time } : {}),
    needs_availability_check:
      interpretation?.slots?.needs_availability_check === true || deterministicHints.needs_availability_check,
  }

  const fallbackAttendeeNames = inferFallbackAttendeeNames(trimmedMessage, waitingFor)
  const quoteService = inferQuoteServiceCandidate(trimmedMessage, brain)
  const quoteSlots = quoteService ? extractQuoteSlotsFromText(trimmedMessage) : undefined
  const people = buildPeople(bookingRequest, slots as any, fallbackAttendeeNames)
  const serviceCandidates = buildServiceCandidates(trimmedMessage, brain, bookingRequest, flow, slots)
  const resolvedPrimaryIntent = resolvePrimaryIntent(
    trimmedMessage,
    brain,
    flow,
    bookingRequest,
    continuation?.kind,
    waitingFor,
    fallbackAttendeeNames,
    Boolean(
      context.state.pending_additional_booking ||
      (Array.isArray(context.state.completed_bookings) && context.state.completed_bookings.length > 0) ||
      (Array.isArray(context.state.pending_attendee_queue) && context.state.pending_attendee_queue.length > 0)
    )
  )
  const secondaryIntents = inferSecondaryIntents(
    trimmedMessage,
    resolvedPrimaryIntent.primary,
    bookingRequest,
    continuation?.kind
  )
  const audienceRisk = buildAudienceRisk(
    brain,
    people,
    bookingRequest?.includes_self === true,
    continuation?.kind === "audience_confirmation" || context.state.audience_confirmed === true
  )
  const ambiguities = inferAmbiguities(resolvedPrimaryIntent.primary, people, serviceCandidates, audienceRisk)
  const nextQuestionHint = resolveNextQuestionHint(
    resolvedPrimaryIntent.primary,
    people,
    serviceCandidates,
    audienceRisk,
    slots,
    waitingFor,
    Boolean(
      context.state.pending_additional_booking ||
      (Array.isArray(context.state.completed_bookings) && context.state.completed_bookings.length > 0) ||
      (Array.isArray(context.state.pending_attendee_queue) && context.state.pending_attendee_queue.length > 0)
    )
  )
  const contactPhone = parsePhone(trimmedMessage) || undefined
  const contactEmail = parseEmail(trimmedMessage) || undefined
  const contactPreference = inferContactPreferenceSignal(trimmedMessage, context, waitingFor)
  const calendarResponse = inferCalendarResponseSignal(trimmedMessage, context)

  const snapshot: TurnSemanticSnapshot = {
    intents: {
      primary: resolvedPrimaryIntent.primary,
      secondary: secondaryIntents,
      booking: resolvedPrimaryIntent.primary === "booking" || resolvedPrimaryIntent.primary === "booking_sequence",
      confidence: deriveIntentConfidence(resolvedPrimaryIntent, flow, bookingRequest),
      source: resolvedPrimaryIntent.source,
    },
    entities: {
      people,
      attendee_names: Array.from(new Set(people.map((person) => person.name).filter(Boolean))),
      services: serviceCandidates,
      quote_service: quoteService,
      date: slots?.date
        ? { raw_text: trimmedMessage, iso_date: slots.date, weekday: undefined, confidence: 0.8 }
        : null,
      time: slots?.time
        ? { raw_text: trimmedMessage, hhmm: slots.time, confidence: 0.8 }
        : null,
    },
    signals: {
      includes_self: bookingRequest?.includes_self === true,
      additional_count: bookingRequest?.additional_count ?? 0,
      sequence_request: inferSequenceRequest(trimmedMessage, bookingRequest),
      availability_check: slots?.needs_availability_check === true || isAvailabilityQuestion(trimmedMessage),
      next_question_hint: nextQuestionHint,
      contact_preference: contactPreference,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      calendar_response: calendarResponse,
      quote_slots: quoteSlots,
    },
    risks: {
      audience: audienceRisk,
      ambiguities,
    },
    meta: {
      raw_user_message: trimmedMessage,
      continuation: continuation || undefined,
      semantic_trace: {
        intent_source: resolvedPrimaryIntent.source,
        next_question_hint: nextQuestionHint,
        waiting_for: waitingFor,
      },
    },
  }

  if (resolvedPrimaryIntent.primary === "booking" || resolvedPrimaryIntent.primary === "booking_sequence") {
    const booking = deriveBookingContext(snapshot, context)
    const slotsSummary = `Slots (estado + este turno): attendee=${booking.slot_updates?.attendee_name ?? context.state.slots?.attendee_name ?? "-"}, service=${booking.slot_updates?.service ?? context.state.slots?.service ?? "-"}, date=${booking.slot_updates?.date ?? context.state.slots?.date ?? "-"}, time=${booking.slot_updates?.time ?? context.state.slots?.time ?? "-"}, contact=${booking.has_contact ? "preenchido" : "-"}`
    const suggested = await getBookingNextActionFromAI({
      message: trimmedMessage,
      history: context.history,
      slotsSummary,
      hasAttendee: booking.has_attendee,
      hasService: booking.has_service,
      hasDate: booking.has_date,
      hasTime: booking.has_time,
      hasContact: booking.has_contact,
      audienceRequiresConfirmation: Boolean(snapshot.risks.audience?.requires_confirmation),
      shouldOfferSequenceTemplate: booking.should_offer_sequence_template,
      businessContext: brain.agent_runtime_context?.prompt_context || brain.agent_narrative?.prompt_context || "",
      runtimeContext: brain.agent_runtime_context,
      servicesList: (brain.services || []).map((s) => s?.name).filter(Boolean),
    })
    if (suggested) {
      snapshot.meta.suggested_booking_action = suggested
    }
  }

  return snapshot
}








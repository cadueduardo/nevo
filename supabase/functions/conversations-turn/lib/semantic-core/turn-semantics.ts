// @ts-nocheck
import {
  interpretBookingRequestWithAI,
  interpretFlowWithAI,
  interpretSlotsFromMessageWithAI,
  type BookingRequestInterpretation,
  type FlowOrchestratorOutput,
  type SlotsInterpretation,
} from "../ai.ts"
import {
  isAvailabilityQuestion,
  isGreeting,
  isListServicesQuestion,
  isPriceQuestion,
  isServiceDetailQuestion,
  isWhoAreYou,
} from "../detection.ts"
import { isAddressQuestion, isScheduleQuestion } from "../informational.ts"
import { findServicesFromText } from "../services.ts"
import { normalizeText } from "../utils.ts"
import type {
  BusinessBrain,
  SemanticAudienceRisk,
  SemanticPersonCandidate,
  SemanticPrimaryIntent,
  SemanticSecondaryIntent,
  SemanticServiceCandidate,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"

const MALE_RELATIONS = ["irmao", "irmão", "marido", "pai", "primo", "amigo", "namorado", "filho", "menino", "garoto"]
const FEMALE_RELATIONS = ["irma", "irmã", "esposa", "mae", "mãe", "prima", "amiga", "namorada", "filha", "menina", "garota"]
const CHILD_RELATIONS = ["filho", "filha", "crianca", "criança", "bebe", "bebê", "menino", "menina", "muleque", "moleque"]

function inferWaitingFor(state: SemanticTurnContext["state"]): "attendee_name" | "service" | "date" | "time" | undefined {
  if (state.pending_attendee_name) return "attendee_name"
  if (state.pending_second_service_choice || state.service_selection_multi || !state.slots?.service) return "service"
  if (state.pending_date_confirmation || !state.slots?.date) return "date"
  if (state.last_time_options?.length || !state.slots?.time) return "time"
  return undefined
}

function inferPrimaryIntentFromFlow(
  message: string,
  flow: FlowOrchestratorOutput | null,
  bookingRequest: BookingRequestInterpretation | null
): SemanticPrimaryIntent {
  if (bookingRequest?.booking_intent) return bookingRequest.additional_count > 0 ? "booking_sequence" : "booking"
  if (isGreeting(message)) return "greeting"
  if (isWhoAreYou(message)) return "identity"
  if (isAddressQuestion(message) || isScheduleQuestion(message)) return "faq"
  if (isPriceQuestion(message)) return "price"
  if (isListServicesQuestion(message)) return "service_list"
  if (isServiceDetailQuestion(message)) return "service_detail"
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
      return "fallback"
  }
}

function inferSecondaryIntents(
  message: string,
  primary: SemanticPrimaryIntent,
  bookingRequest: BookingRequestInterpretation | null
): SemanticSecondaryIntent[] {
  const secondary = new Set<SemanticSecondaryIntent>()
  const normalized = normalizeText(message)
  if (primary === "booking" || primary === "booking_sequence") {
    if (isPriceQuestion(message)) secondary.add("booking_with_price")
    if (/\b(depois do outro|um depois do outro|em sequencia|em sequência|logo depois|proximo horario|próximo horário)\b/.test(normalized)) {
      secondary.add("availability_check")
    }
    if (bookingRequest?.additional_count && bookingRequest.additional_count > 0) {
      secondary.add("booking_with_faq")
    }
  }
  if (isAvailabilityQuestion(message)) secondary.add("availability_check")
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

function buildPeople(
  bookingRequest: BookingRequestInterpretation | null,
  slots: SlotsInterpretation | null
): SemanticPersonCandidate[] {
  const people: SemanticPersonCandidate[] = []
  if (bookingRequest?.includes_self) {
    people.push({ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 })
  }
  for (const name of bookingRequest?.attendee_names || []) {
    people.push({ name, confidence: 0.85 })
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

function buildAudienceRisk(brain: BusinessBrain, people: SemanticPersonCandidate[], includesSelf: boolean): SemanticAudienceRisk {
  const modes = brain.audience?.modes || ["all"]
  if (modes.includes("all") || modes.includes("custom")) {
    return { requires_confirmation: false, inferred_fit: true }
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

function inferNextQuestionHint(
  primary: SemanticPrimaryIntent,
  people: SemanticPersonCandidate[],
  services: SemanticServiceCandidate[],
  audienceRisk: SemanticAudienceRisk,
  slots: SlotsInterpretation | null
): string | undefined {
  if (primary !== "booking" && primary !== "booking_sequence") return undefined
  if (audienceRisk.requires_confirmation) return "confirm_audience_fit"
  if (people.length === 0 || slots?.relationship_only) return "ask_attendee_name"
  if (services.length === 0) return "ask_service"
  if (!slots?.date) return "ask_date"
  if (!slots?.time) return "ask_time"
  return "ask_contact"
}

function inferSequenceRequest(message: string, bookingRequest: BookingRequestInterpretation | null): boolean {
  const normalized = normalizeText(message)
  if (bookingRequest?.additional_count && bookingRequest.additional_count > 0) return true
  return /\b(em sequencia|em sequência|um depois do outro|logo depois|proximo horario|próximo horário|na sequencia|na sequência)\b/.test(normalized)
}

export async function buildTurnSemanticSnapshot(
  message: string,
  context: SemanticTurnContext
): Promise<TurnSemanticSnapshot> {
  const trimmedMessage = (message || "").trim()
  const brain = context.business_brain
  const config = brain.raw_config
  const waitingFor = inferWaitingFor(context.state)

  const [flow, bookingRequest, slots] = await Promise.all([
    interpretFlowWithAI(trimmedMessage, context.history, context.state, config),
    interpretBookingRequestWithAI(trimmedMessage, {
      history: context.history,
      sender_display_name: context.sender_display_name,
    }, config),
    interpretSlotsFromMessageWithAI(
      trimmedMessage,
      {
        waiting_for: waitingFor,
        current_slots: context.state.slots,
        services: brain.services.map((service) => ({ name: service.name })),
        history: context.history,
        last_assistant_message: context.state.last_prompt,
        sender_display_name: context.sender_display_name,
      },
      config
    ),
  ])

  const primaryIntent = inferPrimaryIntentFromFlow(trimmedMessage, flow, bookingRequest)
  const secondaryIntents = inferSecondaryIntents(trimmedMessage, primaryIntent, bookingRequest)
  const people = buildPeople(bookingRequest, slots)
  const serviceCandidates = buildServiceCandidates(trimmedMessage, brain, bookingRequest, flow, slots)
  const audienceRisk = buildAudienceRisk(brain, people, bookingRequest?.includes_self === true)
  const ambiguities = inferAmbiguities(primaryIntent, people, serviceCandidates, audienceRisk)
  const nextQuestionHint = inferNextQuestionHint(primaryIntent, people, serviceCandidates, audienceRisk, slots)

  return {
    intents: {
      primary: primaryIntent,
      secondary: secondaryIntents,
      booking: primaryIntent === "booking" || primaryIntent === "booking_sequence",
      confidence:
        typeof flow?.confidence === "number"
          ? Math.max(0, Math.min(1, flow.confidence))
          : bookingRequest?.booking_intent
            ? 0.8
            : primaryIntent === "fallback"
              ? 0.35
              : 0.6,
    },
    entities: {
      people,
      attendee_names: Array.from(new Set(people.map((person) => person.name).filter(Boolean))),
      services: serviceCandidates,
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
    },
    risks: {
      audience: audienceRisk,
      ambiguities,
    },
    meta: {
      raw_user_message: trimmedMessage,
    },
  }
}

// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"

function prefersNumberedOptions(context: SemanticTurnContext): boolean {
  return context.business_brain.policies.interaction_style !== "conversational"
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

function buildOptions(action: SemanticDecisionResult["action"]): string[] | undefined {
  switch (action) {
    case "ask_audience_confirmation":
      return ["Sim, nos encaixamos", "Quero agendar"]
    case "offer_sequence_template":
      return [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
      ]
    case "offer_calendar":
      return ["Adicionar no calendario", "Nao, obrigado"]
    default:
      return undefined
  }
}

function buildNextQuestion(action: SemanticDecisionResult["action"], context: SemanticTurnContext): string | undefined {
  switch (action) {
    case "reply_greeting":
      return "greet_customer_naturally"
    case "reply_identity":
      return "introduce_business_and_assistant"
    case "reply_price":
      return "answer_price_and_offer_next_step"
    case "reply_service_detail":
      return "explain_service_and_offer_booking"
    case "reply_service_list":
      return "list_services_and_invite_selection"
    case "ask_audience_confirmation":
      return "confirm_audience_fit_before_booking"
    case "ask_attendee_name":
      return context.state.pending_additional_booking ? "ask_next_attendee_name" : "ask_first_attendee_name"
    case "ask_service":
      return "ask_service_selection"
    case "ask_date":
      return "ask_date_preference"
    case "ask_time":
      return "ask_time_preference"
    case "ask_contact":
      return "ask_contact_preference"
    case "offer_sequence_template":
      return "offer_sequential_booking_options"
    case "confirm_booking":
      return "confirm_booking_summary"
    case "offer_calendar":
      return "offer_calendar_link"
    case "enter_booking":
      return "enter_booking_flow"
    case "reply_faq":
      return "answer_question_and_keep_lead_engaged"
    default:
      return "handoff_or_clarify"
  }
}

export function decideNextSemanticAction(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult {
  const interactionStyle = context.business_brain.policies.interaction_style
  const preferNumberedOptions = prefersNumberedOptions(context)
  const peopleQueue = inferPeopleQueue(snapshot)
  const slotUpdates = inferSlotUpdates(snapshot)

  if (snapshot.primary_intent === "greeting") {
    return {
      action: "reply_greeting",
      reason: "primary_intent_greeting",
      confidence: snapshot.confidence,
      next_question: buildNextQuestion("reply_greeting", context),
      channel_hints: {
        prefer_numbered_options: false,
        prefer_multi_select: false,
      },
    }
  }

  if (snapshot.primary_intent === "identity") {
    return {
      action: "reply_identity",
      reason: "primary_intent_identity",
      confidence: snapshot.confidence,
      next_question: buildNextQuestion("reply_identity", context),
      channel_hints: {
        prefer_numbered_options: false,
        prefer_multi_select: false,
      },
    }
  }

  if (snapshot.primary_intent === "price") {
    return {
      action: "reply_price",
      reason: "primary_intent_price",
      confidence: snapshot.confidence,
      slot_updates: slotUpdates,
      next_question: buildNextQuestion("reply_price", context),
      channel_hints: {
        prefer_numbered_options: false,
        prefer_multi_select: false,
      },
    }
  }

  if (snapshot.primary_intent === "service_detail") {
    return {
      action: "reply_service_detail",
      reason: "primary_intent_service_detail",
      confidence: snapshot.confidence,
      slot_updates: slotUpdates,
      next_question: buildNextQuestion("reply_service_detail", context),
      channel_hints: {
        prefer_numbered_options: false,
        prefer_multi_select: false,
      },
    }
  }

  if (snapshot.primary_intent === "service_list") {
    return {
      action: "reply_service_list",
      reason: "primary_intent_service_list",
      confidence: snapshot.confidence,
      next_question: buildNextQuestion("reply_service_list", context),
      channel_hints: {
        prefer_numbered_options: preferNumberedOptions,
        prefer_multi_select: Boolean(context.business_brain.policies.sequence_enabled),
      },
    }
  }

  if (snapshot.primary_intent === "booking" || snapshot.primary_intent === "booking_sequence") {
    if (snapshot.audience_risk?.requires_confirmation) {
      return {
        action: "ask_audience_confirmation",
        reason: snapshot.audience_risk.reason || "audience_requires_confirmation",
        confidence: snapshot.confidence,
        action_options: buildOptions("ask_audience_confirmation"),
        next_question: buildNextQuestion("ask_audience_confirmation", context),
        channel_hints: {
          prefer_numbered_options: true,
          prefer_multi_select: false,
        },
      }
    }

    if (!snapshot.attendee_names?.length && !context.state.slots?.attendee_name) {
      return {
        action: "ask_attendee_name",
        reason: "missing_attendee_name",
        confidence: snapshot.confidence,
        semantic_people_queue: peopleQueue,
        next_question: buildNextQuestion("ask_attendee_name", context),
        channel_hints: {
          prefer_numbered_options: false,
          prefer_multi_select: false,
        },
      }
    }

    if (!snapshot.service_candidates?.length && !context.state.slots?.service) {
      return {
        action: "ask_service",
        reason: "missing_service_selection",
        confidence: snapshot.confidence,
        semantic_people_queue: peopleQueue,
        next_question: buildNextQuestion("ask_service", context),
        channel_hints: {
          prefer_numbered_options: preferNumberedOptions,
          prefer_multi_select: Boolean(context.business_brain.policies.sequence_enabled),
        },
      }
    }

    if (snapshot.sequence_request && context.state.completed_bookings?.length) {
      return {
        action: "offer_sequence_template",
        reason: "sequence_requested_or_detected",
        confidence: snapshot.confidence,
        slot_updates: slotUpdates,
        semantic_people_queue: peopleQueue,
        action_options: buildOptions("offer_sequence_template"),
        next_question: buildNextQuestion("offer_sequence_template", context),
        channel_hints: {
          prefer_numbered_options: true,
          prefer_multi_select: false,
        },
      }
    }

    if (!snapshot.date_candidate?.iso_date && !context.state.slots?.date) {
      return {
        action: "ask_date",
        reason: "missing_date_preference",
        confidence: snapshot.confidence,
        slot_updates: slotUpdates,
        semantic_people_queue: peopleQueue,
        next_question: buildNextQuestion("ask_date", context),
        channel_hints: {
          prefer_numbered_options: interactionStyle !== "conversational",
          prefer_multi_select: false,
        },
      }
    }

    if (!snapshot.time_candidate?.hhmm && !context.state.slots?.time) {
      return {
        action: "ask_time",
        reason: "missing_time_preference",
        confidence: snapshot.confidence,
        slot_updates: slotUpdates,
        semantic_people_queue: peopleQueue,
        next_question: buildNextQuestion("ask_time", context),
        channel_hints: {
          prefer_numbered_options: true,
          prefer_multi_select: false,
        },
      }
    }

    if (!context.state.contact_preference && !context.state.slots?.customer_phone && !context.state.slots?.customer_email) {
      return {
        action: "ask_contact",
        reason: "missing_contact_preference",
        confidence: snapshot.confidence,
        slot_updates: slotUpdates,
        semantic_people_queue: peopleQueue,
        next_question: buildNextQuestion("ask_contact", context),
        channel_hints: {
          prefer_numbered_options: true,
          prefer_multi_select: false,
        },
      }
    }

    return {
      action: "confirm_booking",
      reason: "booking_ready_for_confirmation",
      confidence: snapshot.confidence,
      slot_updates: slotUpdates,
      semantic_people_queue: peopleQueue,
      next_question: buildNextQuestion("confirm_booking", context),
      channel_hints: {
        prefer_numbered_options: true,
        prefer_multi_select: false,
      },
    }
  }

  if (snapshot.primary_intent === "closing") {
    return {
      action: "offer_calendar",
      reason: "customer_is_closing_after_booking",
      confidence: snapshot.confidence,
      action_options: buildOptions("offer_calendar"),
      next_question: buildNextQuestion("offer_calendar", context),
      channel_hints: {
        prefer_numbered_options: true,
        prefer_multi_select: false,
      },
    }
  }

  return {
    action: "handoff_fallback",
    reason: "semantic_snapshot_fallback",
    confidence: snapshot.confidence,
    next_question: buildNextQuestion("handoff_fallback", context),
    channel_hints: {
      prefer_numbered_options: false,
      prefer_multi_select: false,
    },
  }
}

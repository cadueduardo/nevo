// @ts-nocheck
import type { SemanticDecisionResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"

const BOOKING_ACTIONS_FOR_AI: SemanticDecisionResult["action"][] = [
  "ask_audience_confirmation",
  "ask_attendee_name",
  "ask_service",
  "offer_sequence_template",
  "ask_date",
  "ask_time",
  "ask_contact",
  "confirm_booking",
  "offer_calendar",
]

function isValidBookingActionFromIA(action: string): action is SemanticDecisionResult["action"] {
  return (BOOKING_ACTIONS_FOR_AI as string[]).includes(action)
}

function buildBookingChannelHints(
  preferNumberedOptions: boolean,
  preferMultiSelect = false
): SemanticDecisionResult["channel_hints"] {
  return {
    prefer_numbered_options: preferNumberedOptions,
    prefer_multi_select: preferMultiSelect,
  }
}

function pickDefinedSlots(
  source: ReturnType<typeof deriveBookingContext>["slot_updates"],
  keys: Array<keyof ReturnType<typeof deriveBookingContext>["slot_updates"]>
): SemanticDecisionResult["slot_updates"] | undefined {
  const picked = Object.fromEntries(
    keys
      .map((key) => [key, source?.[key]])
      .filter(([, value]) => value !== undefined)
  ) as SemanticDecisionResult["slot_updates"]
  return Object.keys(picked).length > 0 ? picked : undefined
}

function buildBookingDecision(params: {
  snapshot: TurnSemanticSnapshot
  booking: ReturnType<typeof deriveBookingContext>
  action: SemanticDecisionResult["action"]
  reason: string
  next_question: string
  action_options?: string[]
  slot_updates?: SemanticDecisionResult["slot_updates"]
  channel_hints: SemanticDecisionResult["channel_hints"]
}): SemanticDecisionResult {
  const { snapshot, booking, action, reason, next_question, action_options, slot_updates, channel_hints } = params
  return {
    action,
    reason,
    confidence: snapshot.intents.confidence,
    semantic_people_queue: booking.people_queue,
    ...(slot_updates ? { slot_updates } : {}),
    ...(action_options ? { action_options } : {}),
    next_question,
    channel_hints,
  }
}

function resolveBookingNextQuestion(
  snapshot: TurnSemanticSnapshot,
  missingStep: ReturnType<typeof deriveBookingContext>["missing_step"],
  fallbackQuestion: string
): string {
  const hinted = snapshot.signals.next_question_hint
  if (!hinted) return fallbackQuestion

  switch (missingStep) {
    case "attendee":
      return hinted === "ask_first_attendee_name" || hinted === "ask_next_attendee_name" || hinted === "ask_attendee_name"
        ? hinted
        : fallbackQuestion
    case "service":
      return hinted === "ask_service_selection" || hinted === "ask_service" ? hinted : fallbackQuestion
    case "date":
      return hinted === "ask_date_preference" || hinted === "ask_date" ? hinted : fallbackQuestion
    case "time":
      return hinted === "ask_time_preference" || hinted === "ask_time" ? hinted : fallbackQuestion
    case "contact":
      return hinted === "ask_contact_preference" || hinted === "ask_contact" ? hinted : fallbackQuestion
    default:
      return fallbackQuestion
  }
}

export function decideBooking(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticDecisionResult | null {
  if (snapshot.intents.primary !== "booking" && snapshot.intents.primary !== "booking_sequence") {
    return null
  }

  const interactionStyle = context.business_brain.policies.interaction_style
  const preferNumberedOptions = interactionStyle !== "conversational"
  const booking = deriveBookingContext(snapshot, context)

  // Log extra para depuração do booking (evita adivinhar por que "pula" para "Qual contato?")
  // Ativo quando SEMANTIC_CORE_DEBUG estiver setado no ambiente da edge function.
  const debugEnabled = String(Deno.env.get("SEMANTIC_CORE_DEBUG") || "")
    .trim()
    .toLowerCase()
    .match(/^(1|true|yes|on)$/)
  if (debugEnabled) {
    console.log(
      "[semantic-core][booking] missing_step/slots",
      JSON.stringify({
        channel: context.channel,
        session_id: context.session_id,
        raw_user_message: snapshot.meta?.raw_user_message,
        suggested_booking_action: snapshot.meta?.suggested_booking_action ?? null,
        missing_step: booking.missing_step,
        has_attendee: booking.has_attendee,
        has_service: booking.has_service,
        has_date: booking.has_date,
        has_time: booking.has_time,
        has_contact: booking.has_contact,
        current_attendee_name: booking.current_attendee_name ?? null,
        people_queue_top: booking.people_queue?.[0] ?? null,
        slot_updates: {
          attendee_name: booking.slot_updates?.attendee_name ?? null,
          service: booking.slot_updates?.service ?? null,
          date: booking.slot_updates?.date ?? null,
          time: booking.slot_updates?.time ?? null,
        },
        pending_contact_field: context.state.pending_contact_field ?? null,
        contact_preference: snapshot.signals.contact_preference ?? null,
        pending_audience_confirmation: context.state.pending_audience_confirmation ?? null,
        audience_confirmed: context.state.audience_confirmed ?? null,
        audience_requires_confirmation: Boolean(snapshot.risks.audience?.requires_confirmation),
      })
    )
  }

  // Pós-finalização: se temos 2º agendamento e ainda falta telefone para avisar a 2ª pessoa.
  if (context.state.pending_secondary_contact) {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_contact",
      reason: "missing_secondary_contact_phone",
      next_question: "ask_secondary_contact_phone",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  // Após finalizar, oferecer calendário imediatamente (sem depender do cliente encerrar a conversa).
  if (context.state.pending_calendar_offer === true && !context.state.pending_secondary_contact) {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "offer_calendar",
      reason: "post_booking_calendar_offer",
      next_question: "offer_calendar_link",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  // WhatsApp: antes de pedir "preferência de contato", confirmar se pode usar o número do remetente.
  if (
    booking.missing_step === "contact" &&
    context.channel === "whatsapp" &&
    !context.state.slots?.customer_phone &&
    !snapshot.signals.contact_phone &&
    typeof context.sender_id === "string" &&
    context.sender_id.replace(/\D+/g, "").length >= 10
  ) {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_contact",
      reason: "whatsapp_primary_phone_confirmation",
      next_question: "confirm_primary_phone_whatsapp",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  // WhatsApp: usuário disse "não" para usar o mesmo; agora aguardamos ele informar um telefone.
  if (context.state.pending_contact_field === "phone") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_contact",
      reason: "missing_primary_phone",
      next_question: "ask_primary_phone",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  if (booking.missing_step === "audience") {
    const usePluralAudienceCopy =
      (snapshot.signals.additional_count || 0) > 0 ||
      (Array.isArray(snapshot.entities.attendee_names) && snapshot.entities.attendee_names.filter(Boolean).length > 1) ||
      (Array.isArray(snapshot.entities.people) && snapshot.entities.people.filter((person) => person && person.name).length > 1)
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_audience_confirmation",
      reason: snapshot.risks.audience?.reason || "audience_requires_confirmation",
      slot_updates: booking.slot_updates,
      action_options: [usePluralAudienceCopy ? "Sim, nos encaixamos" : "Sim, me encaixo", "Quero agendar"],
      next_question:
        snapshot.risks.audience?.prompt || "confirm_audience_fit_before_booking",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  if (booking.missing_step === "attendee") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_attendee_name",
      reason: "missing_attendee_name",
      slot_updates: booking.slot_updates,
      next_question: resolveBookingNextQuestion(
        snapshot,
        booking.missing_step,
        context.state.pending_additional_booking ? "ask_next_attendee_name" : "ask_first_attendee_name"
      ),
      channel_hints: buildBookingChannelHints(false),
    })
  }

  if (booking.should_offer_sequence_template) {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "offer_sequence_template",
      reason: "sequence_requested_or_detected",
      slot_updates: booking.slot_updates,
      action_options: [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
      ],
      next_question: "offer_sequential_booking_options",
      channel_hints: buildBookingChannelHints(true),
    })
  }

  if (booking.missing_step === "service") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_service",
      reason: "missing_service_selection",
      slot_updates:
        booking.template_choice === "same_next" || booking.template_choice === "same_day"
          ? booking.slot_updates
          : undefined,
      next_question: resolveBookingNextQuestion(snapshot, booking.missing_step, "ask_service_selection"),
      channel_hints: buildBookingChannelHints(
        preferNumberedOptions,
        Boolean(context.business_brain.policies.sequence_enabled)
      ),
    })
  }

  if (booking.missing_step === "date") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_date",
      reason:
        booking.template_choice === "same_next" && booking.sequence_suggestion && !booking.sequence_suggestion.available
          ? "sequence_same_next_unavailable"
          : "missing_date_preference",
      slot_updates: booking.slot_updates,
      next_question: resolveBookingNextQuestion(snapshot, booking.missing_step, "ask_date_preference"),
      channel_hints: buildBookingChannelHints(interactionStyle !== "conversational"),
    })
  }

  if (booking.missing_step === "time") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_time",
      reason: "missing_time_preference",
      slot_updates: booking.slot_updates,
      next_question: resolveBookingNextQuestion(snapshot, booking.missing_step, "ask_time_preference"),
      channel_hints: buildBookingChannelHints(true),
    })
  }

  if (booking.missing_step === "contact") {
    return buildBookingDecision({
      snapshot,
      booking,
      action: "ask_contact",
      reason: "missing_contact_preference",
      slot_updates: booking.slot_updates,
      action_options: booking.contact_options,
      next_question: resolveBookingNextQuestion(snapshot, booking.missing_step, "ask_contact_preference"),
      channel_hints: buildBookingChannelHints(true),
    })
  }

  return buildBookingDecision({
    snapshot,
    booking,
    action: "confirm_booking",
    reason: "booking_ready_for_confirmation",
    slot_updates: booking.slot_updates,
    next_question: "confirm_booking_summary",
    channel_hints: buildBookingChannelHints(true),
  })
}

/** Monta a decisão de booking a partir da ação sugerida pela IA (sem ordem fixa). Reutiliza deriveBookingContext e buildBookingDecision. */
export function buildBookingDecisionFromSuggestedAction(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext,
  suggestedAction: string
): SemanticDecisionResult | null {
  if (!isValidBookingActionFromIA(suggestedAction)) return null
  const booking = deriveBookingContext(snapshot, context)
  const interactionStyle = context.business_brain.policies.interaction_style
  const preferNumberedOptions = interactionStyle !== "conversational"

  const nextQuestionByAction: Record<string, string> = {
    ask_audience_confirmation: snapshot.risks.audience?.prompt || "confirm_audience_fit_before_booking",
    ask_attendee_name: context.state.pending_additional_booking ? "ask_next_attendee_name" : "ask_first_attendee_name",
    ask_service: "ask_service_selection",
    offer_sequence_template: "offer_sequential_booking_options",
    ask_date: "ask_date_preference",
    ask_time: "ask_time_preference",
    ask_contact: "ask_contact_preference",
    confirm_booking: "confirm_booking_summary",
    offer_calendar: "offer_calendar",
  }
  const actionOptionsByAction: Record<string, string[] | undefined> = {
    ask_audience_confirmation: ["Sim, nos encaixamos", "Quero agendar"],
    ask_contact: booking.contact_options,
    offer_sequence_template: [
      "Mesmo dia e colaborador (proximo horario)",
      "Outro horario no mesmo dia",
      "Outro dia",
    ],
  }

  // Importante: ao usar a sugestão da IA, NÃO devemos aplicar slot_updates "inteiros"
  // em ações que só perguntam um único item. Caso contrário, o modelo pode extrair
  // números/frases como se fossem date/time e contaminar o estado (alucinações).
  const su = booking.slot_updates || {}
  let filteredSlotUpdates: SemanticDecisionResult["slot_updates"] | undefined
  switch (suggestedAction) {
    case "ask_attendee_name":
    case "ask_first_attendee_name":
    case "ask_next_attendee_name": {
      filteredSlotUpdates = pickDefinedSlots(su, ["attendee_name"])
      break
    }
    case "ask_service":
      filteredSlotUpdates = pickDefinedSlots(su, ["attendee_name", "service"])
      break
    case "offer_sequence_template":
      filteredSlotUpdates = su
      break
    case "ask_date":
      filteredSlotUpdates = pickDefinedSlots(su, ["attendee_name", "service", "date"])
      break
    case "ask_time":
      filteredSlotUpdates = pickDefinedSlots(su, ["attendee_name", "service", "date", "time"])
      break
    case "ask_contact":
      filteredSlotUpdates = pickDefinedSlots(su, [
        "attendee_name",
        "service",
        "date",
        "time",
        "customer_phone",
        "customer_email",
      ])
      break
    default:
      filteredSlotUpdates = su
      break
  }

  return buildBookingDecision({
    snapshot,
    booking,
    action: suggestedAction as SemanticDecisionResult["action"],
    reason: "ai_driven_booking_action",
    next_question: nextQuestionByAction[suggestedAction] || suggestedAction,
    action_options: actionOptionsByAction[suggestedAction],
    slot_updates: filteredSlotUpdates,
    channel_hints: buildBookingChannelHints(
      suggestedAction === "ask_audience_confirmation" || suggestedAction === "ask_time" || suggestedAction === "ask_contact" || suggestedAction === "confirm_booking" || suggestedAction === "offer_sequence_template" || suggestedAction === "offer_calendar",
      Boolean(context.business_brain.policies.sequence_enabled) && suggestedAction === "ask_service"
    ),
  })
}



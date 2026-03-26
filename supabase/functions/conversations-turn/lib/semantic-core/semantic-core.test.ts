// @ts-nocheck
import { buildBusinessBrain } from "./business-brain.ts"
import { buildAgentRuntimeContext } from "./agent-runtime-context.ts"
import { buildDynamicPeopleQueue, deriveBookingContext } from "./booking-context.ts"
import { buildPostConfirmationPlan } from "./booking-lifecycle.ts"
import { decideNextSemanticAction } from "./decision-engine/index.ts"
import { planSequentialBooking } from "./sequence-planner.ts"
import { applySemanticPolicies } from "./policy-layer.ts"
import { renderBooking } from "./renderers/booking.ts"
import { resolveSemanticPromptText } from "./renderers/prompt-library.ts"
import { buildSemanticResult, formatSemanticActionOptions } from "./renderers/shared.ts"
import {
  buildSemanticClarificationDecision,
  buildSemanticTurnContext,
  resolveSemanticDecisionPipeline,
} from "./runtime-helpers.ts"
import {
  buildTurnSemanticSnapshot,
  inferCalendarResponseSignal,
  inferContactPreferenceSignal,
  inferDeterministicBookingHints,
  resolveNextQuestionHint,
  resolvePrimaryIntent,
} from "./turn-semantics.ts"
import { detectSemanticContinuation } from "./context-continuation.ts"
import { interpretSemanticTurnWithAI } from "../ai.ts"
import { parseTime } from "../utils.ts"
import { getSemanticTimeOptions } from "./availability-planner.ts"

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(message || `Expected ${expectedJson} but got ${actualJson}`)
  }
}

function normalizeAssertText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

function createBaseConfig() {
  return {
    business_name: "BarberShop",
    allow_sequence_booking: true,
    interaction_style: "hybrid",
    booking_services: [
      { name: "Corte", duration_minutes: 30, base_price: 50, description: "Corte de cabelo" },
      { name: "Barba", duration_minutes: 30, base_price: 35, description: "Barba completa" },
    ],
    quote_services: [
      {
        id: "quote-1",
        name: "Cortina",
        pricing_type: "area",
        variables_schema: [
          { key: "largura_cm", label: "Largura", required: true },
          { key: "altura_cm", label: "Altura", required: true },
        ],
        pricing_rules: { price_per_m2: 100 },
        external_variable_keys: ["largura_cm", "altura_cm"],
        keywords: ["cortina"],
        active: true,
      },
    ],
    schedule: {
      days_of_week: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      start_time: "08:00",
      end_time: "18:00",
      interval_minutes: 30,
      breaks: [{ start: "12:00", end: "13:00" }],
    },
    staff: [
      {
        name: "Cadu",
        use_business_schedule: true,
      },
    ],
    target_audience: {
      modes: ["men_only", "kids_only"],
    },
  }
}

function createBaseState(overrides = {}) {
  return {
    slots: {
      quote_answers: {},
      ...overrides.slots,
    },
    ...overrides,
  }
}

Deno.test("buildBusinessBrain derives a canonical agent narrative from the same source of truth", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)

  if (!brain.agent_narrative?.summary) {
    throw new Error("Expected canonical agent narrative summary")
  }
  if (!brain.agent_narrative?.prompt_context?.includes("BarberShop")) {
    throw new Error("Expected prompt context to mention the configured business")
  }
  if (!brain.agent_narrative?.triage_guidance?.includes("escopo")) {
    throw new Error("Expected triage guidance in canonical narrative")
  }
})

Deno.test("buildBusinessBrain normalizes numeric service fields even when config arrives as strings", () => {
  const brain = buildBusinessBrain({
    ...createBaseConfig(),
    booking_services: [
      { name: "Corte", duration_minutes: "30", base_price: "50", description: "Corte de cabelo" },
      { name: "Barba", duration_minutes: "20", base_price: "35", description: "Barba completa" },
    ],
    schedule: {
      ...createBaseConfig().schedule,
      interval_minutes: "30",
      min_booking_lead_minutes: "15",
    },
  } as any)

  assertEquals(brain.services[0]?.duration_minutes, 30)
  assertEquals(brain.services[0]?.base_price, 50)
  assertEquals(brain.schedule?.interval_minutes, 30)
  assertEquals(brain.schedule?.min_booking_lead_minutes, 15)
})


Deno.test("buildBusinessBrain enriches booking_services with missing price and duration from legacy services", () => {
  const brain = buildBusinessBrain({
    ...createBaseConfig(),
    booking_services: [
      { name: "Corte de cabelo" },
      { name: "Barba" },
    ],
    services: [
      { name: "Corte de cabelo", duration_minutes: 30, base_price: 50, description: "Corte masculino" },
      { name: "Barba", duration_minutes: 20, base_price: 35, description: "Barba completa" },
    ],
  } as any)

  assertEquals(brain.services[0]?.base_price, 50)
  assertEquals(brain.services[0]?.duration_minutes, 30)
  assertEquals(brain.services[1]?.base_price, 35)
})
Deno.test("buildAgentRuntimeContext derives a structured runtime dossier from the canonical narrative", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const runtimeContext = buildAgentRuntimeContext({
    business_brain: brain,
    agent_narrative: brain.agent_narrative,
  })

  if (!runtimeContext.identity_context.includes("BarberShop")) {
    throw new Error("Expected runtime identity context to mention the configured business")
  }
  if (!runtimeContext.service_context.includes("Corte")) {
    throw new Error("Expected runtime service context to mention configured services")
  }
  if (!runtimeContext.multi_booking_context.trim()) {
    throw new Error("Expected runtime multi-booking context to be populated")
  }
  if (!runtimeContext.prompt_context.includes("MULTIAGENDAMENTO")) {
    throw new Error("Expected prompt context to expose labeled runtime sections")
  }
  if (!runtimeContext.triage_context.includes("escopo")) {
    throw new Error("Expected runtime triage context to preserve business triage guidance")
  }
})

Deno.test("buildDynamicPeopleQueue preserves inferred names and removes completed attendees", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      slots: {
        attendee_name: "Carlos",
      },
      pending_attendee_queue: ["Davi"],
      completed_bookings: [{ attendee_name: "Carlos" }],
      last_booking: { attendee_name: "Carlos" },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.9 },
    entities: {
      people: [],
      attendee_names: ["Carlos", "Davi", "Joao"],
      services: [],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 2,
      sequence_request: true,
    },
    risks: {
      audience: {
        requires_confirmation: true,
        blocked: false,
        reason: "audience_ambiguous",
        inferred_fit: null,
      },
      ambiguities: [],
    },
    meta: { raw_user_message: "quero agendar pro Carlos, Davi e Joao" },
  }

  const queue = buildDynamicPeopleQueue(snapshot as any, context as any)
  assertEquals(queue, ["Davi", "Joao"])
})

Deno.test("resolveSemanticDecisionPipeline routes external quote inside semantic core", () => {
  const context = buildSemanticTurnContext({
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState(),
  })

  const snapshot = {
    intents: { primary: "quote", secondary: [], booking: false, confidence: 0.9 },
    entities: {
      people: [],
      attendee_names: [],
      services: [],
      quote_service: {
        id: "quote-1",
        name: "Cortina",
        pricing_type: "area",
        required_keys: ["largura_cm", "altura_cm"],
      },
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      quote_slots: {},
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "quanto fica uma cortina?" },
  }

  const pipeline = resolveSemanticDecisionPipeline(snapshot as any, context as any)

  assertEquals(pipeline.decision.action, "ask_quote_measurements")
  assertEquals(pipeline.execution, null)
})

Deno.test("deriveBookingContext promotes current attendee from inferred queue", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      pending_attendee_queue: ["Davi", "Joao"],
      completed_bookings: [{ attendee_name: "Carlos" }],
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.9 },
    entities: {
      people: [],
      attendee_names: ["Davi", "Joao"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 2,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "davi" },
  }

  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.current_attendee_name, "Davi")
  assertEquals(booking.people_queue, ["Davi", "Joao"])
})

Deno.test("buildPostConfirmationPlan advances to next inferred attendee without asking name again", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte, Barba",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
        customer_phone: "11999999999",
      },
      pending_attendee_queue: ["Davi"],
      completed_bookings: [],
      booked_slots: {},
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.95 },
    entities: {
      people: [],
      attendee_names: ["Carlos", "Davi"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:00" },
    },
    signals: {
      includes_self: false,
      additional_count: 1,
      sequence_request: true,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "quero agendar pro Carlos e Davi" },
  }
  const completedBooking = {
    attendee_name: "Carlos",
    service: "Corte, Barba",
    service_names: ["Corte", "Barba"],
    duration_minutes: 60,
    date: "2026-03-09",
    time: "09:00",
    staff_name: "Cadu",
    customer_phone: "11999999999",
    contact_delivery: "own",
  }

  const plan = buildPostConfirmationPlan(context as any, snapshot as any, completedBooking as any)
  assertEquals(plan.has_more_people, true)
  assertEquals(plan.next_attendee_name, "Davi")
  assertEquals(plan.remaining_queue, ["Davi"])
  assertEquals(plan.should_offer_sequence_template, true)
})

Deno.test("buildPostConfirmationPlan keeps primary contact bookings out of outbound notifications", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      completed_bookings: [
        {
          attendee_name: "Carlos",
          service: "Corte",
          duration_minutes: 30,
          date: "2026-03-09",
          time: "09:00",
          staff_name: "Cadu",
          customer_phone: "11999999999",
          contact_delivery: "own",
        },
      ],
      last_booking: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.95 },
    entities: {
      people: [],
      attendee_names: ["Davi"],
      services: [{ name: "Barba", normalized_name: "barba" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:30" },
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "confirmar" },
  }
  const completedBooking = {
    attendee_name: "Davi",
    service: "Barba",
    service_names: ["Barba"],
    duration_minutes: 30,
    date: "2026-03-09",
    time: "09:30",
    staff_name: "Cadu",
    customer_phone: "11999999999",
    contact_delivery: "primary",
  }

  const plan = buildPostConfirmationPlan(context as any, snapshot as any, completedBooking as any)
  assertEquals(plan.outbound_notifications, [])
  assertEquals(plan.calendar_targets, ["Carlos", "Davi"])
})

Deno.test("deriveBookingContext exposes primary contact reuse option only for additional bookings", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const standaloneContext = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
      },
    }),
  }
  const additionalContext = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      pending_additional_booking: true,
      completed_bookings: [{ attendee_name: "Carlos" }],
      slots: {
        attendee_name: "Davi",
        service: "Corte",
        date: "2026-03-09",
        time: "09:30",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.92 },
    entities: {
      people: [],
      attendee_names: ["Davi"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:30" },
    },
    signals: {
      includes_self: false,
      additional_count: 1,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "confirmar" },
  }

  const standaloneBooking = deriveBookingContext(snapshot as any, standaloneContext as any)
  const additionalBooking = deriveBookingContext(snapshot as any, additionalContext as any)

  assertEquals(standaloneBooking.contact_options, ["So celular", "So email", "Celular e email"])
  assertEquals(additionalBooking.contact_options, [
    "So celular",
    "So email",
    "Celular e email",
    "Pular (usar contato do titular)",
  ])
})

Deno.test("deriveBookingContext marks contact as the missing step when booking data is otherwise complete", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.94 },
    entities: {
      people: [],
      attendee_names: ["Carlos"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:00" },
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "confirmar" },
  }

  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.missing_step, "contact")
  assertEquals(booking.has_contact, false)
})

Deno.test("deriveBookingContext nÃƒÂ£o trata includes_self como tendo attendee_name", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      slots: {
        // JÃƒÂ¡ tem serviÃƒÂ§o/data/hora, mas nÃƒÂ£o tem nome do cliente.
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
      },
    }),
  }

  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.94 },
    entities: {
      // includes_self significa "ÃƒÂ© para mim", mas nÃƒÂ£o fornece nome.
      people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
      attendee_names: [],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:00" },
    },
    signals: {
      includes_self: true,
      additional_count: 0,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "confirmar" },
  }

  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.missing_step, "attendee")
})

Deno.test("deriveBookingContext nÃƒÂ£o usa attendee placeholder como nome", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      slots: {
        // Estado jÃƒÂ¡ tem service/date/time; o modelo pode ter sugerido um placeholder no attendee.
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
      },
      pending_contact_field: "contact_preference",
    }),
  }

  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.94 },
    entities: {
      people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
      attendee_names: ["desconhecido"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:00" },
    },
    signals: {
      includes_self: true,
      additional_count: 0,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "o meu mesmo 11999999999" },
  }

  const booking = deriveBookingContext(snapshot as any, context as any)
  // Se o attendee veio como placeholder, nÃƒÂ£o deve contaminar attendee_name do estado.
  assertEquals(booking.slot_updates?.attendee_name, undefined)
})

Deno.test("deriveBookingContext nÃƒÂ£o usa tokens afirmativos como attendee_name (ex.: sim)", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      // O estado jÃƒÂ¡ tem o nome correto (Carlos).
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
      },
    }),
  }

  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.94 },
    entities: {
      people: [{ includes_self: false, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
      // O modelo/extraÃƒÂ§ÃƒÂ£o veio com "sim" como se fosse um nome (bug atual nos logs).
      attendee_names: ["sim"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:00" },
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
    },
    risks: { ambiguities: [], audience: { requires_confirmation: false, inferred_fit: true } },
    meta: { raw_user_message: "sim" },
  }

  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.current_attendee_name, "Carlos")
  assertEquals(booking.people_queue.includes("sim"), false)
})

Deno.test("deriveBookingContext: hint ask_contact nÃƒÂ£o sobrescreve audience pendente", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({}),
  }
  const snapshot = {
    intents: { primary: "booking", booking: true, confidence: 0.5, source: "continuation" },
    entities: {
      people: [],
      attendee_names: ["Carlos"],
      services: [{ name: "-", normalized_name: "-" }],
      date: { raw_text: "Carlos", iso_date: "-" },
      time: { raw_text: "Carlos", hhmm: "NaN:00" },
    },
    signals: {
      includes_self: false,
      next_question_hint: "ask_contact",
    },
    risks: {
      audience: { requires_confirmation: true, reason: "audience_ambiguous", inferred_fit: null },
      ambiguities: ["audience_ambiguous"],
    },
    meta: { raw_user_message: "Carlos" },
  }
  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.missing_step, "audience")
})

Deno.test("deriveBookingContext: hint ask_contact nÃƒÂ£o pula time ainda faltando", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      audience_confirmed: true,
      slots: { attendee_name: "Carlos", service: "Corte", date: "hoje" },
    }),
  }
  const snapshot = {
    intents: { primary: "booking", booking: true, confidence: 0.5, source: "continuation" },
    entities: {
      attendee_names: ["Carlos"],
      services: [{ name: "Corte" }],
      date: { iso_date: "hoje", raw_text: "Sim" },
      time: null,
    },
    signals: {
      next_question_hint: "ask_contact",
      includes_self: false,
    },
    risks: { audience: { requires_confirmation: false, inferred_fit: true }, ambiguities: [] },
    meta: { continuation: { kind: "audience_confirmation" }, raw_user_message: "Sim" },
  }
  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.missing_step, "time")
})

Deno.test("deriveBookingContext: texto com hoje forÃƒÂ§a data hoje (nÃƒÂ£o iso errado da IA)", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      slots: { attendee_name: "Carlos", service: "Corte" },
    }),
  }
  const snapshot = {
    intents: { primary: "booking", booking: true, confidence: 0.9 },
    entities: {
      people: [],
      attendee_names: ["Carlos"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { raw_text: "tem ainda pra hoje? As 16:20?", iso_date: "2026-03-19" },
      time: { raw_text: "tem ainda pra hoje? As 16:20?", hhmm: "16:20" },
    },
    signals: { includes_self: true, availability_check: false },
    risks: { audience: { requires_confirmation: false, inferred_fit: true }, ambiguities: [] },
    meta: { raw_user_message: "tem ainda pra hoje? As 16:20?" },
  }
  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.slot_updates?.date, "hoje")
  assertEquals(booking.slot_updates?.time, "16:20")
  assertEquals(booking.has_date, true)
  assertEquals(booking.has_time, true)
})

Deno.test("inferDeterministicBookingHints reconhece pedido de disponibilidade para hoje ÃƒÂ s 14", () => {
  const hints = inferDeterministicBookingHints("quero fazer um agendamento, tem vaga para hoje as 14?")
  assertEquals(hints.booking_intent, true)
  assertEquals(hints.includes_self, true)
  assertEquals(hints.time, "14:00")
  assertEquals(hints.needs_availability_check, true)
})

Deno.test("parseTime nÃƒÂ£o trata telefone como horÃƒÂ¡rio", () => {
  assertEquals(parseTime("pode ser o whats: 11978784555"), null)
})

Deno.test("inferContactPreferenceSignal detects primary contact reuse during contact step", () => {
  const signal = inferContactPreferenceSignal(
    "usa o mesmo contato",
    {
      state: createBaseState({
        pending_contact_field: "contact_preference",
        last_action_options: [
          "So celular",
          "So email",
          "Celular e email",
          "Pular (usar contato do titular)",
        ],
      }),
    } as any,
    "contact"
  )

  assertEquals(signal, "skip_primary")
})

Deno.test("inferCalendarResponseSignal detects calendar accept and decline from calendar prompt replies", () => {
  const state = createBaseState({
    pending_calendar_offer: true,
    last_action_options: ["Adicionar no calendÃƒÂ¡rio", "NÃƒÂ£o, obrigado"],
  })

  assertEquals(inferCalendarResponseSignal("1", { state } as any), "accept")
  assertEquals(inferCalendarResponseSignal("nao, obrigado", { state } as any), "decline")
})

Deno.test("resolvePrimaryIntent prioritizes calendar response continuation over generic intents", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const result = resolvePrimaryIntent(
    "Adicionar no calendÃƒÂ¡rio",
    brain,
    null,
    null,
    "calendar_response"
  )

  assertEquals(result.primary, "fallback")
  assertEquals(result.source, "continuation")
})


Deno.test("deriveBookingContext treats snapshot contact preference as completed contact step", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      pending_additional_booking: true,
      completed_bookings: [{ attendee_name: "Carlos" }],
      slots: {
        attendee_name: "Davi",
        service: "Corte",
        date: "2026-03-09",
        time: "09:30",
        staff_name: "Cadu",

      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.95 },
    entities: {
      people: [],
      attendee_names: ["Davi"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:30" },
    },
    signals: {
      includes_self: false,
      additional_count: 1,
      sequence_request: false,
      contact_preference: "skip_primary",
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "usa o mesmo contato" },
  }

  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.has_contact, true)
  assertEquals(booking.missing_step, "confirm")
})

Deno.test("deriveBookingContext preserves hinted active step when the slot is still unresolved", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.83, source: "continuation" },
    entities: {
      people: [{ name: "Carlos", confidence: 0.85 }],
      attendee_names: ["Carlos"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
      next_question_hint: "ask_date_preference",
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "pode ser" },
  }

  const booking = deriveBookingContext(snapshot as any, context as any)
  assertEquals(booking.missing_step, "date")
})

Deno.test("buildPostConfirmationPlan emits outbound notification for secondary attendee with own contact", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      completed_bookings: [
        {
          attendee_name: "Carlos",
          service: "Corte",
          duration_minutes: 30,
          date: "2026-03-09",
          time: "09:00",
          staff_name: "Cadu",
          customer_phone: "11999999999",
          contact_delivery: "own",
        },
      ],
      last_booking: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.95 },
    entities: {
      people: [],
      attendee_names: ["Davi"],
      services: [{ name: "Barba", normalized_name: "barba" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:30" },
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "confirmar" },
  }
  const completedBooking = {
    attendee_name: "Davi",
    service: "Barba",
    service_names: ["Barba"],
    duration_minutes: 30,
    date: "2026-03-09",
    time: "09:30",
    staff_name: "Cadu",
    customer_phone: "11888888888",
    contact_delivery: "own",
  }

  const plan = buildPostConfirmationPlan(context as any, snapshot as any, completedBooking as any)
  assertEquals(plan.outbound_notifications?.length, 1)
  assertEquals(plan.outbound_notifications?.[0]?.attendee_name, "Davi")
})

Deno.test("formatSemanticActionOptions preserves raw options on web_simulator", () => {
  const semantic = {
    context: { channel: "web_simulator" },
    decision: { channel_hints: { prefer_numbered_options: true } },
  }
  const formatted = formatSemanticActionOptions(semantic as any, ["Corte", "Barba"])
  assertEquals(formatted, ["Corte", "Barba"])
})

Deno.test("formatSemanticActionOptions numbers options on whatsapp when hints allow numbering", () => {
  const semantic = {
    context: { channel: "whatsapp" },
    decision: { channel_hints: { prefer_numbered_options: true } },
  }
  const formatted = formatSemanticActionOptions(semantic as any, ["Corte", "Barba"])
  assertEquals(formatted, ["1 - Corte", "2 - Barba"])
})

Deno.test("formatSemanticActionOptions keeps raw options on whatsapp when numbering is disabled", () => {
  const semantic = {
    context: { channel: "whatsapp" },
    decision: { channel_hints: { prefer_numbered_options: false } },
  }
  const formatted = formatSemanticActionOptions(semantic as any, ["So celular", "So email"])
  assertEquals(formatted, ["So celular", "So email"])
})

Deno.test("buildSemanticResult keeps render hints while merging formatted action options", () => {
  const result = buildSemanticResult(
    createBaseState(),
    {
      context: { channel: "whatsapp" },
      decision: { channel_hints: { prefer_numbered_options: true }, slot_updates: {} },
      execution: null,
    } as any,
    {
      message: "Qual serviÃƒÂ§o vocÃƒÂª gostaria?",
      action_options: ["Corte", "Barba"],
      render_hints: { service_multi_select: true },
    }
  )
  assertEquals(result.action_options, ["1 - Corte", "2 - Barba"])
  assertEquals(result.state.last_action_options, ["1 - Corte", "2 - Barba"])
  assertEquals(result.render_hints, { service_multi_select: true })
})

Deno.test("renderBooking reports outbound notifications after final confirmation", async () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const semantic = {
    business_brain: brain,
    context: {
      channel: "web_simulator",
      history: [],
      sender_display_name: "Cadu",
      state: createBaseState({
        completed_bookings: [
          {
            attendee_name: "Carlos",
            service: "Corte",
            duration_minutes: 30,
            date: "2026-03-09",
            time: "09:00",
            staff_name: "Cadu",
            customer_phone: "11999999999",
          },
        ],
      }),
    },
    snapshot: {
      intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.97 },
      entities: {
        people: [],
        attendee_names: ["Davi"],
        services: [{ name: "Barba", normalized_name: "barba" }],
        date: { iso_date: "2026-03-09" },
        time: { hhmm: "09:30" },
      },
      signals: {
        includes_self: false,
        additional_count: 0,
        sequence_request: false,
      },
      risks: {
        audience: {
          requires_confirmation: true,
          blocked: false,
          reason: "audience_needs_confirmation",
          inferred_fit: null,
        },
        ambiguities: [],
      },
      meta: { raw_user_message: "confirmar" },
    },
    decision: {
      action: "confirm_booking",
      reason: "booking_ready_for_confirmation",
      confidence: 0.97,
      slot_updates: {
        attendee_name: "Davi",
        service: "Barba",
        date: "2026-03-09",
        time: "09:30",
      },
    },
    execution: {
      metadata: {
        completed_booking: {
          attendee_name: "Davi",
          service: "Barba",
          service_names: ["Barba"],
          date: "2026-03-09",
          time: "09:30",
        },
        post_confirmation_plan: {
          has_more_people: false,
          outbound_notifications: [{ attendee_name: "Davi", phone: "11888888888" }],
        },
      },
    },
  }

  const rendered = await renderBooking(semantic as any)
  assertEquals((rendered.action_options || []).map((value) => normalizeAssertText(value)), ["adicionar no calendario", "nao, obrigado"])
  assertEquals(
    normalizeAssertText(rendered.message).includes("via whatsapp"),
    false
  )
})

Deno.test("planSequentialBooking respects total duration before suggesting next slot", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const state = createBaseState({
    booked_slots: {
      cadu: {
        "2026-03-09": ["09:00", "09:30"],
      },
    },
  })
  const anchorBooking = {
    attendee_name: "Carlos",
    service: "Corte, Barba",
    service_names: ["Corte", "Barba"],
    duration_minutes: 60,
    date: "2026-03-09",
    time: "09:00",
    staff_name: "Cadu",
  }

  const suggestion = planSequentialBooking(brain as any, state as any, anchorBooking as any, "Corte")
  assertEquals(suggestion.available, true)
  assertEquals(suggestion.suggested_time, "10:00")
  assertEquals(suggestion.suggested_staff_name, "Cadu")
})

Deno.test("applySemanticPolicies blocks incompatible audience requests", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState(),
  }
  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.9 },
    entities: {
      people: [{ relation: "esposa", audience_hint: "woman" }],
      attendee_names: [],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
    },
    risks: {
      audience: {
        requires_confirmation: true,
        blocked: true,
        reason: "person_outside_audience",
        inferred_fit: false,
      },
      ambiguities: [],
    },
    meta: { raw_user_message: "quero agendar um corte feminino para minha esposa" },
  }

  const policy = applySemanticPolicies(snapshot as any, context as any)
  assertEquals(policy.should_clarify, true)
  assertEquals(policy.adjusted_snapshot.risks.audience.blocked, true)
  if (!normalizeAssertText(policy.clarification_prompt || "").includes(normalizeAssertText("atendemos"))) {
    throw new Error("Expected natural audience restriction prompt")
  }
})

Deno.test("applySemanticPolicies asks clarification for ambiguous audience fit", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState(),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.9 },
    entities: {
      people: [{ includes_self: true, relation: "self", audience_hint: "unknown" }],
      attendee_names: [],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: null,
      time: null,
    },
    signals: {
      includes_self: true,
      additional_count: 1,
      sequence_request: false,
    },
    risks: {
      audience: {
        requires_confirmation: true,
        blocked: false,
        reason: "audience_ambiguous",
        inferred_fit: null,
      },
      ambiguities: [],
    },
    meta: { raw_user_message: "quero agendar pra mim e meu irmao" },
  }

  const policy = applySemanticPolicies(snapshot as any, context as any)
  assertEquals(policy.should_clarify, false)
  assertEquals(policy.adjusted_snapshot.risks.audience.requires_confirmation, true)
})

Deno.test("decideNextSemanticAction redirects out-of-scope service requests to the configured service list", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain({
      ...createBaseConfig(),
      lead_policy: { reject_unlisted_services: true },
    } as any),
    state: createBaseState(),
  }
  const snapshot = {
    intents: { primary: "fallback", secondary: [], booking: false, confidence: 0.82, source: "unified_ai" },
    entities: {
      people: [],
      attendee_names: [],
      services: [],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "quero tirar meu irmao da cadeia" },
  }

  const decision = decideNextSemanticAction(snapshot as any, context as any)
  assertEquals(decision.action, "reply_service_list")
  assertEquals(decision.reason, "service_out_of_scope_redirect")
})

Deno.test("decideNextSemanticAction asks attendee before audience when booking is still generic", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState(),
  }
  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.9 },
    entities: {
      people: [],
      attendee_names: [],
      services: [],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
    },
    risks: { ambiguities: ["missing_attendee", "missing_service"] },
    meta: { raw_user_message: "quero agendar" },
  }

  const decision = decideNextSemanticAction(snapshot as any, context as any)
  assertEquals(decision.action, "ask_attendee_name")
})

Deno.test("buildSemanticClarificationDecision preserves clarification output", () => {
  const decision = buildSemanticClarificationDecision({
    reason: "audience_blocked",
    next_question: "Preciso confirmar se voces se encaixam nesse atendimento.",
    confidence: 0.81,
  })

  assertEquals(decision.action, "ask_clarification")
  assertEquals(decision.reason, "audience_blocked")
  assertEquals(decision.next_question, "Preciso confirmar se voces se encaixam nesse atendimento.")
  assertEquals(decision.confidence, 0.81)
  assertEquals(decision.channel_hints, {
    prefer_numbered_options: false,
    prefer_multi_select: false,
  })
})

Deno.test("buildSemanticTurnContext keeps runtime metadata and defaults history", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const context = buildSemanticTurnContext({
    channel: "whatsapp",
    sender_display_name: "Cadu",
    session_id: "session-1",
    sender_id: "sender-1",
    state: createBaseState(),
    business_brain: brain,
  })

  assertEquals(context.channel, "whatsapp")
  assertEquals(context.sender_display_name, "Cadu")
  assertEquals(context.session_id, "session-1")
  assertEquals(context.sender_id, "sender-1")
  assertEquals(context.history, [])
})

Deno.test("applySemanticPolicies does not clarify deterministic greeting intents", () => {
  const context = buildSemanticTurnContext({
    channel: "web_simulator",
    history: [],
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState(),
  })

  const policy = applySemanticPolicies(
    {
      intents: { primary: "greeting", secondary: [], booking: false, confidence: 0.92 },
      entities: { people: [], attendee_names: [], services: [], quote_service: null, date: null, time: null },
      signals: { includes_self: false, additional_count: 0 },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "ola" },
    } as any,
    context as any
  )

  assertEquals(policy.should_clarify, false)
})

Deno.test("applySemanticPolicies does not clarify continuation-derived booking intents by generic low-confidence gate", () => {
  const context = buildSemanticTurnContext({
    channel: "web_simulator",
    history: [],
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState(),
  })

  const policy = applySemanticPolicies(
    {
      intents: {
        primary: "booking",
        secondary: ["audience_confirmation"],
        booking: true,
        confidence: 0.42,
        source: "continuation",
      },
      entities: {
        people: [{ includes_self: true, relation: "self", audience_hint: "unknown" }],
        attendee_names: [],
        services: [],
        quote_service: null,
        date: null,
        time: null,
      },
      signals: { includes_self: true, additional_count: 0 },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "sim, nos encaixamos" },
    } as any,
    context as any
  )

  assertEquals(policy.should_clarify, false)
})

Deno.test("resolveSemanticDecisionPipeline reuses policy clarification without executing handlers", () => {
  const context = buildSemanticTurnContext({
    channel: "web_simulator",
    state: createBaseState(),
    business_brain: buildBusinessBrain(createBaseConfig() as any),
  })
  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.78 },
    entities: {
      people: [{ relation: "esposa", audience_hint: "woman" }],
      attendee_names: [],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
    },
    risks: {
      audience: {
        requires_confirmation: true,
        blocked: true,
        reason: "person_outside_audience",
        inferred_fit: false,
      },
      ambiguities: [],
    },
    meta: { raw_user_message: "quero agendar para minha esposa" },
  }

  const { policy, decision, execution } = resolveSemanticDecisionPipeline(snapshot as any, context as any)
  assertEquals(policy.should_clarify, true)
  assertEquals(decision.action, "ask_clarification")
  assertEquals(execution, null)
  if (!decision.next_question?.includes("atendemos")) {
    throw new Error("Expected policy clarification to reuse natural audience restriction prompt")
  }
})

Deno.test("decideNextSemanticAction asks contact with primary reuse option for additional booking", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      pending_additional_booking: true,
      completed_bookings: [{ attendee_name: "Carlos" }],
      slots: {
        attendee_name: "Davi",
        service: "Corte",
        date: "2026-03-09",
        time: "09:30",
        staff_name: "Cadu",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.95 },
    entities: {
      people: [],
      attendee_names: ["Davi"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: { iso_date: "2026-03-09" },
      time: { hhmm: "09:30" },
    },
    signals: {
      includes_self: false,
      additional_count: 1,
      sequence_request: false,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "confirmar" },
  }

  const decision = decideNextSemanticAction(snapshot as any, context as any)
  assertEquals(decision.action, "ask_contact")
  assertEquals(decision.next_question, "ask_contact_preference")
  assertEquals(decision.action_options, [
    "So celular",
    "So email",
    "Celular e email",
    "Pular (usar contato do titular)",
  ])
})

Deno.test("decideNextSemanticAction reuses snapshot next_question_hint for the active booking step", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking", secondary: [], booking: true, confidence: 0.83, source: "continuation" },
    entities: {
      people: [{ name: "Carlos", confidence: 0.85 }],
      attendee_names: ["Carlos"],
      services: [{ name: "Corte", normalized_name: "corte" }],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
      sequence_request: false,
      next_question_hint: "ask_date_preference",
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "pode ser" },
  }

  const decision = decideNextSemanticAction(snapshot as any, context as any)
  assertEquals(decision.action, "ask_date")
  assertEquals(decision.next_question, "ask_date_preference")
})

Deno.test("decideNextSemanticAction reuses snapshot attendee hint for additional booking", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      pending_additional_booking: true,
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.87, source: "continuation" },
    entities: {
      people: [],
      attendee_names: [],
      services: [],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 1,
      sequence_request: true,
      next_question_hint: "ask_next_attendee_name",
    },
    risks: { ambiguities: ["missing_attendee"] },
    meta: { raw_user_message: "o outro tambem" },
  }

  const decision = decideNextSemanticAction(snapshot as any, context as any)
  assertEquals(decision.action, "ask_attendee_name")
  assertEquals(decision.next_question, "ask_next_attendee_name")
})

Deno.test("decideNextSemanticAction asks service with multi-select hint when sequence is enabled", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      pending_additional_booking: true,
      slots: {
        attendee_name: "Davi",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.94 },
    entities: {
      people: [],
      attendee_names: ["Davi"],
      services: [],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 1,
      sequence_request: true,
    },
    risks: { ambiguities: ["missing_service"] },
    meta: { raw_user_message: "o outro depois" },
  }

  const decision = decideNextSemanticAction(snapshot as any, context as any)
  assertEquals(decision.action, "ask_service")
  assertEquals(decision.channel_hints, {
    prefer_numbered_options: true,
    prefer_multi_select: true,
  })
})

Deno.test("decideNextSemanticAction offers sequence template when next attendee is ready", () => {
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    state: createBaseState({
      completed_bookings: [
        {
          attendee_name: "Carlos",
          service: "Corte",
          duration_minutes: 30,
          date: "2026-03-09",
          time: "09:00",
          staff_name: "Cadu",
        },
      ],
      pending_additional_booking: true,
      pending_template_choice: true,
      pending_attendee_queue: ["Davi"],
      slots: {
        attendee_name: "Davi",
      },
    }),
  }
  const snapshot = {
    intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.96 },
    entities: {
      people: [],
      attendee_names: ["Davi"],
      services: [],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 1,
      sequence_request: true,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "o outro depois" },
  }

  const decision = decideNextSemanticAction(snapshot as any, context as any)
  assertEquals(decision.action, "offer_sequence_template")
  assertEquals(decision.action_options, [
    "Mesmo dia e colaborador (proximo horario)",
    "Outro horario no mesmo dia",
    "Outro dia",
  ])
})

Deno.test("decideNextSemanticAction only offers calendar on closing when post-confirmation flag is active", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const baseSnapshot = {
    intents: { primary: "closing", secondary: [], booking: false, confidence: 0.91 },
    entities: {
      people: [],
      attendee_names: [],
      services: [],
      date: null,
      time: null,
    },
    signals: {
      includes_self: false,
      additional_count: 0,
    },
    risks: { ambiguities: [] },
    meta: { raw_user_message: "obrigado" },
  }

  const activeDecision = decideNextSemanticAction(baseSnapshot as any, {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      pending_calendar_offer: true,
      pending_final_confirmation: true,
      last_booking: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
      },
    }),
  } as any)
  const inactiveDecision = decideNextSemanticAction(baseSnapshot as any, {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      pending_calendar_offer: false,
      pending_final_confirmation: false,
    }),
  } as any)

  assertEquals(activeDecision.action, "offer_calendar")
  assertEquals(inactiveDecision.action, "reply_closing")
})

Deno.test("decideNextSemanticAction routes calendar prompt replies without generic fallback", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      pending_calendar_offer: true,
      pending_final_confirmation: false,
    }),
  }

  const acceptDecision = decideNextSemanticAction(
    {
      intents: { primary: "fallback", secondary: [], booking: false, confidence: 0.84 },
      entities: { people: [], attendee_names: [], services: [], date: null, time: null },
      signals: { includes_self: false, additional_count: 0, calendar_response: "accept" },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "sim, pode adicionar" },
    } as any,
    context as any
  )

  const declineDecision = decideNextSemanticAction(
    {
      intents: { primary: "fallback", secondary: [], booking: false, confidence: 0.84 },
      entities: { people: [], attendee_names: [], services: [], date: null, time: null },
      signals: { includes_self: false, additional_count: 0, calendar_response: "decline" },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "nao, obrigado" },
    } as any,
    context as any
  )

  assertEquals(acceptDecision.action, "reply_calendar_confirmed")
  assertEquals(declineDecision.action, "reply_calendar_declined")
})



Deno.test("getSemanticTimeOptions does not offer slots that overflow business closing for multi-service booking", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const state = createBaseState({
    slots: {
      attendee_name: "Alexandre",
      service: "Corte, Barba",
      date: "2026-03-26",
    },
    booked_slots: {},
  })

  const options = getSemanticTimeOptions(brain as any, state as any, {
    date: "2026-03-26",
    staff_name: "Cadu",
    service: "Corte, Barba",
  })

  if (options.includes("17:30")) {
    throw new Error(`Expected 17:30 to be unavailable for a 60-minute booking, but got: ${JSON.stringify(options)}`)
  }
  assertEquals(options.includes("17:00"), true)
})

Deno.test("buildSemanticResult sanitizes mojibake in rendered output", () => {
  const context = buildSemanticTurnContext({
    channel: "web_simulator",
    state: createBaseState(),
    business_brain: buildBusinessBrain(createBaseConfig() as any),
    history: [],
  })
  const semantic = {
    business_brain: context.business_brain,
    context,
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.9 },
      entities: { people: [], attendee_names: [], services: [], date: null, time: null },
      signals: { includes_self: true, additional_count: 0 },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "oi" },
    },
    decision: {
      action: "ask_audience_confirmation",
      reason: "test",
      confidence: 0.9,
    },
    execution: null,
  } as any

  const result = buildSemanticResult(createBaseState() as any, semantic, {
    message: "Para confirmar: aqui atendemos homens e crianças. Você se encaixa nesse perfil?",
    action_options: ["Sim, me encaixo", "Quero agendar amanhã"],
  })

  assertEquals(result.message.includes("crianças"), true)
  assertEquals(result.message.includes("Você"), true)
  assertEquals((result.action_options || [])[1], "Quero agendar amanhã")
})




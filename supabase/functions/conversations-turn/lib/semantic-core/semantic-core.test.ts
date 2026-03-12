// @ts-nocheck
import { buildBusinessBrain } from "./business-brain.ts"
import { buildDynamicPeopleQueue, deriveBookingContext } from "./booking-context.ts"
import { buildPostConfirmationPlan } from "./booking-lifecycle.ts"
import { decideNextSemanticAction } from "./decision-engine/index.ts"
import { planSequentialBooking } from "./sequence-planner.ts"
import { applySemanticPolicies } from "./policy-layer.ts"
import { renderBooking } from "./renderers/booking.ts"
import { buildSemanticResult, formatSemanticActionOptions } from "./renderers/shared.ts"
import { shouldDefaultExternalToSemanticCore, shouldUseSemanticCore } from "./runtime.ts"
import {
  buildSemanticClarificationDecision,
  buildSemanticTurnContext,
  resolveSemanticDecisionPipeline,
} from "./runtime-helpers.ts"
import { inferCalendarResponseSignal, inferContactPreferenceSignal } from "./turn-semantics.ts"

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(message || `Expected ${expectedJson} but got ${actualJson}`)
  }
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

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, Deno.env.get(key))
    if (value == null || value === "") Deno.env.delete(key)
    else Deno.env.set(key, value)
  }
  try {
    fn()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null || value === "") Deno.env.delete(key)
      else Deno.env.set(key, value)
    }
  }
}

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
    risks: { ambiguities: [] },
    meta: { raw_user_message: "quero agendar pro Carlos, Davi e Joao" },
  }

  const queue = buildDynamicPeopleQueue(snapshot as any, context as any)
  assertEquals(queue, ["Davi", "Joao"])
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
    last_action_options: ["Adicionar no calendario", "Nao, obrigado"],
  })

  assertEquals(inferCalendarResponseSignal("1", { state } as any), "accept")
  assertEquals(inferCalendarResponseSignal("nao, obrigado", { state } as any), "decline")
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
      message: "Qual servico voce gostaria?",
      action_options: ["Corte", "Barba"],
      render_hints: { service_multi_select: true },
    }
  )
  assertEquals(result.action_options, ["1 - Corte", "2 - Barba"])
  assertEquals(result.state.last_action_options, ["1 - Corte", "2 - Barba"])
  assertEquals(result.render_hints, { service_multi_select: true })
})

Deno.test("renderBooking reports outbound notifications after final confirmation", () => {
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
      risks: { ambiguities: [] },
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

  const rendered = renderBooking(semantic as any)
  assertEquals(rendered.action_options, ["Adicionar no calendario", "Nao, obrigado"])
  assertEquals(
    /Enviei a confirmacao/.test(rendered.message),
    true
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
    risks: { ambiguities: [] },
    meta: { raw_user_message: "quero agendar um corte feminino para minha esposa" },
  }

  const policy = applySemanticPolicies(snapshot as any, context as any)
  assertEquals(policy.should_clarify, true)
  assertEquals(policy.adjusted_snapshot.risks.audience.blocked, true)
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
    risks: { ambiguities: [] },
    meta: { raw_user_message: "quero agendar pra mim e meu irmao" },
  }

  const policy = applySemanticPolicies(snapshot as any, context as any)
  assertEquals(policy.should_clarify, false)
  assertEquals(policy.adjusted_snapshot.risks.audience.requires_confirmation, true)
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
    risks: { ambiguities: [] },
    meta: { raw_user_message: "quero agendar para minha esposa" },
  }

  const { policy, decision, execution } = resolveSemanticDecisionPipeline(snapshot as any, context as any)
  assertEquals(policy.should_clarify, true)
  assertEquals(decision.action, "ask_clarification")
  assertEquals(execution, null)
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
  assertEquals(inactiveDecision.action, "handoff_fallback")
})

Deno.test("decideNextSemanticAction routes calendar prompt replies without generic fallback", () => {
  const brain = buildBusinessBrain(createBaseConfig() as any)
  const context = {
    channel: "web_simulator",
    history: [],
    sender_display_name: "Cadu",
    business_brain: brain,
    state: createBaseState({
      last_action_options: ["Adicionar no calendario", "Nao, obrigado"],
      pending_calendar_offer: false,
      pending_final_confirmation: false,
    }),
  }

  const acceptDecision = decideNextSemanticAction(
    {
      intents: { primary: "fallback", secondary: [], booking: false, confidence: 0.84 },
      entities: { people: [], attendee_names: [], services: [], date: null, time: null },
      signals: { includes_self: false, additional_count: 0, calendar_response: "accept" },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "1" },
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

Deno.test("shouldUseSemanticCore enables global semantic core when no allowlists are configured", () => {
  withEnv(
    {
      CONVERSATION_TURN_ENGINE: "semantic_core",
      CONVERSATION_TURN_ENGINE_CHANNELS: undefined,
      CONVERSATION_TURN_ENGINE_SESSION_IDS: undefined,
      CONVERSATION_TURN_ENGINE_SENDER_IDS: undefined,
    },
    () => {
      assertEquals(
        shouldUseSemanticCore({
          channel: "whatsapp",
          sessionId: "whatsapp:5511999999999",
          senderId: "whatsapp:5511999999999",
        }),
        true
      )
    }
  )
})

Deno.test("shouldUseSemanticCore respects configured channel and sender allowlists", () => {
  withEnv(
    {
      CONVERSATION_TURN_ENGINE: "semantic_core",
      CONVERSATION_TURN_ENGINE_CHANNELS: "whatsapp",
      CONVERSATION_TURN_ENGINE_SESSION_IDS: undefined,
      CONVERSATION_TURN_ENGINE_SENDER_IDS: "whatsapp:5511950878863",
    },
    () => {
      assertEquals(
        shouldUseSemanticCore({
          channel: "whatsapp",
          sessionId: "whatsapp:5511950878863",
          senderId: "whatsapp:5511950878863",
        }),
        true
      )
      assertEquals(
        shouldUseSemanticCore({
          channel: "web_simulator",
          sessionId: "fixture-session",
          senderId: "web:fixture",
        }),
        false
      )
      assertEquals(
        shouldUseSemanticCore({
          channel: "whatsapp",
          sessionId: "whatsapp:5511972763228",
          senderId: "whatsapp:5511972763228",
        }),
        false
      )
    }
  )
})

Deno.test("shouldUseSemanticCore stays disabled when engine is legacy", () => {
  withEnv(
    {
      CONVERSATION_TURN_ENGINE: "legacy",
      CONVERSATION_TURN_ENGINE_CHANNELS: "whatsapp",
      CONVERSATION_TURN_ENGINE_SESSION_IDS: "whatsapp:5511950878863",
      CONVERSATION_TURN_ENGINE_SENDER_IDS: "whatsapp:5511950878863",
    },
    () => {
      assertEquals(
        shouldUseSemanticCore({
          channel: "whatsapp",
          sessionId: "whatsapp:5511950878863",
          senderId: "whatsapp:5511950878863",
        }),
        false
      )
    }
  )
})

Deno.test("shouldDefaultExternalToSemanticCore enables external cutover when engine is unset", () => {
  withEnv(
    {
      CONVERSATION_TURN_ENGINE: undefined,
      CONVERSATION_TURN_ENGINE_CHANNELS: undefined,
      CONVERSATION_TURN_ENGINE_SESSION_IDS: undefined,
      CONVERSATION_TURN_ENGINE_SENDER_IDS: undefined,
    },
    () => {
      assertEquals(shouldDefaultExternalToSemanticCore(), true)
    }
  )
})

Deno.test("shouldDefaultExternalToSemanticCore stays off when engine is explicitly legacy", () => {
  withEnv(
    {
      CONVERSATION_TURN_ENGINE: "legacy",
    },
    () => {
      assertEquals(shouldDefaultExternalToSemanticCore(), false)
    }
  )
})

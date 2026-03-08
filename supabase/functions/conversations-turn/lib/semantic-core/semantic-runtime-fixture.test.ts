// @ts-nocheck
import { runSemanticFixture, runSemanticFixtureSequence } from "./test-runtime.ts"

function assertIncludes(actual: string, expected: string, message?: string) {
  if (!String(actual || "").includes(expected)) {
    throw new Error(message || `Expected "${actual}" to include "${expected}"`)
  }
}

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
    establishment_address: {
      logradouro: "Rua Gasparino Lunardi",
      numero: "321",
      bairro: "Jardim das Flores",
      localidade: "Osasco",
      uf: "SP",
    },
    allow_sequence_booking: true,
    interaction_style: "hybrid",
    booking_services: [
      { name: "Corte", duration_minutes: 30, base_price: 50, description: "Corte de cabelo masculino" },
      { name: "Barba", duration_minutes: 30, base_price: 35, description: "Barba completa" },
    ],
    schedule: {
      days_of_week: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      start_time: "08:00",
      end_time: "18:00",
      interval_minutes: 30,
    },
    staff: [{ name: "Cadu", use_business_schedule: true }],
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

Deno.test("semantic runtime fixture answers FAQ with business address", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "faq", secondary: [], booking: false, confidence: 0.92 },
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
      risks: { ambiguities: [] },
      meta: { raw_user_message: "qual e o endereco de voces?" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_faq")
  assertIncludes(result.message, "Rua Gasparino Lunardi")
  assertIncludes(result.message, "Osasco")
})

Deno.test("semantic runtime fixture confirms booking and advances to next inferred attendee", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
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
      pending_additional_booking: true,
      completed_bookings: [],
      booked_slots: {},
    }),
    snapshot: {
      intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.96 },
      entities: {
        people: [],
        attendee_names: ["Carlos", "Davi"],
        services: [{ name: "Corte", normalized_name: "corte" }, { name: "Barba", normalized_name: "barba" }],
        date: { iso_date: "2026-03-09" },
        time: { hhmm: "09:00" },
      },
      signals: {
        includes_self: false,
        additional_count: 1,
        sequence_request: true,
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "confirmar" },
    } as any,
  })

  assertEquals(semantic.decision.action, "confirm_booking")
  assertIncludes(result.message, "Carlos")
  assertIncludes(result.message, "Davi")
  assertEquals(result.state.pending_additional_booking, true)
  assertEquals(result.state.slots.attendee_name, "Davi")
})

Deno.test("semantic runtime fixture offers sequence template for inferred next attendee", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      completed_bookings: [
        {
          attendee_name: "Carlos",
          service: "Corte, Barba",
          duration_minutes: 60,
          date: "2026-03-09",
          time: "09:00",
          staff_name: "Cadu",
        },
      ],
      pending_additional_booking: true,
      pending_attendee_queue: ["Davi"],
      pending_template_choice: true,
      slots: {
        attendee_name: "Davi",
      },
    }),
    snapshot: {
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
      risks: { ambiguities: [] },
      meta: { raw_user_message: "quero agendar o proximo logo depois" },
    } as any,
  })

  assertEquals(semantic.decision.action, "offer_sequence_template")
  assertIncludes(result.message, "Davi")
  assertIncludes(result.message, "logo apos")
})

Deno.test("semantic runtime fixture renders greeting fallback with business and contact name", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    sender_display_name: "Cadu",
    snapshot: {
      intents: { primary: "greeting", secondary: [], booking: false, confidence: 0.9 },
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
      meta: { raw_user_message: "opa, tudo bem?" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_greeting")
  assertIncludes(result.message, "Cadu")
  assertIncludes(result.message, "BarberShop")
})

Deno.test("semantic runtime fixture answers price with concrete configured value", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "price", secondary: [], booking: false, confidence: 0.93 },
      entities: {
        people: [],
        attendee_names: [],
        services: [{ name: "Barba", normalized_name: "barba" }],
        date: null,
        time: null,
      },
      signals: {
        includes_self: false,
        additional_count: 0,
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "quanto custa a barba?" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_price")
  assertIncludes(result.message, "Barba")
  assertIncludes(result.message, "R$ 35")
})

Deno.test("semantic runtime fixture answers service detail with configured description", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "service_detail", secondary: [], booking: false, confidence: 0.92 },
      entities: {
        people: [],
        attendee_names: [],
        services: [{ name: "Corte", normalized_name: "corte" }],
        date: null,
        time: null,
      },
      signals: {
        includes_self: false,
        additional_count: 0,
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "como funciona o corte?" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_service_detail")
  assertIncludes(result.message, "Corte")
  assertIncludes(result.message, "Corte de cabelo masculino")
})

Deno.test("semantic runtime fixture asks for another date when same_next sequence is unavailable", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      completed_bookings: [
        {
          attendee_name: "Carlos",
          service: "Corte, Barba",
          duration_minutes: 60,
          date: "2026-03-09",
          time: "17:00",
          staff_name: "Cadu",
        },
      ],
      pending_additional_booking: true,
      pending_attendee_queue: ["Davi"],
      last_template_options: [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
      ],
      slots: {
        attendee_name: "Davi",
        service: "Corte",
      },
      booked_slots: {
        cadu: {
          "2026-03-09": ["17:00", "17:30"],
        },
      },
    }),
    snapshot: {
      intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.95 },
      entities: {
        people: [],
        attendee_names: ["Davi"],
        services: [{ name: "Corte", normalized_name: "corte" }],
        date: null,
        time: null,
      },
      signals: {
        includes_self: false,
        additional_count: 1,
        sequence_request: true,
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "1" },
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_date")
  assertIncludes(result.message, "Nao encontrei um proximo horario livre")
})

Deno.test("semantic runtime fixture keeps raw action options for web_simulator", async () => {
  const { result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    channel: "web_simulator",
    snapshot: {
      intents: { primary: "service_list", secondary: [], booking: false, confidence: 0.9 },
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
      meta: { raw_user_message: "quais servicos voces fazem?" },
    } as any,
  })

  assertEquals(result.action_options, ["Corte", "Barba"])
})

Deno.test("semantic runtime fixture numbers action options for whatsapp", async () => {
  const { result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    channel: "whatsapp",
    snapshot: {
      intents: { primary: "service_list", secondary: [], booking: false, confidence: 0.9 },
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
      meta: { raw_user_message: "quais servicos voces fazem?" },
    } as any,
  })

  assertEquals(result.action_options, ["1 - Corte", "2 - Barba"])
})

Deno.test("semantic runtime fixture sequence keeps continuity after confirmation for inferred next attendee", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte, Barba",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
        customer_phone: "11999999999",
      },
      pending_attendee_queue: ["Davi"],
      pending_additional_booking: true,
      completed_bookings: [],
      booked_slots: {},
    }),
    channel: "web_simulator",
    turns: [
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.96 },
        entities: {
          people: [],
          attendee_names: ["Carlos", "Davi"],
          services: [{ name: "Corte", normalized_name: "corte" }, { name: "Barba", normalized_name: "barba" }],
          date: { iso_date: "2026-03-09" },
          time: { hhmm: "09:00" },
        },
        signals: {
          includes_self: false,
          additional_count: 1,
          sequence_request: true,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "confirmar" },
      } as any,
      {
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
        risks: { ambiguities: [] },
        meta: { raw_user_message: "quero o proximo logo depois" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "confirm_booking")
  assertEquals(outputs[0].result.state.slots.attendee_name, "Davi")
  assertEquals(outputs[1].semantic.decision.action, "offer_sequence_template")
  assertIncludes(outputs[1].result.message, "Davi")
})

Deno.test("semantic runtime fixture sequence keeps ask_service context after selecting same_next", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      completed_bookings: [
        {
          attendee_name: "Carlos",
          service: "Corte, Barba",
          duration_minutes: 60,
          date: "2026-03-09",
          time: "09:00",
          staff_name: "Cadu",
        },
      ],
      pending_additional_booking: true,
      pending_attendee_queue: ["Davi"],
      pending_template_choice: true,
      last_template_options: [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
      ],
      slots: {
        attendee_name: "Davi",
      },
    }),
    channel: "web_simulator",
    turns: [
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.95 },
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
        meta: { raw_user_message: "1" },
      } as any,
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.97 },
        entities: {
          people: [],
          attendee_names: ["Davi"],
          services: [{ name: "Corte", normalized_name: "corte" }, { name: "Barba", normalized_name: "barba" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: false,
          additional_count: 1,
          sequence_request: true,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "1,2" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_service")
  assertIncludes(outputs[0].result.message, "Davi")
  assertEquals(outputs[1].result.state.slots.service, "Corte, Barba")
  if (!outputs[1].result.state.slots.date && !outputs[1].result.state.slots.time) {
    throw new Error("Expected semantic sequence flow to carry date/time suggestion after selecting same_next services")
  }
})

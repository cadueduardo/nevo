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

Deno.test("semantic runtime fixture handles informational question before booking without losing booking continuity", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState(),
    channel: "web_simulator",
    sender_display_name: "Cadu",
    turns: [
      {
        intents: { primary: "price", secondary: [], booking: false, confidence: 0.93 },
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
        meta: { raw_user_message: "quanto custa o corte?" },
      } as any,
      {
        intents: { primary: "booking", secondary: ["booking_with_price"], booking: true, confidence: 0.96 },
        entities: {
          people: [],
          attendee_names: [],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: true,
          additional_count: 0,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "fechou, quero agendar entao" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "reply_price")
  assertIncludes(outputs[0].result.message, "R$ 50")
  assertEquals(outputs[1].semantic.decision.action, "ask_date")
  assertEquals(outputs[1].result.state.slots.service, "Corte")
})

Deno.test("semantic runtime fixture keeps sequence context after short affirmative reply", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
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
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.83 },
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
          next_question_hint: "ask_service_selection",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "pode ser" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_service")
  assertEquals(outputs[1].semantic.decision.action, "ask_service")
  assertIncludes(outputs[1].result.message, "Davi")
})

Deno.test("semantic runtime fixture recovers after same_next unavailable by asking for date on next turn", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
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
    channel: "web_simulator",
    turns: [
      {
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
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.86 },
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
          sequence_request: false,
          next_question_hint: "ask_date_preference",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "outro dia entao" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_date")
  assertIncludes(outputs[0].result.message, "Nao encontrei um proximo horario livre")
  assertEquals(outputs[1].semantic.decision.action, "ask_date")
})

Deno.test("semantic runtime fixture asks audience confirmation before continuing booking", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState(),
    channel: "web_simulator",
    turns: [
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.91 },
        entities: {
          people: [],
          attendee_names: [],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: true,
          additional_count: 1,
        },
        risks: {
          audience: {
            requires_confirmation: true,
            blocked: false,
            reason: "audience_needs_confirmation",
            prompt: "Atendemos homens e criancas a partir de 8 anos. Voces se encaixam?",
            inferred_fit: null,
          },
          ambiguities: [],
        },
        meta: { raw_user_message: "quero agendar pra mim e meu irmao" },
      } as any,
      {
        intents: { primary: "booking", secondary: ["audience_confirmation"], booking: true, confidence: 0.94 },
        entities: {
          people: [],
          attendee_names: [],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: true,
          additional_count: 1,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "sim, nos encaixamos" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_audience_confirmation")
  assertIncludes(outputs[0].result.message, "Atendemos homens e criancas")
  if (outputs[1].semantic.decision.action === "ask_audience_confirmation") {
    throw new Error("Expected semantic core to progress after audience confirmation")
  }
})

Deno.test("semantic runtime fixture keeps date selection context after short affirmative reply", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
      },
    }),
    channel: "web_simulator",
    turns: [
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.93 },
        entities: {
          people: [],
          attendee_names: ["Carlos"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: false,
          additional_count: 0,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "segunda" },
      } as any,
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.8 },
        entities: {
          people: [],
          attendee_names: ["Carlos"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: false,
          additional_count: 0,
          next_question_hint: "ask_date_preference",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "isso" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_date")
  assertEquals(outputs[1].semantic.decision.action, "ask_date")
})

Deno.test("semantic runtime fixture keeps inferred people queue across chained multi-booking confirmations", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      slots: {
        attendee_name: "Davi",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
        customer_phone: "11999999999",
      },
      pending_attendee_queue: ["Carlos", "Joao"],
      pending_additional_booking: true,
      completed_bookings: [],
      booked_slots: {},
    }),
    channel: "web_simulator",
    turns: [
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.97 },
        entities: {
          people: [],
          attendee_names: ["Davi", "Carlos", "Joao"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: { iso_date: "2026-03-09" },
          time: { hhmm: "09:00" },
        },
        signals: {
          includes_self: false,
          additional_count: 2,
          sequence_request: true,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "confirmar" },
      } as any,
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.94 },
        entities: {
          people: [],
          attendee_names: ["Carlos", "Joao"],
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
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.97 },
        entities: {
          people: [],
          attendee_names: ["Carlos", "Joao"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: { iso_date: "2026-03-09" },
          time: { hhmm: "09:30" },
        },
        signals: {
          includes_self: false,
          additional_count: 1,
          sequence_request: true,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "confirmar" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "confirm_booking")
  assertEquals(outputs[0].result.state.slots.attendee_name, "Carlos")
  assertEquals(outputs[1].semantic.decision.action, "offer_sequence_template")
  assertIncludes(outputs[1].result.message, "Carlos")
  assertEquals(outputs[2].semantic.decision.action, "confirm_booking")
  assertEquals(outputs[2].result.state.slots.attendee_name, "Joao")
})

Deno.test("semantic runtime fixture handles faq before chaotic multi-booking request with inferred names", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState(),
    channel: "web_simulator",
    sender_display_name: "Cadu",
    turns: [
      {
        intents: { primary: "faq", secondary: [], booking: false, confidence: 0.9 },
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
        meta: { raw_user_message: "onde voces ficam?" },
      } as any,
      {
        intents: { primary: "booking_sequence", secondary: ["booking_with_faq"], booking: true, confidence: 0.95 },
        entities: {
          people: [
            { name: "Davi", confidence: 0.9 },
            { name: "Carlos", confidence: 0.9 },
            { name: "Joao", confidence: 0.9 },
          ],
          attendee_names: ["Davi", "Carlos", "Joao"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: false,
          additional_count: 3,
          sequence_request: false,
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "os muleque davi, carlos e joao querem cortar o cabelo ai" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "reply_faq")
  assertIncludes(outputs[0].result.message, "Rua Gasparino Lunardi")
  assertEquals(outputs[1].semantic.decision.action, "ask_date")
  assertEquals(outputs[1].result.state.slots.attendee_name, "Davi")
  assertEquals(outputs[1].result.state.pending_attendee_queue, ["Carlos", "Joao"])
})

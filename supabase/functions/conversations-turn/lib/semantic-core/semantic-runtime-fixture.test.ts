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
    quote_services: [
      {
        id: "quote-1",
        agent_id: "agent-1",
        name: "Cortina",
        pricing_type: "area",
        variables_schema: [
          { key: "largura_cm", label: "Largura", required: true },
          { key: "altura_cm", label: "Altura", required: true },
        ],
        pricing_rules: { price_per_m2: 100 },
        external_variable_keys: ["largura_cm", "altura_cm"],
        keywords: ["cortina", "persiana"],
        active: true,
      },
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

Deno.test("semantic runtime fixture answers open business-context question without clarification fallback", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "faq", secondary: [], booking: false, confidence: 0.88 },
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
      meta: { raw_user_message: "oi, bom dia tudo bem? Como tÃ¡ o movimento aÃ­ hoje?" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_faq")
  if (/Pode me dar mais detalhes/i.test(result.message)) {
    throw new Error("Expected contextual answer instead of generic clarification fallback")
  }
})


Deno.test("semantic runtime fixture answers broad business-context small talk without clarification fallback", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "faq", secondary: [], booking: false, confidence: 0.86 },
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
      meta: { raw_user_message: "ol? como est?o as coisas por a??" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_faq")
  if (/Pode me dar mais detalhes/i.test(result.message)) {
    throw new Error("Expected business-context answer instead of generic clarification fallback")
  }
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
  assertIncludes(result.message, "logo após")
})

Deno.test("semantic runtime fixture offers primary contact reuse option for additional booking", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
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
      pending_additional_booking: true,
      pending_attendee_queue: [],
      slots: {
        attendee_name: "Davi",
        service: "Barba",
        date: "2026-03-09",
        time: "10:00",
        staff_name: "Cadu",
      },
    }),
    snapshot: {
      intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.94 },
      entities: {
        people: [],
        attendee_names: ["Davi"],
        services: [{ name: "Barba", normalized_name: "barba" }],
        date: { iso_date: "2026-03-09" },
        time: { hhmm: "10:00" },
      },
      signals: {
        includes_self: false,
        additional_count: 1,
        sequence_request: false,
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "usa o mesmo contato" },
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_contact")
  assertIncludes(result.message, "contato")
  assertEquals(
    result.action_options,
    ["So celular", "So email", "Celular e email", "Pular (usar contato do titular)"]
  )
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

Deno.test("semantic runtime fixture does not turn a short greeting into clarification", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "greeting", secondary: [], booking: false, confidence: 0.92 },
      entities: {
        people: [],
        attendee_names: [],
        services: [],
        quote_service: null,
        date: null,
        time: null,
      },
      signals: {
        includes_self: false,
        additional_count: 0,
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "ola" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_greeting")
  if (result.message.includes("Quero ter certeza de que entendi")) {
    throw new Error("Short greeting leaked into clarification prompt")
  }
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
  assertEquals(result.state.mode, undefined)
  assertEquals(result.state.pending_additional_booking, undefined)
  assertEquals(result.action_options, ["Quero agendar"])
})

Deno.test("semantic runtime fixture accepts free-text phone during contact step and advances booking", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      pending_contact_field: "contact_preference",
      slots: {
        attendee_name: "Cadu",
        service: "Corte",
      },
    }),
    sender_display_name: "Cadu",
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.94 },
      entities: {
        people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
        attendee_names: ["Cadu"],
        services: [{ name: "Corte", normalized_name: "corte" }],
        date: null,
        time: null,
      },
      signals: {
        includes_self: true,
        additional_count: 0,
        next_question_hint: "ask_contact_preference",
        contact_preference: "phone",
        contact_phone: "11972763228",
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "o meu e 11972763228" },
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_date")
  assertEquals(result.state.slots.customer_phone, "11972763228")
  assertEquals(result.state.contact_preference, "phone")
})

Deno.test("semantic runtime fixture answers generic price question without forcing booking state", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "price", secondary: [], booking: false, confidence: 0.88 },
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
      meta: { raw_user_message: "quanto custa?" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_price")
  assertIncludes(result.message, "valores")
  assertEquals(result.state.mode, undefined)
  assertEquals(result.action_options, ["Corte", "Barba"])
})

Deno.test("semantic runtime fixture asks for quote measurements inside semantic core", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
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
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_quote_measurements")
  assertIncludes(result.message, "medidas")
  assertIncludes(result.message, "Cortina")
})

Deno.test("semantic runtime fixture replies external quote estimate inside semantic core", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "quote", secondary: [], booking: false, confidence: 0.92 },
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
        quote_slots: {
          largura_cm: 200,
          altura_cm: 250,
        },
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "quanto fica uma cortina 2 x 2,5?" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_quote_estimate")
  assertIncludes(result.message, "investimento costuma ficar entre")
  assertEquals(result.action_options, ["Sim, quero agendar", "Depois"])
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

Deno.test("semantic runtime fixture starts booking with service cited in the first phrase", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.95 },
      entities: {
        people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
        attendee_names: [],
        services: [{ name: "Corte", normalized_name: "corte" }],
        date: null,
        time: null,
      },
      signals: {
        includes_self: true,
        additional_count: 0,
        next_question_hint: "ask_date",
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "quero agendar um corte" },
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_date")
  assertEquals(result.state.slots.service, "Corte")
})

Deno.test("semantic runtime fixture handles greeting followed by booking without losing service context", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState(),
    channel: "web_simulator",
    sender_display_name: "Cadu",
    turns: [
      {
        intents: { primary: "greeting", secondary: [], booking: false, confidence: 0.92 },
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
        meta: { raw_user_message: "oi" },
      } as any,
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.96 },
        entities: {
          people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
          attendee_names: [],
          services: [{ name: "Barba", normalized_name: "barba" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: true,
          additional_count: 0,
          next_question_hint: "ask_date",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "quero agendar barba" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "reply_greeting")
  assertEquals(outputs[1].semantic.decision.action, "ask_date")
  assertEquals(outputs[1].result.state.slots.service, "Barba")
})

Deno.test("semantic runtime fixture asks attendee name when multi-booking request has no explicit names", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      pending_additional_booking: true,
    }),
    snapshot: {
      intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.94 },
      entities: {
        people: [],
        attendee_names: [],
        services: [{ name: "Corte", normalized_name: "corte" }],
        date: null,
        time: null,
      },
      signals: {
        includes_self: false,
        additional_count: 2,
        sequence_request: true,
      },
      risks: { ambiguities: ["missing_attendee"] },
      meta: { raw_user_message: "quero agendar para mais duas pessoas" },
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_attendee_name")
  assertIncludes(result.message, "primeira pessoa")
})

Deno.test("semantic runtime fixture asks attendee neutrally for generic single booking", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.94 },
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
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_attendee_name")
  assertIncludes(result.message, "Para quem será o agendamento")
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
  assertIncludes(result.message, "Não encontrei um próximo horário livre")
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

  assertEquals(result.action_options, undefined)
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

  assertEquals(result.action_options, undefined)
})

Deno.test("semantic runtime fixture redirects out-of-scope service requests with a natural service-list response", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: {
      ...createBaseConfig(),
      lead_policy: { reject_unlisted_services: true },
    } as any,
    state: createBaseState(),
    channel: "web_simulator",
    snapshot: {
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
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_service_list")
  assertIncludes(result.message, "não faz parte do que oferecemos")
  assertEquals(result.action_options, ["Corte", "Barba"])
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

Deno.test("semantic runtime fixture resolves fuzzy service alias when replying concrete price", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "price", secondary: [], booking: false, confidence: 0.88 },
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
      meta: { raw_user_message: "corte de cabelo" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_price")
  assertIncludes(result.message, "R$ 50")
})

Deno.test("semantic runtime fixture reuses continuation matched option to answer concrete price", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      last_prompt: "Posso te informar os valores certinhos e te ajudar a agendar. Qual servico voce quer consultar?",
      last_action_options: ["Corte", "Barba"],
    }),
    snapshot: {
      intents: { primary: "price", secondary: [], booking: false, confidence: 0.88, source: "continuation" },
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
      meta: {
        raw_user_message: "Corte de cabelo",
        continuation: {
          kind: "price_followup",
          matched_option: "Corte",
        },
      },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_price")
  assertIncludes(result.message, "R$ 50")
})

Deno.test("semantic runtime fixture answers concrete price when service pricing arrives as string config", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: {
      ...createBaseConfig(),
      booking_services: [
        { name: "Corte de cabelo", duration_minutes: "30", base_price: "50", description: "Corte masculino" },
        { name: "Barba", duration_minutes: "30", base_price: "35", description: "Barba completa" },
      ],
    } as any,
    state: createBaseState({
      last_prompt: "Posso te informar os valores certinhos e te ajudar a agendar. Qual serviÃƒÂ§o vocÃƒÂª quer consultar?",
      last_action_options: ["Corte de cabelo", "Barba"],
    }),
    snapshot: {
      intents: { primary: "price", secondary: [], booking: false, confidence: 0.88, source: "continuation" },
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
      meta: {
        raw_user_message: "Corte de cabelo",
        continuation: {
          kind: "price_followup",
          matched_option: "Corte de cabelo",
        },
      },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_price")
  assertIncludes(result.message, "R$ 50")
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

Deno.test("semantic runtime fixture keeps contact step context after short reply", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      pending_additional_booking: true,
      slots: {
        attendee_name: "Davi",
        service: "Corte",
        date: "2026-03-09",
        time: "09:30",
        staff_name: "Cadu",
      },
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
    channel: "web_simulator",
    turns: [
      {
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
          next_question_hint: "ask_contact_preference",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "usa o mesmo contato" },
      } as any,
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.8 },
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
          next_question_hint: "ask_contact_preference",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "esse mesmo" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_contact")
  assertEquals(outputs[1].semantic.decision.action, "ask_contact")
  assertEquals(
    outputs[1].result.action_options,
    ["So celular", "So email", "Celular e email", "Pular (usar contato do titular)"]
  )
})

Deno.test("semantic runtime fixture promotes primary contact reuse from user reply into confirmation", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      pending_additional_booking: true,
      slots: {
        attendee_name: "Davi",
        service: "Corte",
        date: "2026-03-09",
        time: "09:30",
        staff_name: "Cadu",
      },
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
    channel: "web_simulator",
    turns: [
      {
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
          next_question_hint: "ask_contact_preference",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "como vai ser o contato?" },
      } as any,
      {
        intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.9 },
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
          next_question_hint: "ask_contact_preference",
          contact_preference: "skip_primary",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "usa o mesmo contato" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_contact")
  assertEquals(outputs[1].semantic.decision.action, "confirm_booking")
  assertEquals(outputs[1].result.state.pending_additional_booking, false)
  assertEquals(outputs[1].result.state.contact_preference, undefined)
  assertIncludes(outputs[1].result.message, "Davi")
})

Deno.test("semantic runtime fixture offers sequence template after short continuation phrase", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
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
      pending_attendee_queue: ["Davi"],
      pending_template_choice: true,
      slots: {
        attendee_name: "Davi",
      },
    }),
    snapshot: {
      intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.9 },
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
    } as any,
  })

  assertEquals(semantic.decision.action, "offer_sequence_template")
  assertIncludes(result.message, "Davi")
  assertIncludes(result.message, "logo após")
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
  assertIncludes(outputs[0].result.message, "Não encontrei um próximo horário livre")
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
  assertIncludes(outputs[0].result.message.toLowerCase(), "atendemos")
  assertIncludes(outputs[0].result.message.toLowerCase(), "homens")
  if (outputs[1].semantic.decision.action === "ask_audience_confirmation") {
    throw new Error("Expected semantic core to progress after audience confirmation")
  }
})

Deno.test("semantic runtime fixture does not leak audience confirmation prompt keys to the user", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
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
          inferred_fit: null,
        },
        ambiguities: [],
      },
      meta: { raw_user_message: "quero agendar pra mim e meu irmao" },
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_audience_confirmation")
  assertIncludes(result.message.toLowerCase(), "atendemos")
  assertIncludes(result.message.toLowerCase(), "homens")
  if (result.message.includes("confirm_audience_fit_before_booking")) {
    throw new Error("Prompt key leaked to rendered audience confirmation message")
  }
})

Deno.test("semantic runtime fixture progresses after short audience confirmation reply", async () => {
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
        intents: { primary: "booking", secondary: ["audience_confirmation"], booking: true, confidence: 0.84 },
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
        meta: { raw_user_message: "sim" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_audience_confirmation")
  if (outputs[1].semantic.decision.action === "ask_audience_confirmation") {
    throw new Error("Expected semantic core to progress after short audience confirmation reply")
  }
})

Deno.test("semantic runtime fixture keeps booking continuity after audience confirmation even if the reply is semantically short", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState(),
    channel: "web_simulator",
    turns: [
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.92 },
        entities: {
          people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
          attendee_names: [],
          services: [],
          date: null,
          time: null,
        },
        signals: {
          includes_self: true,
          additional_count: 0,
        },
        risks: {
          audience: {
            requires_confirmation: true,
            blocked: false,
            reason: "audience_needs_confirmation",
            prompt: "Atendemos homens e criancas. Voces se encaixam nesse perfil?",
            inferred_fit: null,
          },
          ambiguities: [],
        },
        meta: { raw_user_message: "quero agendar" },
      } as any,
      {
        intents: { primary: "fallback", secondary: [], booking: false, confidence: 0.31 },
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
        meta: { raw_user_message: "sim, nos encaixamos" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_audience_confirmation")
  if (outputs[1].semantic.decision.action === "handoff_fallback") {
    throw new Error("Audience confirmation reply fell back instead of continuing booking")
  }
})


Deno.test("semantic runtime fixture preserves first-turn date/time through audience, attendee and contact steps", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState(),
    channel: "web_simulator",
    sender_display_name: "Carlos",
    turns: [
      {
        intents: { primary: "booking", secondary: ["availability_check"], booking: true, confidence: 0.92 },
        entities: {
          people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
          attendee_names: [],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: { raw_text: "quero agendar um corte para hoje as duas, tem horario disponivel?", iso_date: "hoje" },
          time: { raw_text: "quero agendar um corte para hoje as duas, tem horario disponivel?", hhmm: "14:00" },
        },
        signals: {
          includes_self: true,
          additional_count: 0,
          availability_check: true,
        },
        risks: {
          audience: {
            requires_confirmation: true,
            blocked: false,
            reason: "audience_needs_confirmation",
            prompt: "SÃ³ para confirmar: aqui atendemos homens e crianÃ§as. VocÃªs se encaixam nesse perfil?",
            inferred_fit: null,
          },
          ambiguities: [],
        },
        meta: { raw_user_message: "quero agendar um corte para hoje as duas, tem horario disponivel?" },
      } as any,
      {
        intents: { primary: "booking", secondary: ["audience_confirmation"], booking: true, confidence: 0.9 },
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
        meta: { raw_user_message: "Sim, nos encaixamos" },
      } as any,
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.9 },
        entities: {
          people: [{ name: "Carlos", confidence: 0.9 }],
          attendee_names: ["Carlos"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: true,
          additional_count: 0,
          next_question_hint: "ask_contact",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "Carlos" },
      } as any,
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.94 },
        entities: {
          people: [{ name: "Carlos", confidence: 0.9 }],
          attendee_names: ["Carlos"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: null,
          time: null,
        },
        signals: {
          includes_self: true,
          additional_count: 0,
          next_question_hint: "ask_contact_preference",
          contact_preference: "phone",
          contact_phone: "11978788888",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "11978788888" },
      } as any,
    ],
  })

  assertEquals(outputs[0].result.state.slots.date, "hoje")
  assertEquals(outputs[0].result.state.slots.time, "14:00")
  assertIncludes(outputs[3].result.message, "hoje")
  assertIncludes(outputs[3].result.message, "14:00")
  if (outputs[3].semantic.decision.action === "ask_date") {
    throw new Error("Contact step dropped first-turn date and regressed to ask_date")
  }
})
Deno.test("semantic runtime fixture blocks incompatible audience requests with natural triage", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.9 },
      entities: {
        people: [{ relation: "esposa", audience_hint: "woman", confidence: 0.86 }],
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
          reason: "target_audience_blocked",
          inferred_fit: false,
        },
        ambiguities: [],
      },
      meta: { raw_user_message: "oi, quero agendar um corte para minha esposa" },
    } as any,
  })

  assertEquals(semantic.decision.action, "ask_clarification")
  assertIncludes(result.message.toLowerCase(), "infelizmente")
  assertIncludes(result.message.toLowerCase(), "atendemos")
  assertIncludes(result.message.toLowerCase(), "homens")
})

Deno.test("semantic runtime fixture offers calendar after closing post confirmation", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
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
    snapshot: {
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
      meta: { raw_user_message: "obrigado, fechou" },
    } as any,
  })

  assertEquals(semantic.decision.action, "offer_calendar")
  assertIncludes(result.message, "calendário")
  assertEquals(result.action_options, ["Adicionar no calendário", "Não, obrigado"])
  assertEquals(result.state.pending_calendar_offer, false)
  assertEquals(result.state.pending_final_confirmation, false)
})

Deno.test("semantic runtime fixture does not re-offer calendar after the offer was already shown", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      pending_calendar_offer: true,
      pending_final_confirmation: true,
      last_booking: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
      },
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
    channel: "web_simulator",
    turns: [
      {
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
        meta: { raw_user_message: "obrigado, fechou" },
      } as any,
      {
        intents: { primary: "closing", secondary: [], booking: false, confidence: 0.82 },
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
        meta: { raw_user_message: "nao, obrigado" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "offer_calendar")
  assertEquals(outputs[0].result.state.pending_calendar_offer, false)
  assertEquals(outputs[1].semantic.decision.action, "reply_closing")
})

Deno.test("semantic runtime fixture answers calendar acceptance without generic fallback", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      last_action_options: ["Adicionar no calendário", "Não, obrigado"],
      pending_calendar_offer: false,
      pending_final_confirmation: false,
      last_booking: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
      },
    }),
    snapshot: {
      intents: { primary: "fallback", secondary: ["calendar_request"], booking: false, confidence: 0.83 },
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
        calendar_response: "accept",
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "1" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_calendar_confirmed")
  assertIncludes(result.message, "calendário")
})

Deno.test("semantic runtime fixture answers calendar decline without generic fallback", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      last_action_options: ["Adicionar no calendário", "Não, obrigado"],
      pending_calendar_offer: false,
      pending_final_confirmation: false,
      last_booking: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
      },
    }),
    snapshot: {
      intents: { primary: "fallback", secondary: ["calendar_request"], booking: false, confidence: 0.83 },
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
        calendar_response: "decline",
      },
      risks: { ambiguities: [] },
      meta: { raw_user_message: "nao, obrigado" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_calendar_declined")
  assertIncludes(result.message, "sem problemas")
})

Deno.test("semantic runtime fixture answers explicit closing command without clarification fallback", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    snapshot: {
      intents: { primary: "closing", secondary: [], booking: false, confidence: 0.9, source: "deterministic_fallback" },
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
      meta: { raw_user_message: "encerrar" },
    } as any,
  })

  assertEquals(semantic.decision.action, "reply_closing")
  if (result.message.includes("Pode me dar mais detalhes")) {
    throw new Error("Expected explicit closing to avoid clarification fallback")
  }
})

Deno.test("semantic runtime fixture confirms additional booking when primary contact reuse is already decided", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      pending_additional_booking: true,
      contact_preference: "skip_primary",
      slots: {
        attendee_name: "Davi",
        service: "Corte",
        date: "2026-03-09",
        time: "09:30",
        staff_name: "Cadu",
        customer_phone: "11999999999",
      },
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
      pending_attendee_queue: [],
    }),
    snapshot: {
      intents: { primary: "booking_sequence", secondary: [], booking: true, confidence: 0.97 },
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
    } as any,
  })

  assertEquals(semantic.decision.action, "confirm_booking")
  assertEquals(result.state.pending_additional_booking, false)
  assertEquals(result.state.pending_calendar_offer, true)
  assertEquals(result.state.contact_preference, undefined)
  assertIncludes(result.message, "Davi")
})

Deno.test("semantic runtime fixture clears contact preference after final standalone confirmation", async () => {
  const { semantic, result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState({
      contact_preference: "both",
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
        time: "09:00",
        staff_name: "Cadu",
        customer_phone: "11999999999",
        customer_email: "carlos@example.com",
      },
      completed_bookings: [],
    }),
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.97 },
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
    } as any,
  })

  assertEquals(semantic.decision.action, "confirm_booking")
  assertEquals(result.state.contact_preference, undefined)
  assertEquals(result.state.pending_calendar_offer, true)
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

Deno.test("semantic runtime fixture keeps date selection context after short sim reply", async () => {
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
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.78 },
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
        meta: { raw_user_message: "sim" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_date")
  assertEquals(outputs[1].semantic.decision.action, "ask_date")
})

Deno.test("semantic runtime fixture keeps time selection context after short sim reply", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      slots: {
        attendee_name: "Carlos",
        service: "Corte",
        date: "2026-03-09",
      },
    }),
    channel: "web_simulator",
    turns: [
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.92 },
        entities: {
          people: [],
          attendee_names: ["Carlos"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: { iso_date: "2026-03-09" },
          time: null,
        },
        signals: {
          includes_self: false,
          additional_count: 0,
          next_question_hint: "ask_time_preference",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "de tarde" },
      } as any,
      {
        intents: { primary: "booking", secondary: [], booking: true, confidence: 0.77 },
        entities: {
          people: [],
          attendee_names: ["Carlos"],
          services: [{ name: "Corte", normalized_name: "corte" }],
          date: { iso_date: "2026-03-09" },
          time: null,
        },
        signals: {
          includes_self: false,
          additional_count: 0,
          next_question_hint: "ask_time_preference",
        },
        risks: { ambiguities: [] },
        meta: { raw_user_message: "sim" },
      } as any,
    ],
  })

  assertEquals(outputs[0].semantic.decision.action, "ask_time")
  assertEquals(outputs[1].semantic.decision.action, "ask_time")
})

Deno.test("semantic runtime fixture keeps inferred people queue across chained multi-booking confirmations", async () => {
  const outputs = await runSemanticFixtureSequence({
    config: createBaseConfig() as any,
    initialState: createBaseState({
      contact_preference: "skip_primary",
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






Deno.test("semantic runtime fixture greets before first-turn audience confirmation for self booking", async () => {
  const { result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    channel: "web_simulator",
    sender_display_name: "Carlos",
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.91 },
      entities: {
        people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
        attendee_names: [],
        services: [],
        date: null,
        time: null,
      },
      signals: {
        includes_self: true,
        additional_count: 0,
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
      meta: { raw_user_message: "boa tarde, quero fazer um agendamento" },
    } as any,
  })

  assertIncludes(result.message.toLowerCase(), "aqui é")
  assertIncludes(result.message.toLowerCase(), "você se encaixa")
})

Deno.test("semantic runtime fixture uses singular audience option for self booking", async () => {
  const { result } = await runSemanticFixture({
    config: createBaseConfig() as any,
    state: createBaseState(),
    channel: "web_simulator",
    snapshot: {
      intents: { primary: "booking", secondary: [], booking: true, confidence: 0.91 },
      entities: {
        people: [{ includes_self: true, relation: "self", audience_hint: "unknown", confidence: 0.9 }],
        attendee_names: [],
        services: [],
        date: null,
        time: null,
      },
      signals: {
        includes_self: true,
        additional_count: 0,
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
      meta: { raw_user_message: "quero agendar" },
    } as any,
  })

  assertEquals(result.action_options, ["Sim, me encaixo", "Quero agendar"])
  if (result.message.toLowerCase().includes("vocês se encaixam")) {
    throw new Error("Expected singular audience prompt for self booking")
  }
})




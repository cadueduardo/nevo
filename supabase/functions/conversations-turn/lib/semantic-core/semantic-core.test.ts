// @ts-nocheck
import { buildBusinessBrain } from "./business-brain.ts"
import { buildDynamicPeopleQueue, deriveBookingContext } from "./booking-context.ts"
import { buildPostConfirmationPlan } from "./booking-lifecycle.ts"

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

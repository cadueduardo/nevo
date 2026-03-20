import { assertEquals, assertExists, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"

import { buildBusinessProfile, determineNextStep, generateNarrativeSummary, generateNarrativeSummaryPayload } from "./flow-manager.ts"

const menAndKidsAudience: Array<"men_only" | "kids_only"> = ["men_only", "kids_only"]

Deno.test("generateNarrativeSummaryPayload exposes canonical editable segments for onboarding review", () => {
  const data = {
    business_name: "Brutos",
    business_type: "barbearia",
    context: "both" as const,
    location_mode: "fixed" as const,
    establishment_address: {
      logradouro: "Rua Gasparino Lunardi",
      numero: "321",
      bairro: "Centro",
      localidade: "Osasco",
      uf: "SP",
    },
    services: [
      { name: "Corte", duration_minutes: 30, base_price: 50 },
      { name: "Barba", duration_minutes: 20, base_price: 35 },
    ],
    schedule: {
      days_of_week: ["monday", "tuesday", "wednesday"],
      start_time: "08:00",
      end_time: "18:00",
      breaks: [{ start: "12:00", end: "13:00" }],
      interval_minutes: 30,
    },
    tone_of_voice: "friendly" as const,
    interaction_style: "hybrid" as const,
    target_audience: {
      modes: menAndKidsAudience,
      kids_age_min: 5,
    },
    policies: {
      note: "Nao atender sem confirmacao previa.",
    },
    dynamic_variables: [{ key: "medidas", label: "Medidas", type: "text" }],
  }

  const payload = generateNarrativeSummaryPayload(data)

  assertExists(payload.text)
  assertEquals(payload.text, generateNarrativeSummary(data))
  assertEquals(
    payload.segments
      .filter((segment) => segment.kind === "editable")
      .map((segment) => segment.item_id),
    [
      "business_type",
      "business_name",
      "context",
      "establishment_address",
      "service_0",
      "service_duration_0",
      "service_price_0",
      "service_1",
      "service_duration_1",
      "service_price_1",
      "schedule",
      "tone_of_voice",
      "interaction_style",
      "target_audience",
      "policies",
    ],
  )
  assertEquals(payload.segments.map((segment) => segment.text).join(""), payload.text)
  assertStringIncludes(payload.text, "Corte")
  assertStringIncludes(payload.text, "valor de R$ 50")
  assertStringIncludes(payload.text, "Barba")
  assertStringIncludes(payload.text, "valor de R$ 35")
})

Deno.test("generateNarrativeSummaryPayload falls back to service area when business has no fixed address", () => {
  const data = {
    business_name: "Brabos Juridico",
    business_type: "escritorio de advocacia",
    context: "booking" as const,
    location_mode: "mobile" as const,
    service_area: {
      region: "Sao Paulo capital",
      coverage: "remoto",
    },
    services: [{ name: "Consulta", duration_minutes: 60 }],
  }

  const payload = generateNarrativeSummaryPayload(data)
  const editableSegments = payload.segments.filter((segment) => segment.kind === "editable")

  assertExists(editableSegments.find((segment) => segment.item_id === "service_area"))
  assertEquals(
    editableSegments.some((segment) => segment.item_id === "establishment_address"),
    false,
  )
})

Deno.test("generateNarrativeSummaryPayload uses canonical business_profile prices when legacy booking services are incomplete", () => {
  const payload = generateNarrativeSummaryPayload({
    business_name: "Brabos",
    business_type: "barbearia",
    context: "booking",
    booking_services: [
      { name: "Corte", duration_minutes: 30 },
      { name: "Barba", duration_minutes: 30 },
    ],
    business_profile: {
      services: [
        { name: "Corte", duration_minutes: 30, base_price: 45, bookable: true, catalog_visible: true },
        { name: "Barba", duration_minutes: 30, base_price: 35, bookable: true, catalog_visible: true },
      ],
    },
  })

  assertStringIncludes(payload.text, "Corte")
  assertStringIncludes(payload.text, "valor de R$ 45")
  assertStringIncludes(payload.text, "Barba")
  assertStringIncludes(payload.text, "valor de R$ 35")
})

Deno.test("buildBusinessProfile derives a canonical service list with visibility flags", () => {
  const profile = buildBusinessProfile({
    business_name: "Brabos",
    business_type: "barbearia",
    catalog_services: [
      { name: "Corte de cabelo", description: "Corte masculino" },
      { name: "Barba", description: "Barba completa" },
    ],
    booking_services: [
      { name: "Corte de cabelo", duration_minutes: 30, base_price: 50 },
    ],
    services: [
      { name: "Barba", duration_minutes: 20, base_price: 35 },
    ],
    sequence_eligible_services: ["Corte de cabelo"],
  })

  assertEquals(profile.business_name, "Brabos")
  assertEquals(profile.services?.length, 2)
  const corte = profile.services?.find((service) => service.name === "Corte de cabelo")
  const barba = profile.services?.find((service) => service.name === "Barba")
  assertEquals(corte?.bookable, true)
  assertEquals(corte?.catalog_visible, true)
  assertEquals(corte?.sequence_eligible, true)
  assertEquals(barba?.bookable, false)
  assertEquals(barba?.catalog_visible, true)
  assertEquals(barba?.base_price, 35)
})

Deno.test("determineNextStep uses narrative summary with service prices on final step", () => {
  const data: any = {
      business_name: "Brabos",
      business_type: "barbearia",
      context: "booking",
      catalog_services: [
        { name: "Corte de cabelo" },
        { name: "Barba" },
      ],
      catalog_descriptions_offer_done: true,
      services_confirmed: true,
      location_mode: "fixed",
      establishment_address: {
        logradouro: "Rua Gasparino Lunardi",
        numero: "321",
        bairro: "Centro",
        localidade: "Osasco",
        uf: "SP",
      },
      booking_services: [
        { name: "Corte de cabelo", duration_minutes: 15, base_price: 40 },
        { name: "Barba", duration_minutes: 15, base_price: 25 },
      ],
      schedule: {
        days_of_week: ["monday", "tuesday"],
        start_time: "08:00",
        end_time: "18:00",
        interval_minutes: 15,
      },
      schedule_breaks_configured: true,
      services_duration_configured: true,
      services_pricing_configured: true,
      sequence_booking_configured: true,
      staff_mode: "solo" as const,
      tone_of_voice: "friendly",
      handoff_mode: "conditional",
      policies: {},
      target_audience: {
        mode: "men_only",
      },
      interaction_style: "hybrid",
      holidays_skipped: true,
      closure_skipped: true,
      faq: [{ question: "Atende sem hora marcada?", answer: "Somente com agendamento." }],
    }

  const result = determineNextStep(
    data,
    "",
    {
      step: "summary",
      collected_data: {},
      missing_fields: [],
      context: "booking",
    },
  )

  assertEquals(result.step, "summary")
  assertStringIncludes(result.message, "Corte de cabelo")
  assertStringIncludes(result.message, "valor de R$ 40")
  assertStringIncludes(result.message, "Barba")
  assertStringIncludes(result.message, "valor de R$ 25")
})

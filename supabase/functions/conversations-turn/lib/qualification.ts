// @ts-nocheck
/** Helpers extraídos para reduzir duplicação em qualification e qualification_rejected. */
import { buildResult } from "./state.ts"
import { getCordialPrefix } from "./builders.ts"
import { getServiceWithPrice } from "./services.ts"
import { generateRejectionMessageWithAI } from "./builders.ts"
import { interpretAdditionalBookingsWithAI } from "./ai.ts"
import { buildServicePrompt } from "./builders.ts"
import { buildMultiBookingIntro } from "./builders.ts"
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"

/** Verifica se o match tem contexto suficiente para resposta de rejeição (qualquer serviço não definido na lista do negócio). */
export function hasMatchContext(match: { inferred_area?: string; confidence?: number }): boolean {
  return (
    Boolean(match.inferred_area) &&
    match.inferred_area !== "indefinido" &&
    (match.confidence ?? 0) >= 0.3
  )
}

export function hasAdditionalBookings(
  interpreted: { has_additional?: boolean; count?: number } | null | undefined,
  orchestrator?: { inferred_attendees?: string } | null
): boolean {
  return Boolean(
    interpreted?.has_additional ||
      (typeof interpreted?.count === "number" && interpreted.count > 0) ||
      orchestrator?.inferred_attendees === "multiple"
  )
}

export function applyAdditionalBookingState(
  state: SimulatorState,
  interpreted: { has_additional?: boolean; count?: number } | null | undefined,
  orchestrator?: { inferred_attendees?: string } | null
): void {
  if (!hasAdditionalBookings(interpreted, orchestrator)) return
  state.pending_additional_booking = true
  state.pending_attendee_name = true
  state.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
  state.expected_additional_count = state.pending_additional_count
}

export function handleShortDecline(config: SimulatorConfig, nextState: SimulatorState): SimulatorResult {
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  if (servicesList.length > 0) {
    const list = servicesList.join(", ")
    return buildResult(`Tudo bem! Se precisar, atendemos: ${list}. Fico à disposição.`, nextState)
  }
  return buildResult("Tudo bem! Se precisar de algo, fico à disposição.", nextState)
}

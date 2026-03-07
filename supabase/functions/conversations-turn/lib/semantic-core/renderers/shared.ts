// @ts-nocheck
import { buildResult } from "../../state.ts"
import type { SimulatorResult, SimulatorState } from "../../types.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"

export function mergeSemanticState(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult
): SimulatorState {
  const execution = semantic.execution
  const slotUpdates = execution?.slot_updates || semantic.decision.slot_updates || {}
  const statePatch = execution?.state_patch || {}
  return {
    ...baseState,
    ...statePatch,
    slots: {
      ...(baseState.slots || {}),
      ...(statePatch.slots || {}),
      ...slotUpdates,
    },
  }
}

export function buildSemanticResult(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult,
  message: string,
  actionOptions?: string[]
): SimulatorResult {
  const mergedState = mergeSemanticState(baseState, semantic)
  return buildResult(message, mergedState, actionOptions)
}

export function formatAudienceLabel(modes: string[] = []): string {
  if (modes.includes("men_only") && modes.includes("kids_only")) return "homens e criancas"
  if (modes.includes("men_only")) return "homens"
  if (modes.includes("women_only")) return "mulheres"
  if (modes.includes("kids_only")) return "criancas"
  return "todos os publicos"
}

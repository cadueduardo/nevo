// @ts-nocheck
import { buildResult } from "../../state.ts"
import type { SimulatorResult, SimulatorState } from "../../types.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"

export type RenderedSemanticMessage = { message: string; action_options?: string[] }

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

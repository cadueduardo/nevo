// @ts-nocheck
import type { SimulatorResult, SimulatorState } from "../../types.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"

export type RenderedSemanticMessage = { message: string; action_options?: string[] }

function numberActionOptions(options: string[]): string[] {
  return options.map((opt, idx) => {
    const value = String(opt || "").trim()
    if (!value) return value
    if (/^[a-z_]+\|/i.test(value)) return value
    if (/^\d+\s*-\s+/.test(value)) return value
    return `${idx + 1} - ${value}`
  })
}

export function formatSemanticActionOptions(
  semantic: SemanticRuntimeResult,
  actionOptions?: string[]
): string[] | undefined {
  if (!Array.isArray(actionOptions) || actionOptions.length === 0) return undefined
  if (semantic.context.channel === "whatsapp") {
    if (semantic.decision.channel_hints?.prefer_numbered_options === false) {
      return actionOptions
    }
    return numberActionOptions(actionOptions)
  }
  return actionOptions
}

export function mergeSemanticState(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult,
  formattedActionOptions?: string[]
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
    last_prompt: baseState.last_prompt,
    last_action_options: formattedActionOptions,
  }
}

export function buildSemanticResult(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult,
  message: string,
  actionOptions?: string[]
): SimulatorResult {
  const formattedActionOptions = formatSemanticActionOptions(semantic, actionOptions)
  const mergedState = mergeSemanticState(baseState, semantic, formattedActionOptions)
  return {
    message,
    state: {
      ...mergedState,
      last_prompt: message,
      last_action_options: formattedActionOptions,
    },
    action_options: formattedActionOptions,
  }
}

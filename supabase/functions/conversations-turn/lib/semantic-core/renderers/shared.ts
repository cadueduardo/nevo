// @ts-nocheck
import type { SimulatorResult, SimulatorState } from "../../types.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"

export type RenderedSemanticMessage = {
  message: string
  action_options?: string[]
  render_hints?: {
    service_multi_select?: boolean
  }
}

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

function compactDefined<T extends Record<string, unknown>>(value?: T | null): Partial<T> {
  const entries = Object.entries(value || {}).filter(([, entry]) => entry !== undefined)
  return Object.fromEntries(entries) as Partial<T>
}

export function mergeSemanticState(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult,
  formattedActionOptions?: string[]
): SimulatorState {
  const execution = semantic.execution
  const slotUpdates = compactDefined(execution?.slot_updates || semantic.decision.slot_updates || {})
  const statePatch = execution?.state_patch || {}
  return {
    ...baseState,
    ...statePatch,
    slots: {
      ...(baseState.slots || {}),
      ...slotUpdates,
      ...(statePatch.slots || {}),
    },
    last_prompt: baseState.last_prompt,
    last_action_options: formattedActionOptions,
  }
}


export function buildSemanticResult(
  baseState: SimulatorState,
  semantic: SemanticRuntimeResult,
  rendered: RenderedSemanticMessage
): SimulatorResult {
  const formattedActionOptions = formatSemanticActionOptions(semantic, rendered.action_options)
  const mergedState = mergeSemanticState(baseState, semantic, formattedActionOptions)
  const isAudienceStep = semantic.decision.action === "ask_audience_confirmation"
  const didConfirmAudience = semantic.snapshot?.meta?.continuation?.kind === "audience_confirmation"
  return {
    message: rendered.message,
    state: {
      ...mergedState,
      last_prompt: rendered.message,
      last_action_options: formattedActionOptions,
      pending_audience_confirmation: isAudienceStep ? true : false,
      ...(didConfirmAudience ? { audience_confirmed: true } : {}),
    },
    action_options: formattedActionOptions,
    render_hints: rendered.render_hints,
  }
}

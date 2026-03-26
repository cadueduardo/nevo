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

function tryRepairUtf8Mojibake(value: string): string {
  const suspiciousPattern = /(?:Ã|Â|â)/u
  if (!suspiciousPattern.test(value)) return value

  let current = value
  for (let i = 0; i < 3; i += 1) {
    if (!suspiciousPattern.test(current)) break
    try {
      const repaired = decodeURIComponent(escape(current))
      const originalNoise = (current.match(/(?:Ã|Â|â|�)/gu) || []).length
      const repairedNoise = (repaired.match(/(?:Ã|Â|â|�)/gu) || []).length
      if (repairedNoise >= originalNoise) break
      current = repaired
    } catch {
      break
    }
  }

  return current
}

function repairReplacementCharArtifacts(value: string): string {
  if (!value.includes("�")) return value
  return value
    .replace(/Voc�\?/g, "Você?")
    .replace(/voc�\?/g, "você?")
    .replace(/Voc�/g, "Você")
    .replace(/voc�/g, "você")
    .replace(/S�/g, "Só")
    .replace(/amanh�/gi, "amanhã")
    .replace(/calend�rio/gi, "calendário")
    .replace(/ap�s/gi, "após")
    .replace(/n�o/gi, "não")
    .replace(/ser�/gi, "será")
    .replace(/hor�rio/gi, "horário")
    .replace(/servi�o/gi, "serviço")
    .replace(/servi�os/gi, "serviços")
    .replace(/dispon�vel/gi, "disponível")
    .replace(/aqui �/gi, "aqui é")
    .replace(/� disposição/gi, "à disposição")
    .replace(/\b�s\b/gi, "às")
}

function sanitizeRenderedText(value?: string): string {
  const trimmed = String(value || "")
  if (!trimmed) return trimmed
  return repairReplacementCharArtifacts(tryRepairUtf8Mojibake(trimmed))
}

function sanitizeRenderedOptions(options?: string[]): string[] | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined
  return options.map((option) => sanitizeRenderedText(option))
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
  const sanitizedRendered = {
    ...rendered,
    message: sanitizeRenderedText(rendered.message),
    action_options: sanitizeRenderedOptions(rendered.action_options),
  }
  const formattedActionOptions = formatSemanticActionOptions(semantic, sanitizedRendered.action_options)
  const mergedState = mergeSemanticState(baseState, semantic, formattedActionOptions)
  const isAudienceStep = semantic.decision.action === "ask_audience_confirmation"
  const didConfirmAudience = semantic.snapshot?.meta?.continuation?.kind === "audience_confirmation"
  return {
    message: sanitizedRendered.message,
    state: {
      ...mergedState,
      last_prompt: sanitizedRendered.message,
      last_action_options: formattedActionOptions,
      pending_audience_confirmation: isAudienceStep ? true : false,
      ...(didConfirmAudience ? { audience_confirmed: true } : {}),
    },
    action_options: formattedActionOptions,
    render_hints: sanitizedRendered.render_hints,
  }
}

// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
} from "../types.ts"
import type { SimulatorState } from "../../types.ts"

type ExecutorBuildInput = {
  executor: string
  decision: SemanticDecisionResult
  state_patch?: Partial<SimulatorState>
  slot_updates?: Partial<SimulatorState["slots"]>
  action_options?: string[]
  metadata?: Record<string, unknown>
}

export function buildExecutorResult(input: ExecutorBuildInput): SemanticExecutorResult {
  const promptKey = input.decision.next_question || "handoff_or_clarify"
  return {
    executor: input.executor,
    state_patch: {
      ...(input.state_patch || {}),
      last_prompt: promptKey,
    },
    slot_updates: input.slot_updates,
    action_options: input.action_options,
    prompt_key: promptKey,
    metadata: input.metadata,
  }
}

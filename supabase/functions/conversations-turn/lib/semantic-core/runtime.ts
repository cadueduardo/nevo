// @ts-nocheck
import type { SimulatorConfig, SimulatorState } from "../types.ts"
import { buildBusinessBrain } from "./business-brain.ts"
import { decideNextSemanticAction } from "./decision-engine.ts"
import { executeSemanticDecision } from "./executors/index.ts"
import { buildTurnSemanticSnapshot } from "./turn-semantics.ts"
import type {
  BusinessBrain,
  SemanticChannel,
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"

export interface SemanticRuntimeInput {
  message: string
  channel: SemanticChannel
  config: SimulatorConfig
  state: SimulatorState
  history: Array<{ role: string; content: string }>
  sender_display_name?: string
}

export interface SemanticRuntimeResult {
  business_brain: BusinessBrain
  context: SemanticTurnContext
  snapshot: TurnSemanticSnapshot
  decision: SemanticDecisionResult
  execution: SemanticExecutorResult | null
}

export function shouldUseSemanticCore(
  opts: {
    forced?: boolean
    channel?: SemanticChannel
    state?: SimulatorState
  } = {}
): boolean {
  if (opts.forced === true) return true
  const envFlag = (Deno.env.get("CONVERSATION_TURN_ENGINE") || "").trim().toLowerCase()
  if (envFlag === "semantic_core") return true
  if (envFlag === "legacy") return false
  return false
}

export async function runSemanticCoreTurn(input: SemanticRuntimeInput): Promise<SemanticRuntimeResult> {
  const businessBrain = buildBusinessBrain(input.config)
  const context: SemanticTurnContext = {
    channel: input.channel,
    sender_display_name: input.sender_display_name,
    history: input.history || [],
    state: input.state,
    business_brain: businessBrain,
  }

  const snapshot = await buildTurnSemanticSnapshot(input.message, context)
  const decision = decideNextSemanticAction(snapshot, context)
  const execution = executeSemanticDecision(decision, snapshot, context)

  return {
    business_brain: businessBrain,
    context,
    snapshot,
    decision,
    execution,
  }
}

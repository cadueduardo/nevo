// @ts-nocheck
import type { SimulatorConfig } from "../types.ts"
import { buildBusinessBrain } from "./business-brain.ts"
import {
  logSemanticDecision,
  logSemanticExecution,
  logSemanticPolicy,
  logSemanticSnapshot,
} from "./logging.ts"
import { buildSemanticTurnContext, resolveSemanticDecisionPipeline } from "./runtime-helpers.ts"
import { buildTurnSemanticSnapshot } from "./turn-semantics.ts"
import type {
  BusinessBrain,
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
  session_id?: string
  sender_id?: string
}

export interface SemanticRuntimeResult {
  business_brain: BusinessBrain
  context: SemanticTurnContext
  snapshot: TurnSemanticSnapshot
  decision: SemanticDecisionResult
  execution: SemanticExecutorResult | null
}

export async function runSemanticCoreTurn(input: SemanticRuntimeInput): Promise<SemanticRuntimeResult> {
  const businessBrain = buildBusinessBrain(input.config)
  const context: SemanticTurnContext = buildSemanticTurnContext({
    channel: input.channel,
    sender_display_name: input.sender_display_name,
    session_id: input.session_id,
    sender_id: input.sender_id,
    history: input.history,
    state: input.state,
    business_brain: businessBrain,
  })

  const snapshot = await buildTurnSemanticSnapshot(input.message, context)
  logSemanticSnapshot(context, snapshot)
  const { policy, decision, execution } = resolveSemanticDecisionPipeline(snapshot, context)
  logSemanticPolicy(context, {
    should_clarify: policy.should_clarify,
    clarification_reason: policy.clarification_reason,
    clarification_prompt: policy.clarification_prompt,
    audience_risk: policy.adjusted_snapshot.risks?.audience,
  })
  logSemanticDecision(context, decision)
  logSemanticExecution(context, execution)

  return {
    business_brain: businessBrain,
    context,
    snapshot: policy.adjusted_snapshot,
    decision,
    execution,
  }
}

// @ts-nocheck
import type { SimulatorConfig, SimulatorState } from "../types.ts"
import { buildBusinessBrain } from "./business-brain.ts"
import { decideNextSemanticAction } from "./decision-engine.ts"
import { executeSemanticDecision } from "./executors/index.ts"
import { applySemanticPolicies } from "./policy-layer.ts"
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
  const policy = applySemanticPolicies(snapshot, context)
  const decision = policy.should_clarify
    ? {
        action: "ask_clarification",
        reason: policy.clarification_reason || "policy_clarification_required",
        confidence: policy.adjusted_snapshot.intents.confidence,
        next_question: policy.clarification_prompt || "clarify_intent",
        channel_hints: {
          prefer_numbered_options: false,
          prefer_multi_select: false,
        },
      }
    : decideNextSemanticAction(policy.adjusted_snapshot, context)
  const execution = policy.should_clarify
    ? null
    : executeSemanticDecision(decision, policy.adjusted_snapshot, context)

  return {
    business_brain: businessBrain,
    context,
    snapshot: policy.adjusted_snapshot,
    decision,
    execution,
  }
}

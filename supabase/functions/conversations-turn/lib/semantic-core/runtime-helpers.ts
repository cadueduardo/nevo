// @ts-nocheck
import { decideNextSemanticAction } from "./decision-engine/index.ts"
import { executeSemanticDecision } from "./executors/index.ts"
import { applySemanticPolicies } from "./policy-layer.ts"
import type {
  BusinessBrain,
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticPolicyOutcome,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "./types.ts"
import type { SimulatorState } from "../types.ts"

export function buildSemanticTurnContext(params: {
  channel: SemanticTurnContext["channel"]
  state: SimulatorState
  business_brain: BusinessBrain
  history?: Array<{ role: string; content: string }>
  sender_display_name?: string
  session_id?: string
  sender_id?: string
}): SemanticTurnContext {
  return {
    channel: params.channel,
    sender_display_name: params.sender_display_name,
    session_id: params.session_id,
    sender_id: params.sender_id,
    history: params.history || [],
    state: params.state,
    business_brain: params.business_brain,
  }
}

export function buildSemanticClarificationDecision(params: {
  confidence: number
  reason?: string
  next_question?: string
}): SemanticDecisionResult {
  return {
    action: "ask_clarification",
    reason: params.reason || "policy_clarification_required",
    confidence: params.confidence,
    next_question: params.next_question || "clarify_intent",
    channel_hints: {
      prefer_numbered_options: false,
      prefer_multi_select: false,
    },
  }
}

export function resolveSemanticDecisionPipeline(
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): {
  policy: SemanticPolicyOutcome
  decision: SemanticDecisionResult
  execution: SemanticExecutorResult | null
} {
  const policy = applySemanticPolicies(snapshot, context)
  const decision = policy.should_clarify
    ? buildSemanticClarificationDecision({
        confidence: policy.adjusted_snapshot.intents.confidence,
        reason: policy.clarification_reason,
        next_question: policy.clarification_prompt,
      })
    : decideNextSemanticAction(policy.adjusted_snapshot, context)
  const execution = policy.should_clarify
    ? null
    : executeSemanticDecision(decision, policy.adjusted_snapshot, context)
  return {
    policy,
    decision,
    execution,
  }
}

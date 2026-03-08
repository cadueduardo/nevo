// @ts-nocheck
import type { SimulatorConfig, SimulatorResult, SimulatorState } from "../types.ts"
import { buildBusinessBrain } from "./business-brain.ts"
import { decideNextSemanticAction } from "./decision-engine/index.ts"
import { executeSemanticDecision } from "./executors/index.ts"
import { applySemanticPolicies } from "./policy-layer.ts"
import { renderSemanticSimulatorResult } from "./renderers/index.ts"
import type { SemanticChannel, SemanticRuntimeResult, SemanticTurnContext, TurnSemanticSnapshot } from "./types.ts"

export async function runSemanticFixture(input: {
  config: SimulatorConfig
  state: SimulatorState
  snapshot: TurnSemanticSnapshot
  channel?: SemanticChannel
  history?: Array<{ role: string; content: string }>
  sender_display_name?: string
}): Promise<{ semantic: SemanticRuntimeResult; result: SimulatorResult }> {
  const businessBrain = buildBusinessBrain(input.config)
  const context: SemanticTurnContext = {
    channel: input.channel || "web_simulator",
    history: input.history || [],
    sender_display_name: input.sender_display_name,
    state: input.state,
    business_brain: businessBrain,
  }

  const policy = applySemanticPolicies(input.snapshot, context)
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

  const semantic: SemanticRuntimeResult = {
    business_brain: businessBrain,
    context,
    snapshot: policy.adjusted_snapshot,
    decision,
    execution,
  }
  const result = await renderSemanticSimulatorResult(input.state, semantic)
  return { semantic, result }
}

export async function runSemanticFixtureSequence(input: {
  config: SimulatorConfig
  initialState: SimulatorState
  channel?: SemanticChannel
  sender_display_name?: string
  history?: Array<{ role: string; content: string }>
  turns: TurnSemanticSnapshot[]
}): Promise<Array<{ semantic: SemanticRuntimeResult; result: SimulatorResult }>> {
  const outputs: Array<{ semantic: SemanticRuntimeResult; result: SimulatorResult }> = []
  let currentState = input.initialState
  let currentHistory = [...(input.history || [])]

  for (const snapshot of input.turns) {
    const output = await runSemanticFixture({
      config: input.config,
      state: currentState,
      snapshot,
      channel: input.channel,
      history: currentHistory,
      sender_display_name: input.sender_display_name,
    })
    outputs.push(output)
    currentHistory = [
      ...currentHistory,
      { role: "user", content: snapshot.meta?.raw_user_message || "" },
      { role: "assistant", content: output.result.message || "" },
    ]
    currentState = output.result.state
  }

  return outputs
}

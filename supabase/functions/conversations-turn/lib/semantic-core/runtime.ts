// @ts-nocheck
import type { SimulatorConfig, SimulatorState } from "../types.ts"
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

export function shouldDefaultExternalToSemanticCore(): boolean {
  const envFlag = (Deno.env.get("CONVERSATION_TURN_ENGINE") || "").trim().toLowerCase()
  return envFlag === ""
}

export function shouldUseSemanticCore(
  opts: {
    forced?: boolean
    channel?: SemanticChannel
    state?: SimulatorState
    sessionId?: string
    senderId?: string
  } = {}
): boolean {
  function parseAllowlist(name: string): string[] {
    return String(Deno.env.get(name) || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  }

  function matchesAllowlist(value: string | undefined, allowlist: string[]): boolean {
    if (allowlist.length === 0) return true
    if (!value) return false
    return allowlist.includes(String(value).trim().toLowerCase())
  }

  if (opts.forced === true) return true
  const envFlag = (Deno.env.get("CONVERSATION_TURN_ENGINE") || "").trim().toLowerCase()
  if (envFlag === "semantic_core") {
    const allowedChannels = parseAllowlist("CONVERSATION_TURN_ENGINE_CHANNELS")
    const allowedSessions = parseAllowlist("CONVERSATION_TURN_ENGINE_SESSION_IDS")
    const allowedSenders = parseAllowlist("CONVERSATION_TURN_ENGINE_SENDER_IDS")
    return (
      matchesAllowlist(opts.channel, allowedChannels) &&
      matchesAllowlist(opts.sessionId, allowedSessions) &&
      matchesAllowlist(opts.senderId, allowedSenders)
    )
  }
  if (envFlag === "legacy") return false
  return false
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

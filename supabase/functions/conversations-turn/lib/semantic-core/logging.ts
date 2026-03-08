// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult, SemanticTurnContext, TurnSemanticSnapshot } from "./types.ts"

type SemanticLogStage =
  | "snapshot"
  | "policy"
  | "decision"
  | "execution"
  | "render"
  | "fallback"

function isSemanticDebugEnabled(): boolean {
  const value = String(Deno.env.get("SEMANTIC_CORE_DEBUG") || "").trim().toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}

function buildLogEnvelope(context: Pick<SemanticTurnContext, "channel" | "session_id" | "sender_id">) {
  return {
    channel: context.channel,
    session_id: context.session_id,
    sender_id: context.sender_id,
  }
}

export function logSemanticSnapshot(context: SemanticTurnContext, snapshot: TurnSemanticSnapshot) {
  if (!isSemanticDebugEnabled()) return
  console.log(
    "[semantic-core] snapshot",
    JSON.stringify({
      ...buildLogEnvelope(context),
      intents: snapshot.intents,
      entities: snapshot.entities,
      signals: snapshot.signals,
      risks: snapshot.risks,
    })
  )
}

export function logSemanticPolicy(
  context: SemanticTurnContext,
  payload: {
    should_clarify: boolean
    clarification_reason?: string
    clarification_prompt?: string
    audience_risk?: unknown
  }
) {
  if (!isSemanticDebugEnabled()) return
  console.log(
    "[semantic-core] policy",
    JSON.stringify({
      ...buildLogEnvelope(context),
      ...payload,
    })
  )
}

export function logSemanticDecision(context: SemanticTurnContext, decision: SemanticDecisionResult) {
  if (!isSemanticDebugEnabled()) return
  console.log(
    "[semantic-core] decision",
    JSON.stringify({
      ...buildLogEnvelope(context),
      action: decision.action,
      reason: decision.reason,
      confidence: decision.confidence,
      next_question: decision.next_question,
      action_options: decision.action_options,
    })
  )
}

export function logSemanticExecution(context: SemanticTurnContext, execution: SemanticExecutorResult | null) {
  if (!isSemanticDebugEnabled()) return
  console.log(
    "[semantic-core] execution",
    JSON.stringify({
      ...buildLogEnvelope(context),
      executor: execution?.executor || null,
      prompt_key: execution?.prompt_key || null,
      state_patch: execution?.state_patch || null,
      slot_updates: execution?.slot_updates || null,
      action_options: execution?.action_options || null,
      metadata: execution?.metadata || null,
    })
  )
}

export function logSemanticRender(
  context: SemanticTurnContext,
  payload: {
    message: string
    action_options?: string[]
    fallback_reason?: string
  }
) {
  if (!isSemanticDebugEnabled()) return
  console.log(
    "[semantic-core] render",
    JSON.stringify({
      ...buildLogEnvelope(context),
      action_options: payload.action_options || [],
      fallback_reason: payload.fallback_reason,
      message_preview: String(payload.message || "").slice(0, 200),
    })
  )
}

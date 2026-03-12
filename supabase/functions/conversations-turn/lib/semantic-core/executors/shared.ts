// @ts-nocheck
import type {
  SemanticDecisionResult,
  SemanticExecutorResult,
  SemanticTurnContext,
  TurnSemanticSnapshot,
} from "../types.ts"
import type { SimulatorState } from "../../types.ts"
import { deriveBookingContext, shiftCurrentAttendeeFromQueue } from "../booking-context.ts"

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

export function buildBookingQueueState(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): {
  attendee_name?: string
  remaining_queue: string[]
} {
  const booking = deriveBookingContext(snapshot, context)
  const attendeeName = booking.current_attendee_name || decision.slot_updates?.attendee_name
  const queue = decision.semantic_people_queue || booking.people_queue || []
  return {
    attendee_name: attendeeName,
    remaining_queue: shiftCurrentAttendeeFromQueue(queue, attendeeName),
  }
}

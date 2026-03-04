// @ts-nocheck
/** Orquestrador dos early steps: ordem fixa, retorna o primeiro resultado não nulo. */
import type { SimulatorResult } from "../../types.ts"
import type { TurnPipelineContext } from "../../turn-context.ts"
import { runBypassSteps } from "./bypass.ts"
import { runAnytimeSteps } from "./anytime.ts"
import { runFinalizedStep } from "./finalized.ts"
import { runRejectAndFirstSteps } from "./reject-and-first.ts"

/** Executa bypass → anytime → finalized → reject-and-first; retorna o primeiro resultado não nulo. */
export async function runEarlySteps(ctx: TurnPipelineContext): Promise<SimulatorResult | null> {
  const early = await runBypassSteps(ctx)
  if (early) return early
  const anytime = await runAnytimeSteps(ctx)
  if (anytime) return anytime
  const finalized = await runFinalizedStep(ctx)
  if (finalized) return finalized
  return runRejectAndFirstSteps(ctx)
}

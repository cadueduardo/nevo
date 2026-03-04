// @ts-nocheck
/** Pipeline de fases para processamento de mensagens: executa fases em ordem e retorna no primeiro resultado não nulo. */

import type { SimulatorResult } from "./types.ts"

/**
 * Uma fase do pipeline: quando `when(ctx)` é verdadeiro, `run(ctx)` é executado.
 * Se `run` retornar valor não nulo, o pipeline retorna esse valor e para.
 */
export type Phase<T> = {
  when: (ctx: T) => boolean | Promise<boolean>
  run: (ctx: T) => Promise<SimulatorResult | null>
}

/**
 * Executa as fases em ordem. Para cada fase:
 * - Se `when(ctx)` for true, executa `run(ctx)`.
 * - Se `run` retornar não nulo, retorna esse resultado e encerra.
 * - Caso contrário segue para a próxima fase.
 * É esperado que ao menos uma fase retorne resultado (ex.: fase final com when: () => true).
 */
export async function runPipeline<T>(ctx: T, phases: Phase<T>[]): Promise<SimulatorResult> {
  for (const phase of phases) {
    const ok = await phase.when(ctx)
    if (!ok) continue
    const result = await phase.run(ctx)
    if (result != null) return result
  }
  throw new Error("flow-pipeline: nenhuma fase retornou resultado (falta fase fallback com when: () => true)")
}

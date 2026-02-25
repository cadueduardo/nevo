/**
 * Formata estimativa externa (faixa) para exibição no chat.
 */

import type { RangeResult } from "./types"

export function formatExternalQuote(result: RangeResult): string {
  const minStr = formatValue(result.min)
  const maxStr = formatValue(result.max)
  return `Para esse tamanho, o investimento costuma ficar entre ${minStr} e ${maxStr}.\n\nPosso agendar uma visita para confirmar?`
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

/**
 * Formata orçamento interno para exibição no chat.
 */

import type { CalculationResult } from "./types"

export function formatInternalQuote(result: CalculationResult): string {
  const lines: string[] = []
  lines.push(`📄 Orçamento — ${result.service_name}`)

  if (result.breakdown && result.breakdown.length > 0) {
    for (const item of result.breakdown) {
      if (item.label !== "Total") {
        lines.push(`${item.label}: ${formatValue(item.value)}`)
      }
    }
  }

  lines.push("")
  lines.push(`Total: ${formatValue(result.total)}`)

  return lines.join("\n")
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

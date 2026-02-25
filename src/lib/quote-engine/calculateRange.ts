/**
 * Cálculo de estimativa em faixa (orçamento externo, baixa fricção).
 * Usa external_variable_keys do quote_service.
 */

import type { QuoteService, QuoteSlots, RangeResult } from "./types"

/**
 * Calcula faixa min-max para estimativa rápida.
 * MVP: margem fixa em torno do valor base.
 */
export function calculateRange(
  service: QuoteService,
  slots: QuoteSlots,
  currency = "BRL"
): RangeResult {
  const rules = (service.pricing_rules || {}) as Record<string, unknown>
  const margin = 0.2 // ±20% para faixa

  // Reutiliza lógica de calculateQuote para valor base, depois aplica margem
  let base = 0

  switch (service.pricing_type) {
    case "fixed":
      base = (rules.base_price as number) ?? 0
      break
    case "unit": {
      const unitPrice = (rules.unit_price as number) ?? 0
      const qty = Number(slots.quantidade ?? slots.qty ?? 1) || 1
      base = unitPrice * qty
      break
    }
    case "area": {
      const pricePerM2 = (rules.price_per_m2 as number) ?? 0
      const width = Number(slots.largura_cm ?? slots.largura ?? 0) / 100
      const height = Number(slots.altura_cm ?? slots.altura ?? 0) / 100
      base = width * height * pricePerM2
      break
    }
    default:
      base = 0
  }

  const min = Math.max(0, base * (1 - margin))
  const max = base * (1 + margin)

  return {
    service_name: service.name,
    min,
    max,
    currency,
  }
}

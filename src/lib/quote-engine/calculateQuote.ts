/**
 * Cálculo determinístico de orçamento interno (completo).
 * Usa pricing_rules e variables_schema do quote_service.
 */

import type { QuoteService, QuoteSlots, CalculationResult } from "./types"

/**
 * Calcula o orçamento completo a partir dos slots validados.
 * MVP: retorna estrutura básica; regras complexas em evolução.
 */
export function calculateQuote(
  service: QuoteService,
  slots: QuoteSlots,
  currency = "BRL"
): CalculationResult {
  const rules = (service.pricing_rules || {}) as Record<string, unknown>

  // MVP: lógica mínima. FASE 4 implementa regras por pricing_type.
  switch (service.pricing_type) {
    case "fixed": {
      const price = (rules.base_price as number) ?? 0
      return {
        service_name: service.name,
        breakdown: [{ label: "Valor fixo", value: price }],
        total: price,
        currency,
      }
    }
    case "unit": {
      const unitPrice = (rules.unit_price as number) ?? 0
      const qty = Number(slots.quantidade ?? slots.qty ?? 1) || 1
      const total = unitPrice * qty
      return {
        service_name: service.name,
        breakdown: [
          { label: "Quantidade", value: qty },
          { label: "Unitário", value: unitPrice },
          { label: "Total", value: total },
        ],
        total,
        currency,
      }
    }
    case "area": {
      const pricePerM2 = (rules.price_per_m2 as number) ?? 0
      const width = Number(slots.largura_cm ?? slots.largura ?? 0) / 100
      const height = Number(slots.altura_cm ?? slots.altura ?? 0) / 100
      const area = width * height
      const total = area * pricePerM2
      return {
        service_name: service.name,
        breakdown: [
          { label: "Área (m²)", value: area },
          { label: "Preço/m²", value: pricePerM2 },
          { label: "Total", value: total },
        ],
        total,
        currency,
      }
    }
    default:
      return {
        service_name: service.name,
        total: 0,
        currency,
      }
  }
}

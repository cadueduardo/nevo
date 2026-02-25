// @ts-nocheck
/**
 * Motor de orçamento para Edge Function (FASE 4).
 * Lógica determinística: validateSlots, calculateQuote, formatInternalQuote.
 */

export interface QuoteSlots {
  [key: string]: string | number | boolean | undefined
}

export interface CalculationResult {
  service_name: string
  breakdown?: { label: string; value: number }[]
  total: number
  currency: string
}

export interface QuoteServiceRow {
  id: string
  agent_id: string
  name: string
  pricing_type: string
  variables_schema: unknown[]
  pricing_rules: Record<string, unknown>
  external_variable_keys?: string[]
  keywords?: string[]
  active: boolean
}

function formatValue(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
}

/**
 * Extrai slots de orçamento de mensagem livre (regex + heurísticas).
 * Ex.: "cortina 2.80 x 2.60 blackout wave instalação" → largura_cm, altura_cm, tecido, modelo, inclui_instalacao
 */
export function extractQuoteSlotsFromText(text: string): QuoteSlots {
  const msg = text.toLowerCase().replace(/,/g, ".").trim()
  const slots: QuoteSlots = {}

  // Medidas: "2.80 x 2.60", "2,80 x 2,60", "280 x 260"
  const medidasMatch = msg.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)|(\d+)\s*cm\s*[x×]\s*(\d+)\s*cm/
  )
  if (medidasMatch) {
    const w = parseFloat(medidasMatch[1] || medidasMatch[3] || "0")
    const h = parseFloat(medidasMatch[2] || medidasMatch[4] || "0")
    if (w > 0 && h > 0) {
      slots.largura_cm = w < 100 ? w * 100 : w
      slots.altura_cm = h < 100 ? h * 100 : h
    }
  }

  // Tecido: blackout, voil, linho, tela solar
  const tecidos = ["blackout", "voil", "linho", "tela solar", "tela_solar"]
  for (const t of tecidos) {
    if (msg.includes(t.replace("_", " "))) {
      slots.tecido = t.replace("_", " ")
      break
    }
  }

  // Modelo: wave, ilhós, romana, rolô
  const modelos = ["wave", "ilhos", "ilhós", "romana", "rolo", "rolô"]
  for (const m of modelos) {
    if (msg.includes(m)) {
      slots.modelo = m
      break
    }
  }

  // Instalação: "com instalação", "instalação", "instalar", "sim"
  if (
    /\b(com\s+)?instalacao\b|\b(com\s+)?instalacao\b|\binstalar\b|\binstalacao\s+sim\b/i.test(msg) ||
    /\bsim\b.*\binstal/i.test(msg)
  ) {
    slots.inclui_instalacao = true
  } else if (/\bsem\s+instalacao\b|\bnao\s+instalacao\b/i.test(msg)) {
    slots.inclui_instalacao = false
  }

  // Quantidade de vãos
  const vaosMatch = msg.match(/(\d+)\s*vao|vaos?\s*(\d+)\b|\b(\d+)\s*vao/i)
  if (vaosMatch) {
    const q = parseInt(vaosMatch[1] || vaosMatch[2] || vaosMatch[3] || "1", 10)
    if (q > 0) slots.quantidade_vaos = q
  }
  if (!slots.quantidade_vaos) slots.quantidade_vaos = 1

  return slots
}

/**
 * Valida slots contra variables_schema (simplificado).
 */
export function validateQuoteSlots(
  schema: Array<{ key: string; label?: string; required?: boolean }>,
  slots: QuoteSlots
): { valid: boolean; missing: string[] } {
  const missing: string[] = []
  for (const v of schema) {
    if (v.required && (slots[v.key] === undefined || slots[v.key] === null || slots[v.key] === "")) {
      missing.push(v.label || v.key)
    }
  }
  return { valid: missing.length === 0, missing }
}

/**
 * Calcula orçamento a partir dos slots.
 */
export function calculateQuote(
  service: QuoteServiceRow,
  slots: QuoteSlots,
  currency = "BRL"
): CalculationResult {
  const rules = (service.pricing_rules || {}) as Record<string, unknown>

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
      return { service_name: service.name, total: 0, currency }
  }
}

/**
 * Formata orçamento para exibição no chat.
 */
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

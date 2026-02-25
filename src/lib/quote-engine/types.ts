/**
 * Tipos do motor de orçamento (FASE 3).
 * quote_slots = variáveis do variables_schema do quote_service.
 * Não misturar com slots de agendamento (booking_slots).
 */

export type PricingType =
  | "fixed"
  | "unit"
  | "linear"
  | "area"
  | "area_with_minimum"
  | "formula"
  | "custom_manual"

export interface VariableSchema {
  key: string
  label: string
  type: "text" | "number" | "enum" | "boolean" | "date" | "location"
  required?: boolean
  options?: unknown[]
  validation?: Record<string, unknown>
}

export interface QuoteService {
  id: string
  agent_id: string
  name: string
  pricing_type: PricingType
  variables_schema: VariableSchema[]
  pricing_rules: Record<string, unknown>
  external_variable_keys: string[]
  keywords: string[]
  active: boolean
}

/** Slots extraídos da mensagem (variáveis do orçamento). */
export interface QuoteSlots {
  [key: string]: string | number | boolean | undefined
}

/** Resultado do cálculo interno (orçamento completo). */
export interface CalculationResult {
  service_name: string
  breakdown?: { label: string; value: number }[]
  materials?: number
  labor?: number
  total: number
  currency: string
}

/** Resultado da estimativa externa (faixa). */
export interface RangeResult {
  service_name: string
  min: number
  max: number
  currency: string
}

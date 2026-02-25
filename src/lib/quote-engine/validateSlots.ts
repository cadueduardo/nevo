/**
 * Valida slots de orçamento contra o variables_schema do quote_service.
 * Retorna erros de validação ou slots faltantes.
 */

import type { QuoteService, QuoteSlots, VariableSchema } from "./types"

export interface ValidationError {
  key: string
  message: string
}

export interface ValidateSlotsResult {
  valid: boolean
  missing: string[]
  errors: ValidationError[]
}

/**
 * Valida os slots extraídos contra o schema do serviço.
 * Retorna { valid, missing, errors }.
 */
export function validateSlots(
  service: QuoteService,
  slots: QuoteSlots,
  schemaOverride?: VariableSchema[]
): ValidateSlotsResult {
  const schema = schemaOverride ?? service.variables_schema
  const missing: string[] = []
  const errors: ValidationError[] = []

  for (const v of schema) {
    const value = slots[v.key]
    if (v.required && (value === undefined || value === null || value === "")) {
      missing.push(v.label || v.key)
    }
    // Validações adicionais (tipo, range, etc.) podem ser adicionadas aqui
  }

  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors,
  }
}

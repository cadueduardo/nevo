/**
 * Geração de PDF de orçamento.
 * FASE 4: implementar com template default/branded.
 * Salvar em Supabase Storage; retornar Signed URL (7 dias).
 */

import type { CalculationResult } from "./types"

export interface GeneratePdfParams {
  result: CalculationResult
  businessName?: string
  branding?: {
    enabled: boolean
    logo_url?: string
    company_legal_name?: string
    cnpj?: string
    company_phone?: string
    company_email?: string
  }
}

export interface GeneratePdfResult {
  url: string
  expiresAt: string
}

/**
 * Gera PDF do orçamento.
 * MVP: stub. FASE 4 implementa com @react-pdf/renderer ou similar.
 */
export async function generatePdf(_params: GeneratePdfParams): Promise<GeneratePdfResult> {
  // TODO FASE 4: implementar geração real
  // - Verificar branding.enabled
  // - Renderizar template default ou branded
  // - Upload para Supabase Storage (bucket privado)
  // - Gerar Signed URL (TTL via QUOTE_PDF_SIGNED_URL_TTL_SECONDS)
  throw new Error("generatePdf não implementado ainda (FASE 4)")
}

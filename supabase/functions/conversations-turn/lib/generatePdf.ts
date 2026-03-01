// @ts-nocheck
/**
 * Geração de PDF de orçamento (FASE 4.3).
 * Usa pdf-lib; salva em Supabase Storage; retorna Signed URL (7 dias).
 */
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1"

const BUCKET_NAME = "quotes"
const SIGNED_URL_EXPIRES_SEC = 7 * 24 * 3600 // 7 dias

export interface GeneratePdfParams {
  serviceName: string
  total: number
  currency?: string
  breakdown?: Array<{ label: string; value: number }>
  businessName?: string
  validityDays?: number
  /** Branding timbrado (quando enabled: true). */
  branding?: {
    enabled?: boolean
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

function formatValue(value: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value)
}

/**
 * Gera PDF do orçamento e retorna Signed URL.
 */
export async function generateQuotePdf(
  supabaseAdmin: any,
  tenantId: string,
  params: GeneratePdfParams
): Promise<GeneratePdfResult | null> {
  const { serviceName, total, currency = "BRL", breakdown = [], businessName, validityDays = 30, branding } = params
  const useBranded = branding?.enabled === true && (branding.company_legal_name || branding.cnpj)

  try {
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([595, 842]) // A4
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    let y = 750
    const lineHeight = 20
    const margin = 50

    const addText = (text: string, size = 12, bold = false) => {
      const f = bold ? fontBold : font
      page.drawText(text, { x: margin, y, size, font: f, color: rgb(0.1, 0.1, 0.1) })
      y -= lineHeight
    }

    addText("ORÇAMENTO", 18, true)
    y -= 10

    // Template branded: razão social, CNPJ, contatos
    if (useBranded) {
      if (branding.company_legal_name) {
        addText(branding.company_legal_name, 14, true)
        y -= 5
      }
      if (branding.cnpj) {
        addText(`CNPJ: ${branding.cnpj}`, 10)
        y -= 5
      }
      if (branding.company_phone || branding.company_email) {
        const contactParts: string[] = []
        if (branding.company_phone) contactParts.push(branding.company_phone)
        if (branding.company_email) contactParts.push(branding.company_email)
        addText(contactParts.join(" | "), 9)
        y -= 5
      }
      y -= 5
    } else if (businessName) {
      addText(businessName, 14, true)
      y -= 5
    }

    addText(`Serviço: ${serviceName}`, 12)
    y -= 15

    if (breakdown.length > 0) {
      addText("Detalhamento:", 11, true)
      y -= 8
      const currencyLabels = ["total", "preço", "valor", "unitário", "mão", "material", "instalação", "confecção"]
      for (const item of breakdown) {
        const labelLower = item.label.toLowerCase()
        const isCurrency = currencyLabels.some((l) => labelLower.includes(l)) || item.label === "Total"
        const valStr = isCurrency ? formatValue(item.value, currency) : String(item.value)
        addText(`  ${item.label}: ${valStr}`, 10)
      }
      y -= 10
    }

    addText(`Total: ${formatValue(total, currency)}`, 14, true)
    y -= 20

    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + validityDays)
    addText(`Validade: ${validUntil.toLocaleDateString("pt-BR")}`, 10)
    y -= 30

    addText("— Gerado pelo Nevo", 8)
    y -= 5

    const pdfBytes = await pdfDoc.save()

    // Garantir bucket existe
    try {
      const { data: existing } = await supabaseAdmin.storage.getBucket(BUCKET_NAME)
      if (!existing) {
        await supabaseAdmin.storage.createBucket(BUCKET_NAME, { public: false })
      }
    } catch (bucketErr) {
      console.error("generatePdf bucket error:", bucketErr)
      return null
    }

    const filePath = `${tenantId}/${crypto.randomUUID()}.pdf`
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(filePath, pdfBytes, { contentType: "application/pdf", upsert: true })

    if (uploadErr) {
      console.error("generatePdf upload error:", uploadErr)
      return null
    }

    const { data: signedData, error: signedErr } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, SIGNED_URL_EXPIRES_SEC)

    if (signedErr || !signedData?.signedUrl) {
      console.error("generatePdf signedUrl error:", signedErr)
      return null
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRES_SEC * 1000).toISOString()
    return { url: signedData.signedUrl, expiresAt }
  } catch (err) {
    console.error("generatePdf error:", err)
    return null
  }
}

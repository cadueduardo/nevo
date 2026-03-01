// @ts-nocheck
/**
 * Handler de orçamento externo (FASE 5).
 * Cliente pergunta preço com medidas → faixa min/max + CTA agendamento.
 * Detecção híbrida: keywords primeiro, IA como fallback.
 */
import { isPriceQuestion } from "./detection.ts"
import {
  extractQuoteSlotsFromText,
  calculateRange,
  formatExternalQuote,
  type QuoteServiceRow,
} from "./quote-engine.ts"

function matchesQuoteService(text: string, service: QuoteServiceRow): boolean {
  const msg = text.toLowerCase()
  const name = (service.name || "").toLowerCase()
  if (name && msg.includes(name)) return true
  const keywords = (service.keywords || []) as string[]
  for (const kw of keywords) {
    if (kw && msg.includes(kw.toLowerCase())) return true
  }
  return false
}

/** Fallback IA quando keywords não batem. Retorna serviço com maior confiança ou null. */
async function inferQuoteServiceWithAI(
  message: string,
  services: QuoteServiceRow[]
): Promise<{ service: QuoteServiceRow; confidence: number } | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey || services.length === 0) return null

  const names = services.map((s) => s.name).filter(Boolean)
  if (names.length === 0) return null

  const prompt = `O cliente perguntou sobre preço/orçamento. Identifique qual serviço da lista ele quer.

Serviços disponíveis: ${names.join(", ")}

Mensagem do cliente: "${message}"

Retorne JSON: { "service_name": "nome exato de um serviço da lista", "confidence": 0.0-1.0 }
Use o nome EXATO da lista. Se não conseguir identificar, use confidence < 0.5.`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Retorne apenas JSON válido." },
          { role: "user", content: prompt },
        ],
        max_tokens: 100,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim() || "{}"
    const parsed = JSON.parse(content)
    const suggested = parsed?.service_name
    const confidence = typeof parsed?.confidence === "number" ? parsed.confidence : 0
    if (!suggested || confidence < 0.5) return null

    const match = services.find((s) => (s.name || "").toLowerCase() === String(suggested).toLowerCase())
    return match ? { service: match, confidence } : null
  } catch {
    return null
  }
}

/**
 * Tenta tratar pedido de estimativa externa (cliente, modo external).
 * Retorna { handled: true, message, action_options } ou { handled: false }.
 */
export async function tryHandleExternalQuote(params: {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  conversationId: string
  message: string
}): Promise<{ handled: boolean; message?: string; action_options?: string[] }> {
  const { supabaseAdmin, tenantId, agentId, conversationId, message } = params
  if (!isPriceQuestion(message)) return { handled: false }

  const { data: quoteServices, error } = await supabaseAdmin
    .from("quote_service")
    .select("id, agent_id, name, pricing_type, variables_schema, pricing_rules, external_variable_keys, keywords, active")
    .eq("agent_id", agentId)
    .eq("active", true)

  if (error || !quoteServices?.length) return { handled: false }

  const services = quoteServices as QuoteServiceRow[]
  let service = services.find((s) => matchesQuoteService(message, s))
  if (!service) {
    const aiMatch = await inferQuoteServiceWithAI(message, services)
    if (aiMatch && aiMatch.confidence >= 0.6) {
      service = aiMatch.service
    }
  }
  if (!service) return { handled: false }

  const slots = extractQuoteSlotsFromText(message)
  const externalKeys = (service.external_variable_keys || []) as string[]
  const requiredKeys = externalKeys.length > 0 ? externalKeys : ["largura_cm", "altura_cm"]
  const needsSlots = service.pricing_type === "area" || service.pricing_type === "unit" || requiredKeys.length > 0
  if (needsSlots) {
    const hasRequired = requiredKeys.every((k) => slots[k] != null && slots[k] !== "")
    if (!hasRequired) {
      return {
        handled: true,
        message: `Para dar uma estimativa de ${service.name}, preciso das medidas (ex.: largura x altura em metros). Pode informar?`,
        action_options: undefined,
      }
    }
  }

  const rangeResult = calculateRange(service, slots)
  if (rangeResult.min === 0 && rangeResult.max === 0 && service.pricing_type !== "fixed") {
    return { handled: false }
  }
  const formatted = formatExternalQuote(rangeResult)
  const avgValue = (rangeResult.min + rangeResult.max) / 2

  try {
    await supabaseAdmin.from("request").insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      status: "pending",
      slots: slots as Record<string, unknown>,
      blueprint_id: service.id,
      total_value: avgValue,
      currency: rangeResult.currency,
      calculation_result: rangeResult,
      is_estimated: true,
    })
  } catch (err) {
    console.error("external quote request insert error:", err)
  }

  return {
    handled: true,
    message: formatted,
    action_options: ["Sim, quero agendar", "Depois"],
  }
}

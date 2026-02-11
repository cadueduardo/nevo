// @ts-nocheck
import { normalizeText } from "./utils.ts"
import type { SimulatorConfig } from "./types.ts"

export function findServiceByExactMatch(text: string, services: Array<{ name: string }> = []): string | null {
  const msg = normalizeText((text || "").trim())
  if (!msg) return null
  for (const service of services) {
    const name = normalizeText(service.name || "")
    if (name && msg === name) return service.name
  }
  return null
}

function normalizeForServiceMatch(s: string): string {
  return normalizeText(s)
    .replace(/\s*\+\s*/g, " ")
    .replace(/\bcom\b/gi, " ")
    .replace(/\be\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function findServiceFromText(text: string, services: Array<{ name: string }> = []): string | null {
  const exact = findServiceByExactMatch(text, services)
  if (exact) return exact
  const msg = normalizeText(text)
  for (const service of services) {
    const name = normalizeText(service.name || "")
    if (!name) continue
    if (msg.includes(name)) return service.name
    const msgNorm = normalizeForServiceMatch(msg)
    const nameNorm = normalizeForServiceMatch(name)
    if (msgNorm.includes(nameNorm) || nameNorm.includes(msgNorm)) return service.name
  }
  return null
}

export function getServiceWithPrice(
  services: Array<{ name: string; base_price?: number }> = [],
  serviceName: string | null
): { name: string; base_price?: number; description?: string } | null {
  if (!serviceName) return null
  return services.find((s) => normalizeText(s.name || "") === normalizeText(serviceName)) || null
}

export function getServiceDurationMinutes(config: SimulatorConfig, serviceName?: string): number | null {
  if (!serviceName) return null
  const match = (config.services || []).find((s) => normalizeText(s.name || "") === normalizeText(serviceName))
  if (!match) return null
  const minutes = match.duration_minutes
  if (!minutes || Number.isNaN(minutes) || minutes < 5 || minutes > 600) return null
  return minutes
}

/** Parseia serviço que pode ser único ou múltiplo ("Banho, Tosa" ou "Banho + Tosa"). */
export function parseServiceNames(serviceStr: string | undefined): string[] {
  if (!serviceStr?.trim()) return []
  return serviceStr
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Retorna duração total em minutos para um ou vários serviços. */
export function getServicesTotalDuration(config: SimulatorConfig, serviceStr: string | undefined): number | null {
  const names = parseServiceNames(serviceStr)
  if (names.length === 0) return null
  let total = 0
  for (const name of names) {
    const d = getServiceDurationMinutes(config, name)
    if (d == null) return null
    total += d
  }
  return total > 0 ? total : null
}

/** Retorna preço total para um ou vários serviços. MVP: soma dos preços individuais. */
export function getServicesTotalPrice(
  config: SimulatorConfig,
  serviceStr: string | undefined
): number | null {
  const names = parseServiceNames(serviceStr)
  if (names.length === 0) return null
  let total = 0
  for (const name of names) {
    const svc = getServiceWithPrice(config.services || [], name)
    if (!svc) return null
    const p = svc.base_price
    if (p != null && !Number.isNaN(p)) total += p
  }
  return total >= 0 ? total : null
}

/** Extrai múltiplos serviços do texto quando allow_sequence_booking. */
export function findServicesFromText(
  text: string,
  services: Array<{ name: string }> = [],
  eligibleForSequence: string[] = []
): string[] {
  const msg = normalizeText(text)
  const found: string[] = []
  const used = new Set<string>()
  for (const svc of services) {
    const name = svc.name || ""
    if (!name || used.has(normalizeText(name))) continue
    const nameNorm = normalizeText(name)
    if (msg.includes(nameNorm)) {
      if (eligibleForSequence.length === 0 || eligibleForSequence.some((e) => normalizeText(e) === nameNorm)) {
        found.push(name)
        used.add(nameNorm)
      }
    }
  }
  return found
}

export function areaMatchesServices(inferredArea: string | undefined, services: Array<{ name: string }> = []): boolean {
  if (!inferredArea) return false
  const normalize = (value: string) =>
    normalizeText(value)
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  const stop = new Set(["direito", "area", "servico", "servico", "atendimento", "consulta"])
  const areaTokens = normalize(inferredArea)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !stop.has(t))
  if (areaTokens.length === 0) return false

  return services.some((s) => {
    const serviceTokens = normalize(s.name || "")
      .split(" ")
      .filter(Boolean)
      .filter((t) => !stop.has(t))
    if (serviceTokens.length === 0) return false
    return areaTokens.some((t) => serviceTokens.includes(t))
  })
}

export function pickServiceByArea(inferredArea: string | undefined, services: Array<{ name: string }> = []): string | null {
  if (!inferredArea) return null
  const normalize = (value: string) =>
    normalizeText(value)
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  const stop = new Set(["direito", "area", "servico", "servico", "atendimento", "consulta"])
  const areaTokens = normalize(inferredArea)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !stop.has(t))
  if (areaTokens.length === 0) return null

  let best: { name: string; score: number } | null = null
  for (const service of services) {
    const serviceTokens = normalize(service.name || "")
      .split(" ")
      .filter(Boolean)
      .filter((t) => !stop.has(t))
    const matches = areaTokens.filter((t) => serviceTokens.includes(t))
    const score = matches.length
    if (score > 0) {
      const matchRatio = score / areaTokens.length
      if ((matchRatio >= 0.5 || score >= 2) && (!best || score > best.score)) {
        best = { name: service.name, score }
      }
    }
  }
  return best?.name || null
}

export async function inferAreaWithAI(
  message: string,
  config: SimulatorConfig
): Promise<{ inferred_area?: string; confidence?: number } | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const business = config.business_name ? `Nome: ${config.business_name}` : ""
  const businessType = config.business_type ? `Ramo: ${config.business_type}` : ""
  const prompt = `Você é um classificador de intenção. Sua tarefa é identificar o assunto principal ou necessidade do cliente a partir da mensagem.

${business}
${businessType}

Mensagem do cliente:
"${message}"

Instruções CRÍTICAS:
- Retorne APENAS JSON válido.
- Analise APENAS a mensagem do cliente e identifique o assunto/área/necessidade mencionada, SEMPRE baseado no conteúdo real da mensagem.
- IMPORTANTE: IGNORE completamente o ramo de atividade informado acima. Identifique o contexto baseado SOMENTE na mensagem do cliente.
- Identifique o contexto CORRETO baseado nas palavras-chave da mensagem. Exemplos precisos:
  * "prenderam meu filho" ou "meu primo foi preso" ou "foi preso" → "direito criminal" (NÃO "direito de família")
  * "quero divorciar" ou "guarda dos filhos" ou "pensão alimentícia" → "direito de família"
  * "dor de dente" ou "tratamento dentário" → "odontologia" ou "tratamento dental"
  * "cortar cabelo" ou "corte" → "corte de cabelo" ou "serviço de beleza"
  * "consertar carro" ou "reparo automotivo" → "mecânica automotiva" ou "reparo de veículos"
- "inferred_area" deve ser um resumo curto e preciso do assunto mencionado pelo cliente.
- Use SOMENTE pistas claras do texto do cliente. Seja preciso na identificação.
- NÃO assuma que o assunto está relacionado ao ramo informado. Se a mensagem menciona "preso", "prisão", "criminal", identifique como "direito criminal", mesmo que o ramo seja "advocacia".
- Tente SEMPRE identificar algo, mesmo que com confidence baixa. Só retorne "indefinido" se a mensagem for extremamente vaga (ex: apenas "oi", "olá", "bom dia" sem contexto).
- "confidence" é de 0 a 1, baseado na clareza das pistas na mensagem. Use confidence baixa (< 0.4) apenas para mensagens muito vagas ou genéricas.

Formato:
{
  "inferred_area": "string",
  "confidence": 0.0
}`

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
          { role: "system", content: "Retorne apenas JSON válido. Sem markdown ou texto adicional." },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim() || "{}"
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed.inferred_area !== "string") return null
    return {
      inferred_area: typeof parsed.inferred_area === "string" ? parsed.inferred_area : undefined,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    }
  } catch {
    return null
  }
}

export async function classifyServiceMatch(
  message: string,
  config: SimulatorConfig
): Promise<{ service?: string; reject?: boolean; confidence?: number; inferred_area?: string }> {
  const direct = findServiceFromText(message, config.services || [])
  if (direct) return { service: direct }

  const policy = config.lead_policy || {}
  const rejectEnabled = Boolean(policy.reject_unlisted_services)
  const useAi = policy.use_ai_matching ?? true
  if (!useAi) return {}

  const ai = await inferAreaWithAI(message, config)
  if (!ai) return {}

  const minConfidence = typeof policy.min_confidence === "number" ? policy.min_confidence : 0.6
  const inferred = ai.inferred_area
  if (!inferred) return {}
  if (normalizeText(inferred) === "indefinido") {
    if (rejectEnabled && (ai.confidence ?? 0) <= 0.3) {
      return { reject: true, confidence: ai.confidence, inferred_area: inferred }
    }
    return { inferred_area: inferred, confidence: ai.confidence }
  }

  const matchedService = pickServiceByArea(inferred, config.services || [])
  if (matchedService && (ai.confidence ?? 0) >= minConfidence) {
    return { service: matchedService, confidence: ai.confidence, inferred_area: inferred }
  }
  const areaMatches = areaMatchesServices(inferred, config.services || [])
  if (rejectEnabled && (ai.confidence ?? 0) >= minConfidence && !areaMatches) {
    return { reject: true, confidence: ai.confidence, inferred_area: inferred }
  }
  if (!areaMatches) {
    return { inferred_area: inferred, confidence: ai.confidence }
  }
  return { inferred_area: inferred, confidence: ai.confidence }
}

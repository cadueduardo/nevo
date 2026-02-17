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

const SERVICE_STOPWORDS = new Set([
  "quanto",
  "custa",
  "valor",
  "preco",
  "preço",
  "ta",
  "tá",
  "do",
  "da",
  "de",
  "o",
  "a",
  "os",
  "as",
  "um",
  "uma",
  "pra",
  "para",
  "quero",
  "agendar",
  "horario",
  "horário",
  "minha",
  "meu",
  "por",
  "favor",
])

function tokenizeRelevant(text: string): string[] {
  const normalized = normalizeText(text)
  return normalized
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !SERVICE_STOPWORDS.has(t))
}

function findServiceByTokenOverlap(
  text: string,
  services: Array<{ name: string }> = []
): string | null {
  const msgTokens = tokenizeRelevant(text)
  if (msgTokens.length === 0) return null

  let best: { name: string; score: number } | null = null
  for (const service of services) {
    const name = service.name || ""
    const svcTokens = tokenizeRelevant(name)
    if (svcTokens.length === 0) continue
    const overlap = svcTokens.filter((token) => msgTokens.includes(token)).length
    if (overlap === 0) continue
    const score = overlap / svcTokens.length
    if (!best || score > best.score) {
      best = { name: service.name, score }
    }
  }

  if (!best) return null
  return best.score >= 0.5 ? best.name : null
}

/** Mínimo de caracteres para match parcial. Evita que "O" case em "Implantação" (nameNorm.includes("o")). */
const MIN_TEXT_LENGTH_FOR_PARTIAL_MATCH = 2

export function findServiceFromText(text: string, services: Array<{ name: string }> = []): string | null {
  const exact = findServiceByExactMatch(text, services)
  if (exact) return exact
  const msg = normalizeText(text)
  if (msg.length < MIN_TEXT_LENGTH_FOR_PARTIAL_MATCH) return null
  for (const service of services) {
    const name = normalizeText(service.name || "")
    if (!name) continue
    if (msg.includes(name)) return service.name
    const msgNorm = normalizeForServiceMatch(msg)
    const nameNorm = normalizeForServiceMatch(name)
    if (msgNorm.length < MIN_TEXT_LENGTH_FOR_PARTIAL_MATCH) continue
    if (msgNorm.includes(nameNorm) || nameNorm.includes(msgNorm)) return service.name
  }
  return findServiceByTokenOverlap(msg, services)
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
  const msgTokens = tokenizeRelevant(text)
  const found: string[] = []
  const used = new Set<string>()
  const eligibleSet = new Set((eligibleForSequence || []).map((e) => normalizeText(e)))
  for (const svc of services) {
    const name = svc.name || ""
    if (!name || used.has(normalizeText(name))) continue
    const nameNorm = normalizeText(name)
    const allowed = eligibleSet.size === 0 || eligibleSet.has(nameNorm)
    if (!allowed) continue

    if (msg.includes(nameNorm)) {
      found.push(name)
      used.add(nameNorm)
      continue
    }

    // Fallback semântico leve: "corte e barba" casa com "corte de cabelo" + "barba".
    const svcTokens = tokenizeRelevant(name)
    if (svcTokens.length === 0 || msgTokens.length === 0) continue
    const overlap = svcTokens.filter((token) => msgTokens.includes(token)).length
    const ratio = overlap / svcTokens.length
    const minRatio = svcTokens.length === 1 ? 1 : 0.5
    if (overlap > 0 && ratio >= minRatio) {
      found.push(name)
      used.add(nameNorm)
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
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  const servicesHint =
    servicesList.length > 0
      ? `\nServiços oferecidos pelo negócio (use estes nomes exatos quando fizer sentido): ${servicesList.join(", ")}\n`
      : ""

  const prompt = `Você é um classificador de intenção. Sua tarefa é identificar o assunto principal ou necessidade do cliente a partir da mensagem.

${business}
${businessType}
${servicesHint}

Mensagem do cliente:
"${message}"

Instruções CRÍTICAS:
- Retorne APENAS JSON válido.
- Analise APENAS a mensagem do cliente e identifique o assunto/área/necessidade mencionada, SEMPRE baseado no conteúdo real da mensagem.
- IMPORTANTE: Quando possível, use o NOME EXATO de um serviço da lista acima (ex: se temos "Direito trabalhista" e o cliente disse "quero colocar a empresa na justiça", retorne inferred_area: "Direito trabalhista").
- Identifique o contexto CORRETO baseado nas palavras-chave da mensagem. Exemplos (adaptáveis a QUALQUER ramo):
  * "prenderam meu filho" ou "meu primo foi preso" → "direito criminal"
  * "quero divorciar" ou "guarda dos filhos" → "direito de família"
  * "quero colocar a empresa na justiça" ou "processo contra patrão" ou "demissão" ou "verbas rescisórias" ou "rescisão" ou "processo trabalhista" → "direito trabalhista"
  * "dor de dente" ou "tratamento dentário" → "odontologia"
  * "consertar carro" ou "reparo automotivo" → "mecânica automotiva"
- CRÍTICO - USE O CONTEXTO "PARA QUEM": Se a mensagem disser PARA QUEM é o pedido, use isso. Ex: "corte para meu filho e meu marido" = clientes masculinos → NÃO inferir "feminino". "corte para minha esposa" pode indicar feminino só se o negócio tiver corte feminino. Sempre baseie na menção explícita (filho, marido, esposa, etc.).
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

  // Se a IA retornou o nome exato de um serviço, aceitar diretamente
  const exactServiceMatch = (config.services || []).find(
    (s) => s.name && normalizeText(s.name) === normalizeText(inferred)
  )
  if (exactServiceMatch?.name && (ai.confidence ?? 0) >= minConfidence) {
    return { service: exactServiceMatch.name, confidence: ai.confidence, inferred_area: inferred }
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

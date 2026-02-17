// @ts-nocheck
import { normalizeText } from "./utils.ts"
import type { SimulatorState } from "./types.ts"

export function isGreeting(text: string): boolean {
  const msg = normalizeText(text)
  const cleaned = msg.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
  const words = cleaned ? cleaned.split(" ").filter(w => w.length > 0) : []
  if (words.length > 3) return false
  const greetingPatterns = [
    /^(oi|ola|olá|oii)$/,
    /^(bom dia)$/,
    /^(boa tarde)$/,
    /^(boa noite)$/,
    /^(e ai|e aí)$/,
  ]
  const isOnlyGreeting = greetingPatterns.some(pattern => pattern.test(cleaned))
  if (words.length > 1 && !isOnlyGreeting) return false
  return isOnlyGreeting
}

export function isWhoAreYou(text: string): boolean {
  const msg = normalizeText(text)
  return /(com quem estou falando|quem estou falando|quem fala|quem e voce|quem é voce|voce e quem|quem voce e|quem e vc|quem eh vc)/.test(msg)
}

export function getGreetingByTime(date = new Date()): string {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return "bom dia"
  if (hour >= 12 && hour < 18) return "boa tarde"
  return "boa noite"
}

export function isConfused(text: string): boolean {
  const msg = normalizeText(text)
  return /(nao entendi|não entendi|nao compreendi|não compreendi|como assim|nao entendo|não entendo)/.test(msg)
}

export function isFinalizedState(state: SimulatorState): boolean {
  if (state.final_thanks_sent) return true
  const last = normalizeText(state.last_prompt || "")
  return last.includes("agendamento") && last.includes("confirmad")
}

/** Comando para encerrar/reiniciar a conversa (testes). Ex.: "encerrar", "encerrar teste", "reiniciar" */
export function isEndTestCommand(text: string): boolean {
  const msg = normalizeText(text)
  return /^(encerrar|encerrar teste|reiniciar teste|encerrar conversa|reiniciar conversa|resetar|reiniciar)$/.test(msg) ||
    /^encerrar (a )?conversa$/.test(msg)
}

export function isPriceQuestion(text: string): boolean {
  const msg = normalizeText(text)
  const compact = msg.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
  return (
    /(quanto custa|preco|valor|quanto fica|quanto e|quais os precos|quanto sao)/.test(msg) ||
    /\bquanto\s+ta\b/.test(msg) ||
    /\bquanto\s+e\b/.test(msg) ||
    /\bqto\s+ta\b/.test(compact) ||
    /\bqto\s+e\b/.test(compact) ||
    /\bqto\s+custa\b/.test(compact) ||
    /\bqto\s+fica\b/.test(compact) ||
    /\bqto\b.*\b(valor|preco)\b/.test(compact) ||
    /\bqt\b.*\b(valor|preco|custa|fica)\b/.test(compact) ||
    /\bqual\s+o\s+valor\b/.test(msg) ||
    /\bvalor\s+do\b/.test(msg) ||
    /\bpreco\s+do\b/.test(msg) ||
    /\bpreco\s+da\b/.test(msg)
  )
}


export function isListServicesQuestion(text: string): boolean {
  const msg = normalizeText(text)
  return /(quais servicos|quais serviços|o que voces fazem|o que vocês fazem|quais opcoes|quais opções|listar servicos|servicos oferecidos)/.test(msg)
}

export function isServiceDetailQuestion(text: string): boolean {
  const msg = normalizeText(text)
  return /(o que inclui|o que e |o que é |me fala do servico|detalhe do |como e o |como é o )/.test(msg)
}

/** Resposta direta ao pedido "Qual o nome dele(a)?". Ex: "Cesar", "João", "Maria Silva". */
export function looksLikeAttendeeName(text: string): boolean {
  const t = text.trim()
  if (t.length < 2 || t.length > 40) return false
  const msg = normalizeText(t)
  const relationshipWords = /(meu|minha|marido|filho|esposa|conjuge|cônjuge|filha|mae|mãe|pai|sogra|sogro)/
  if (relationshipWords.test(msg)) return false
  return /^[a-zà-ú\s\-]+$/.test(msg) && msg.replace(/\s/g, "").length >= 2
}

export function isExplicitBookingIntent(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /^(quero|gostaria|preciso|queria)\s+(de\s+)?(agendar|marcar|agendar algum)/.test(msg) ||
    /^quero agendar$/.test(msg) ||
    /^(sim|quero)\s*,\s*agendar/.test(msg)
  )
}

export function isVisitRequest(text: string): boolean {
  const msg = normalizeText(text)
  return /(visita|visitar|vistoria|avaliacao)/.test(msg)
}

export function isAvailabilityQuestion(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /(tem\s+horario|tem\s+horarios|horarios\s+livres|horarios\s+disponiveis|disponibilidade)/.test(msg) ||
    /(tem\s+vaga|vaga\s+pra|vaga\s+para|tem\s+horario\s+pra|tem\s+disponibilidade\s+pra)/.test(msg)
  )
}

export function isYes(text: string): boolean {
  const msg = normalizeText(text)
  return /^(sim|pode|ok|claro|isso|tudo bem|beleza|ta bom)/.test(msg)
}

export function isNo(text: string): boolean {
  const msg = normalizeText(text)
  return /^(nao|não|agora nao|agora não|depois|nao quero)/.test(msg)
}

export function isPoliteDecline(text: string): boolean {
  const msg = normalizeText(text)
  const hasNo = /\b(nao|não)\b/.test(msg)
  const hasThanks = /\b(obrigad|valeu|agradec)\b/.test(msg)
  const startsWithUnfortunately = msg.startsWith("infelizmente")
  const hasAck = /\b(entendi|ok|tudo bem|beleza|ta bom)\b/.test(msg)
  const isShort = msg.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean).length <= 4
  return (hasNo && hasThanks) || startsWithUnfortunately || (hasAck && hasThanks && isShort)
}

export function isDirectServiceInquiry(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /^(nao|não)\s*(tem|tem mesmo|tem la)/.test(msg) ||
    /^(tem|tem mesmo)\s+/.test(msg) ||
    /^(voces|vocês)\s+(tem|fazem|oferecem)/.test(msg) ||
    /\b(nao|não)\s+tem\b/.test(msg) ||
    /^tem\s+\w+/.test(msg)
  )
}

export function isConfirmAction(text: string): boolean {
  const msg = normalizeText(text)
  return msg.includes("confirmar") || msg.includes("confirmo") || msg.includes("confirmar agendamento")
}

export function isDonePhrase(text: string): boolean {
  const msg = normalizeText(text)
  return /^(so isso|só isso|isso|ta ok|t[aá] ok|tudo certo|tudo ok|ok|beleza|nao|não)/.test(msg)
}

/**
 * Detecta mensagens de agradecimento ou despedida após finalização.
 * Usado para evitar que a IA re-peca dados (ex: telefone) quando o cliente
 * está apenas agradecendo ou se despedindo.
 */
export function isThanksOrClosingPhrase(text: string): boolean {
  const msg = normalizeText(text)
  const words = msg.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean)
  if (words.length > 6) return false
  const thanksPatterns = [
    /^(tks|thanks|vlw|obrigad|valeu|agradec)[oas]?\.?$/i,
    /^(muito\s+)?(obrigad|valeu|agradec)[oas]?\.?$/i,
    /^(obrigad|valeu)[oas]?,\s*(obrigad|valeu)[oas]?\.?$/i,
    /\b(tks|thanks|vlw)\b/i,
    /\b(obrigad|valeu|agradec)[oas]?\b/i,
    /\bte\s+amo\b/i,
    /\bamei\b/i,
  ]
  const fullMatch = thanksPatterns.some((p) => p.test(msg))
  if (fullMatch) return true
  const hasThanks = /\b(tks|thanks|vlw|obrigad|valeu|agradec|te amo|amei)\b/i.test(msg)
  const isShort = words.length <= 4
  return hasThanks && isShort
}

export function detectModeFromText(text: string): "booking" | "quote" | null {
  const msg = normalizeText(text)
  const booking = /(agendar|agenda|horario|marcar|consulta|atendimento)/.test(msg)
  const quote = /(orcamento|orcar|preco|valor|cotacao|cotar)/.test(msg)
  if (booking && !quote) return "booking"
  if (quote && !booking) return "quote"
  if (booking && quote) return "booking"
  return null
}

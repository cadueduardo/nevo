// @ts-nocheck
import { normalizeText } from "./utils.ts"
import type { SimulatorConfig } from "./types.ts"

type AudienceMode = "all" | "women_only" | "men_only" | "kids_only" | "custom"
type RequestedAudience = "men_only" | "women_only" | "kids_only" | null

const AUDIENCE_PATTERNS: Record<Exclude<RequestedAudience, null>, RegExp> = {
  kids_only: /(filho|filha|crianca|bebe|menino|menina|infantil)/,
  women_only: /(esposa|mulher|feminino|ela|namorada|minha mae)/,
  men_only: /(marido|homem|masculino|ele|namorado|meu pai)/,
}

const MODE_RESTRICTION_MESSAGES: Partial<Record<AudienceMode, string>> = {
  women_only:
    "Entendi. No momento, atendemos somente mulheres. Se quiser, posso te ajudar com um agendamento para esse publico.",
  men_only:
    "Entendi. No momento, atendemos somente homens. Se quiser, posso te ajudar com um agendamento para esse publico.",
  kids_only:
    "Entendi. No momento, atendemos apenas publico infantil. Se quiser, posso te ajudar com um agendamento nesse perfil.",
}

function inferRequestedAudienceFromText(text: string): RequestedAudience {
  const msg = normalizeText(text || "")
  if (!msg) return null

  for (const [audience, pattern] of Object.entries(AUDIENCE_PATTERNS)) {
    if (pattern.test(msg)) return audience as Exclude<RequestedAudience, null>
  }
  return null
}

/** Cliente está pedindo agendamento para o próprio público permitido (ex.: "agendar pra mim" em men_only). */
function textIndicatesBookingForAllowedAudience(config: SimulatorConfig, text: string): boolean {
  const mode = (config.target_audience?.mode || "all") as AudienceMode
  if (mode === "all" || mode === "custom") return false
  const msg = normalizeText(text || "")
  if (!msg) return false

  const agendarParaMim = /(quero\s+)?agendar\s+(ent[ãa]o\s+)?(pra|para)\s+(mim|eu)(\s+e\s+meu\s+filho)?/i
  const simQueroAgendar = /^(sim|ok|entendi|beleza)[,\s]*\s*(quero\s+)?agendar/i
  const soQueroAgendar = /^s[oó]\s+quero\s+agendar/i

  if (mode === "men_only") {
    // "agendar pra mim", "agendar pra mim e meu filho" (eu + filho = masculino), "sim, quero agendar"
    if (agendarParaMim.test(msg) || simQueroAgendar.test(msg) || soQueroAgendar.test(msg)) return true
  }
  if (mode === "women_only") {
    if (agendarParaMim.test(msg) || simQueroAgendar.test(msg) || soQueroAgendar.test(msg)) return true
  }
  if (mode === "kids_only") {
    if (/(agendar|marcar)\s+(pra|para|pro)\s+(meu\s+filho|minha\s+filha|meu\s+bebe|crianca)/i.test(msg)) return true
  }
  return false
}

function expectedByMode(mode: AudienceMode): RequestedAudience {
  if (mode === "women_only" || mode === "men_only" || mode === "kids_only") return mode
  return null
}

function getAllowedAudiences(config: SimulatorConfig): Exclude<RequestedAudience, null>[] {
  const ta = config.target_audience
  if (!ta) return []
  const rawModes =
    Array.isArray(ta.modes) && ta.modes.length > 0
      ? ta.modes
      : ta.mode
        ? [ta.mode]
        : []
  return rawModes.filter(
    (mode): mode is Exclude<RequestedAudience, null> =>
      mode === "women_only" || mode === "men_only" || mode === "kids_only"
  )
}

export function buildTargetAudienceRestrictionMessage(config: SimulatorConfig): string {
  const mode = (config.target_audience?.mode || "all") as AudienceMode
  const allowed = getAllowedAudiences(config)
  if (allowed.length > 1) {
    const business = config.business_name ? ` na ${config.business_name}` : ""
    const labels = allowed.map((aud) => {
      if (aud === "men_only") return "homens"
      if (aud === "women_only") return "mulheres"
      return "criancas"
    })
    const joined =
      labels.length === 2
        ? `${labels[0]} e ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`
    return `Entendi. No momento, atendemos ${joined}${business}. Se quiser, posso te ajudar com um agendamento dentro desse perfil.`
  }
  if (mode === "custom") {
    const note = config.target_audience?.note?.trim()
    const business = config.business_name ? ` da ${config.business_name}` : ""
    return note
      ? `Entendi. No momento, o atendimento${business} e focado em ${note}. Se quiser, posso te ajudar com um agendamento dentro desse perfil.`
      : `Entendi. No momento, o atendimento${business} e focado em um publico especifico.`
  }

  return MODE_RESTRICTION_MESSAGES[mode] || "No momento, atendemos todos os publicos."
}

/** Config tem público masculino + infantil (Homens e infantil). */
function configHasMenAndKidsAudience(config: SimulatorConfig): boolean {
  const ta = config.target_audience
  if (!ta) return false
  const modes = Array.isArray(ta.modes) && ta.modes.length > 0 ? ta.modes : ta.mode ? [ta.mode] : []
  return modes.includes("men_only") && modes.includes("kids_only")
}

/** Mensagem pede agendamento "pra mim e meu filho" (ambíguo: gênero + idade do filho). */
function textMentionsMeAndChild(text: string): boolean {
  const msg = normalizeText(text || "")
  if (!msg) return false
  const hasMe = /\b(mim|eu)\b/i.test(msg) || /(pra|para)\s+(mim|eu)\b/i.test(msg)
  const hasChild = /\b(meu\s+filho|minha\s+filha|meu\s+bebe|minha\s+crianca)\b/i.test(msg)
  return hasMe && hasChild
}

function textMentionsSelfAndAnotherPerson(text: string): boolean {
  const msg = normalizeText(text || "")
  if (!msg) return false
  const hasMe = /\b(mim|eu)\b/i.test(msg) || /(pra|para)\s+(mim|eu)\b/i.test(msg)
  if (!hasMe) return false
  return /\b(meu|minha)\s+(filho|filha|irmao|irma|primo|prima|amigo|amiga|marido|esposa|namorado|namorada|pai|mae|mãe|tio|tia|sobrinho|sobrinha|companheiro|companheira)\b/i.test(msg)
}

/**
 * Mensagem de esclarecimento quando cliente pede "pra mim e meu filho" e o estabelecimento
 * atende homens e infantil (opção 2): confirmar perfil antes de seguir com agendamento.
 */
export function buildAudienceClarificationMessage(config: SimulatorConfig): string {
  const ta = config.target_audience
  const business = (config.business_name || "").trim()
  const ageMin = ta?.kids_age_min
  const kidsPart =
    ageMin != null && ageMin > 0
      ? `crianças a partir de ${ageMin} anos`
      : "crianças (de qualquer idade)"
  const intro = business
    ? `Podemos sim agendar! Só pra alinhar: aqui na ${business} atendemos **homens e ${kidsPart}**.`
    : `Podemos sim agendar! Só pra alinhar: aqui atendemos **homens e ${kidsPart}**.`
  return `${intro} Vocês se encaixam nesse perfil? Se sim, escolho um horário pra vocês.`
}

/**
 * Retorna true quando devemos mostrar a mensagem de esclarecimento (opção 2)
 * em vez de ir direto ao agendamento: público homens + infantil e cliente disse "pra mim e meu filho".
 */
export function needsAudienceClarification(config: SimulatorConfig, text: string): boolean {
  if (!configHasMenAndKidsAudience(config)) return false
  if (!textMentionsMeAndChild(text) && !textMentionsSelfAndAnotherPerson(text)) return false
  if (shouldBlockByTargetAudience(config, text)) return false
  return true
}

export function shouldBlockByTargetAudience(
  config: SimulatorConfig,
  text: string
): boolean {
  const allowedAudiences = getAllowedAudiences(config)
  const mode = (config.target_audience?.mode || "all") as AudienceMode
  const expected = expectedByMode(mode)
  if (!expected && allowedAudiences.length === 0) return false

  // Cliente aceitou a restrição e pede agendamento para o público permitido (ex.: "agendar pra mim e meu filho" em men_only).
  if (textIndicatesBookingForAllowedAudience(config, text)) return false

  const requested = inferRequestedAudienceFromText(text)
  if (!requested) return false

  if (allowedAudiences.length > 0) {
    return !allowedAudiences.includes(requested)
  }

  return requested !== expected
}


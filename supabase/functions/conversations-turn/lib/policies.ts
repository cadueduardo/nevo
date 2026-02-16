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

function inferRequestedAudience(text: string, attendeeName?: string): RequestedAudience {
  return inferRequestedAudienceFromText(text) || inferRequestedAudienceFromText(attendeeName || "")
}

function expectedByMode(mode: AudienceMode): RequestedAudience {
  if (mode === "women_only" || mode === "men_only" || mode === "kids_only") return mode
  return null
}

export function buildTargetAudienceRestrictionMessage(config: SimulatorConfig): string {
  const mode = (config.target_audience?.mode || "all") as AudienceMode
  if (mode === "custom") {
    const note = config.target_audience?.note?.trim()
    const business = config.business_name ? ` da ${config.business_name}` : ""
    return note
      ? `Entendi. No momento, o atendimento${business} e focado em ${note}. Se quiser, posso te ajudar com um agendamento dentro desse perfil.`
      : `Entendi. No momento, o atendimento${business} e focado em um publico especifico.`
  }

  return MODE_RESTRICTION_MESSAGES[mode] || "No momento, atendemos todos os publicos."
}

export function shouldBlockByTargetAudience(
  config: SimulatorConfig,
  text: string,
  attendeeName?: string
): boolean {
  const mode = (config.target_audience?.mode || "all") as AudienceMode
  const expected = expectedByMode(mode)
  if (!expected) return false

  const requested = inferRequestedAudience(text, attendeeName)
  if (!requested) return false

  return requested !== expected
}

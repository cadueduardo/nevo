// @ts-nocheck
import { generateAdaptiveGreetingWithAI } from "../../ai.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"
import { buildGreetingFallbackMessage } from "./prompt-library.ts"
import type { RenderedSemanticMessage } from "./shared.ts"

function buildGreetingFallback(semantic: SemanticRuntimeResult): string {
  const contactName = semantic.context.sender_display_name?.trim()
  const message = semantic.snapshot.meta.raw_user_message || ""
  const informal = /\b(opa|fala|salve|e ai|suave|tranquilo|man)\b/.test(message.toLowerCase())
  return buildGreetingFallbackMessage(semantic.business_brain.business_name, contactName, informal)
}

export async function renderGreeting(semantic: SemanticRuntimeResult): Promise<RenderedSemanticMessage> {
  const aiGreeting = await generateAdaptiveGreetingWithAI(
    semantic.business_brain.raw_config,
    semantic.snapshot.meta.raw_user_message,
    semantic.context.history,
    semantic.context.sender_display_name,
    {
      business_brain: semantic.business_brain,
      agent_narrative: semantic.business_brain.agent_narrative,
    }
  )

  const businessName = semantic.business_brain.business_name
  const identityLine = businessName ? `Aqui é o assistente virtual da ${businessName}.` : "Aqui é o assistente virtual."
  const ensureIdentity = (text: string | null) => {
    const t = String(text || "").trim()
    if (!t) return null
    if (businessName && t.toLowerCase().includes(String(businessName).toLowerCase())) return t
    if (t.toLowerCase().includes("assistente")) return t
    return `${identityLine} ${t}`.trim()
  }

  return {
    message: ensureIdentity(aiGreeting) || buildGreetingFallback(semantic),
    action_options: ["Quero agendar"],
  }
}

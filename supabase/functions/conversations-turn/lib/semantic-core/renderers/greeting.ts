// @ts-nocheck
import { generateAdaptiveGreetingWithAI } from "../../ai.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"

function buildGreetingFallback(semantic: SemanticRuntimeResult): string {
  const businessName = semantic.business_brain.business_name || "a empresa"
  const contactName = semantic.context.sender_display_name?.trim()
  const message = semantic.snapshot.raw_user_message || ""
  const informal = /\b(opa|fala|salve|e ai|suave|tranquilo|man)\b/.test(message.toLowerCase())
  const lead = informal ? "Opa" : "Oi"
  if (contactName) {
    return `${lead} ${contactName}! Tudo bem por aqui, e voce? Aqui e da ${businessName}. Estou a disposicao para ajudar no que precisar!`
  }
  return `${lead}! Tudo bem por aqui, e voce? Aqui e da ${businessName}. Estou a disposicao para ajudar no que precisar!`
}

export async function renderGreeting(semantic: SemanticRuntimeResult): Promise<{ message: string; action_options?: string[] }> {
  const aiGreeting = await generateAdaptiveGreetingWithAI(
    semantic.business_brain.raw_config,
    semantic.snapshot.raw_user_message,
    semantic.context.history,
    semantic.context.sender_display_name
  )

  return {
    message: aiGreeting || buildGreetingFallback(semantic),
    action_options: ["Quero agendar"],
  }
}

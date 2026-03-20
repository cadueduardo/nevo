// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { normalizeText } from "./utils.ts"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

export function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return { supabaseAdmin: null, envError: "Configuracao do servidor incompleta" }
  }
  return { supabaseAdmin: createClient(supabaseUrl, serviceRoleKey), envError: null }
}

export function normalizeTone(tone?: string): "formal" | "amigavel" | "profissional" | "engracado" | null {
  if (!tone) return null
  const t = normalizeText(tone)
  if (t.includes("formal")) return "formal"
  if (t.includes("amig") || t.includes("friendly")) return "amigavel"
  if (t.includes("prof")) return "profissional"
  if (t.includes("engra") || t.includes("fun")) return "engracado"
  return null
}

export async function rewriteWithTone(baseMessage: string, tone?: "formal" | "amigavel" | "profissional" | "engracado") {
  const chosenTone = normalizeTone(tone)
  if (!chosenTone) return { message: baseMessage, used_ai: false }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return { message: baseMessage, used_ai: false }

  const closingPattern =
    /(fico à disposição|fico a disposicao|estamos à disposição|estamos a disposicao|se precisar|qualquer necessidade|agendamento|agendado|agendei)/i
  if (closingPattern.test(baseMessage)) {
    return { message: baseMessage, used_ai: false }
  }

  const systemPrompt =
    "Voce reescreve mensagens de atendimento humano via WhatsApp/chat. " +
    "A mensagem base e deterministica. Reescreva sem mudar a intencao, " +
    "sem inventar informacoes, com frases curtas e naturais, uma pergunta por vez. " +
    "Nao adicione saudacoes nem despedidas novas. " +
    "Retorne apenas uma unica mensagem textual, sem markdown."

  const userPrompt =
    `Mensagem base: "${baseMessage}"\n` +
    `Tom: "${chosenTone}"\n` +
    "Reescreva mantendo exatamente a intencao e os dados."

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 120,
        temperature: 0.4,
      }),
    })

    if (!response.ok) return { message: baseMessage, used_ai: false }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return { message: baseMessage, used_ai: false }

    return { message: content, used_ai: true }
  } catch {
    return { message: baseMessage, used_ai: false }
  }
}

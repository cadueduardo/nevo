// @ts-nocheck
import { normalizeText } from "./utils.ts"
import type { SimulatorState, SimulatorConfig, FlowOrchestratorOutput } from "./types.ts"

const DAY_NAMES: Record<string, string> = {
  monday: "segunda",
  tuesday: "terça",
  wednesday: "quarta",
  thursday: "quinta",
  friday: "sexta",
  saturday: "sábado",
  sunday: "domingo",
}

function buildConfigSummary(config: SimulatorConfig): string {
  const parts: string[] = []
  if (config.business_name) parts.push(`Nome: ${config.business_name}`)
  if (config.business_type) parts.push(`Ramo: ${config.business_type}`)
  const addr = config.establishment_address
  if (addr?.logradouro) {
    const a = `${addr.logradouro}, ${addr.numero}${addr.complemento ? ` ${addr.complemento}` : ""} - ${addr.bairro}, ${addr.localidade}/${addr.uf}`
    parts.push(`Endereço: ${a}`)
  }
  const sched = config.schedule
  if (sched?.days_of_week?.length && sched.start_time && sched.end_time) {
    const days = sched.days_of_week.map((d) => DAY_NAMES[d] || d).join(", ")
    parts.push(`Horário: ${days}, das ${sched.start_time} às ${sched.end_time}`)
    if (sched.interval_minutes) parts.push(`Intervalo entre atendimentos: ${sched.interval_minutes} min`)
  }
  const services = config.services || []
  if (services.length > 0) {
    const withPrice = services.filter((s) => s.base_price != null)
    const svcLines = services.map((s) => {
      const p = s.base_price != null ? `R$ ${s.base_price}` : "valor sob consulta"
      const d = s.duration_minutes ? ` (${s.duration_minutes} min)` : ""
      return `- ${s.name}: ${p}${d}`
    })
    parts.push(`Serviços e preços:\n${svcLines.join("\n")}`)
    if (withPrice.length > 0) {
      parts.push(`\n[IMPORTANTE: ${withPrice.length} serviço(s) tem preço. Quando o cliente perguntar preço, informe o valor exato.]`)
    }
  }
  const staff = config.staff || []
  if (staff.length > 0) {
    parts.push(`Colaboradores: ${staff.map((s) => s.name).join(", ")}`)
  }
  return parts.join("\n")
}

/**
 * Responde de forma natural usando o config como contexto.
 * A IA entende QUALQUER mensagem e responde com os dados disponíveis.
 * Como um ChatGPT que tem as informações do negócio.
 * @param finalizedContext - Se true, o agendamento já foi confirmado; a IA não deve pedir dados de contato.
 */
export async function answerWithContextualAI(
  config: SimulatorConfig,
  message: string,
  history: Array<{ role: string; content: string }> = [],
  finalizedContext = false
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const configSummary = buildConfigSummary(config)
  const historyText =
    history.length > 0
      ? history
          .slice(-8)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histórico)"

  const finalizedHint = finalizedContext
    ? `\nCONTEXTO CRÍTICO: O agendamento do cliente JÁ FOI CONFIRMADO. Ele está apenas agradecendo ou se despedindo. NUNCA peça telefone, email ou qualquer dado de contato novamente. Responda com mensagem cordial e breve de encerramento.\n\n`
    : ""

  const systemPrompt = `Você é a assistente virtual do negócio. O cliente está falando com você pelo chat.
${finalizedHint}DADOS DO NEGÓCIO (use quando relevante para responder):
${configSummary}

REGRAS:
- Responda de forma natural e humana, como se estivesse numa conversa real.
- CONSULTE OS DADOS ACIMA: use apenas as informações que estão no config. Nunca invente serviços, áreas ou ofertas.
- CRÍTICO: O negócio atende SOMENTE as áreas/serviços listados. Se o cliente pedir algo FORA dessas áreas, responda com empatia mas diga claramente que não atuamos, explique quais áreas atendemos e pergunte se precisa de ajuda em alguma delas. NUNCA ofereça agendar para área que não está na lista.
- PREÇOS: Se um serviço tem valor em "R$ X" nos dados, o cliente está perguntando o preço e você DEVE informar esse valor. NUNCA diga "não tenho os valores" se o preço está nos dados. Ex.: "Corte masculino — R$ 50" = quando perguntarem, diga "O corte masculino sai por R$ 50".
- Seja objetiva e prestativa.
- Se não tiver a informação que ele pediu, diga com naturalidade.
- Mantenha o tom profissional mas cordial.
- IMPORTANTE: Tenha atitude e conduza o cliente. Após responder qualquer pergunta informativa (endereço, serviços, horários etc.), SEMPRE adicione uma pergunta ou convite para engajar: ex. "Quer agendar um horário conosco?", "Precisa de ajuda em alguma dessas áreas?", "Posso te ajudar a marcar uma consulta?". O objetivo é converter o lead — seja simpático e proativo, puxando o assunto para o agendamento.`

  const userPrompt = `Histórico da conversa:
${historyText}

Cliente disse: "${message}"

Responda diretamente ao cliente (apenas o texto da resposta, sem prefixos):`

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.5,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    return content || null
  } catch {
    return null
  }
}

export async function interpretFlowWithAI(
  message: string,
  history: Array<{ role: string; content: string }>,
  state: SimulatorState,
  config: SimulatorConfig
): Promise<FlowOrchestratorOutput | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  const businessType = config.business_type || "empresa"
  const servicesJson = servicesList.length ? JSON.stringify(servicesList) : "[]"

  const historyText =
    history.length > 0
      ? history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histórico)"

  const systemPrompt = `Você é um orquestrador de fluxo para assistente virtual de negócios.
O negócio pode ser de QUALQUER ramo (barbearia, advocacia, manicure, personal organizer, etc.) - NUNCA assuma ramo específico.
Você recebe a config do negócio (tipo, serviços) e deve mapear a intenção do cliente aos fluxos disponíveis.

Fluxos disponíveis:
1. answer_price - Cliente quer saber preço/valor. DEVE responder o preço ANTES de qualquer outra ação.
2. list_services - Cliente quer saber o que oferecemos.
3. start_booking - Cliente quer agendar/marcar.
4. service_detail - Cliente quer detalhes de um serviço específico.
5. ask_clarification - Mensagem ambígua; sugerir pergunta de clarificação.
6. no_match_fallback - Não conseguiu mapear a mensagem a nenhum fluxo. Use quando não houver encaixe.

REGRAS:
- Se o cliente PERGUNTOU preço (quanto custa, valor, etc.), retorne suggested_action: "answer_price". NUNCA pule para start_booking.
- Se o cliente fez pergunta DIRETA sobre serviço que não oferecemos (ex: "não tem corte feminino?", "tem X?") NUNCA retorne ask_clarification com "não ficou claro". Use no_match_fallback ou considere que a intenção é saber se oferecemos - a resposta deve explicar o que oferecemos.
- inferred_service: se a mensagem menciona um serviço/tema específico, retorne o que o cliente pediu (ex: "corte feminino"). Se houver match exato com a lista, use o nome da lista. Assim podemos verificar se oferecemos ou não.
- Se o histórico indica que o cliente perguntou sobre X antes e agora pergunta sobre Y (ex: perguntou feminino, depois masculino), considere inferred_attendees: "other_person" ou "multiple".
- Se não conseguir mapear, retorne suggested_action: "no_match_fallback".
- Retorne APENAS JSON válido.`

  const userPrompt = `Mensagem atual do cliente: "${message}"

Histórico recente:
${historyText}

Config do negócio:
- Tipo: ${businessType}
- Serviços oferecidos: ${servicesJson}

Retorne JSON com: intent, inferred_service (o que o cliente pediu ou nome exato da lista se houver match), inferred_attendees (single|multiple|other_person ou null), suggested_action, clarification_question (string ou null), confidence (0-1).`

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const action = parsed.suggested_action
    const validActions = ["answer_price", "start_booking", "list_services", "ask_clarification", "no_match_fallback", "service_detail"]
    if (!validActions.includes(action)) return null
    const inferredService =
      parsed.inferred_service && typeof parsed.inferred_service === "string"
        ? servicesList.find((s) => normalizeText(s) === normalizeText(parsed.inferred_service)) || parsed.inferred_service
        : undefined
    return {
      intent: parsed.intent || "no_match",
      inferred_service: inferredService,
      inferred_attendees: ["single", "multiple", "other_person"].includes(parsed.inferred_attendees) ? parsed.inferred_attendees : undefined,
      suggested_action: action,
      clarification_question: typeof parsed.clarification_question === "string" ? parsed.clarification_question : undefined,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    }
  } catch {
    return null
  }
}

export async function interpretAdditionalBookingsWithAI(
  text: string,
  context?: { has_completed_booking?: boolean }
): Promise<{ count?: number; has_additional?: boolean } | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return null

  const systemPrompt =
    "Voce interpreta pedidos de agendamento em linguagem natural. " +
    "Retorne apenas JSON valido com os campos: count (numero de agendamentos adicionais, inteiro >=0) " +
    "e has_additional (true/false). Nao invente dados."
  const userPrompt =
    `Mensagem: "${text}"\n` +
    `Contexto: ${context?.has_completed_booking ? "ja existe um agendamento finalizado" : "nao ha agendamento finalizado"}\n` +
    "Se o cliente pedir mais de um agendamento (ex.: 'pra mim e meu primo', '2 agendamentos'), " +
    "retorne count com a quantidade de agendamentos adicionais alem do principal. " +
    "Se o cliente disser que quer agendar para outra pessoa (ex.: 'para meu filho', 'para minha esposa'), " +
    "isso conta como adicional. " +
    "Se nao houver adicional, retorne count 0 e has_additional false."

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
        max_tokens: 80,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const count = typeof parsed.count === "number" ? parsed.count : null
    const hasAdditional = typeof parsed.has_additional === "boolean" ? parsed.has_additional : null
    if (count === null && hasAdditional === null) return null
    return { count: count ?? undefined, has_additional: hasAdditional ?? undefined }
  } catch {
    return null
  }
}

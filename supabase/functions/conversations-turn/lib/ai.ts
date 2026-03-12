// @ts-nocheck
import { normalizeText, getTodayIsoBusinessTz, addDaysToIsoDate, getWeekdayKey } from "./utils.ts"
import type { SimulatorState, SimulatorConfig, FlowOrchestratorOutput } from "./types.ts"
import { findServicesFromText } from "./services.ts"

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
    if (sched.breaks?.length) {
      const breaksStr = sched.breaks.map((b) => `${b.start} às ${b.end}`).join("; ")
      parts.push(`Pausa no expediente (nao atendemos nesses horarios): ${breaksStr}`)
    }
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
  const faq = Array.isArray(config.faq) ? config.faq.filter((item) => item?.question || item?.answer) : []
  if (faq.length > 0) {
    const faqLines = faq
      .map((item) => `- ${String(item.question || "Pergunta").trim()}: ${String(item.answer || "").trim()}`)
      .join("\n")
    parts.push(`FAQ:
${faqLines}`)
  }

  const staff = config.staff || []
  if (staff.length > 0) {
    parts.push(`Colaboradores: ${staff.map((s) => s.name).join(", ")}`)
  }
  const ta = config.target_audience
  const modes = Array.isArray(ta?.modes) && ta.modes.length > 0 ? ta.modes : ta?.mode ? [ta.mode] : ["all"]
  const audienceLabels: Record<string, string> = {
    all: "todos os publicos",
    women_only: "somente mulheres",
    men_only: "somente homens",
    kids_only: "somente publico infantil",
    custom: ta?.note?.trim() || "publico personalizado",
  }
  const audienceText =
    modes.length === 0 || (modes.length === 1 && modes[0] === "all")
      ? audienceLabels.all
      : modes.map((m) => audienceLabels[m] || m).filter(Boolean).join(" e ")
  parts.push(`Publico-alvo: ${audienceText}`)

  const style = config.interaction_style || "numbered_options"
  const styleLabel =
    style === "conversational" ? "conversa natural" : style === "hybrid" ? "hibrido (natural + opcoes)" : "opcoes numeradas"
  parts.push(`Estilo de interacao: ${styleLabel}`)

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
    ? `\nCONTEXTO CRÍTICO: O agendamento do cliente JÁ FOI CONFIRMADO. Ele pode estar agradecendo, perguntando endereço/horário ou se despedindo. NUNCA peça telefone, email ou qualquer dado de contato novamente. NUNCA sugira "agendar um horário" ou "marcar consulta" — conecte à conversa que ele acabou de concluir (ex.: "Se precisar de algo mais, estou à disposição."). Responda só ao que foi perguntado, de forma cordial e breve.\n\n`
    : ""

  const style = config.interaction_style || "numbered_options"
  const styleHint =
    style === "conversational"
      ? `\nESTILO DE INTERAÇÃO: O dono do negócio escolheu CONVERSA NATURAL. O cliente responde em texto livre; não assuma que ele vai escolher por número. Responda de forma natural e humana, como um consierge; evite listar "1 - X, 2 - Y" a menos que seja realmente necessário.\n\n`
      : style === "hybrid"
        ? `\nESTILO DE INTERAÇÃO: O dono escolheu MISTO (natural + opções quando fizer sentido). Equilibre conversa natural com clareza; pode sugerir opções em alguns momentos.\n\n`
        : `\nESTILO DE INTERAÇÃO: O dono escolheu OPÇÕES NUMERADAS. As respostas podem ser exibidas como botões numerados para o cliente responder de forma ágil.\n\n`

  const todayIso = getTodayIsoBusinessTz()
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)
  const dateContext = `Contexto de data (para responder "hoje", "amanhã", etc.): hoje é ${todayIso} (${DAY_NAMES[getWeekdayKey(todayIso)] || "?"}). Amanhã é ${tomorrowIso} (${DAY_NAMES[getWeekdayKey(tomorrowIso)] || "?"}).`

  const systemPrompt = `Você é a assistente virtual do negócio. O cliente está falando com você pelo chat.
${finalizedHint}${styleHint}${dateContext}

DADOS DO NEGÓCIO (use quando relevante para responder):
${configSummary}

REGRAS:
- Ao cumprimentar (oi, ola, bom dia), apresente-se como assistente da empresa e cite o nome do negocio quando disponivel.
- Se o cliente perguntar identidade (ex: "quem estou falando?" ou "quem e voce?"), responda claramente que voce e a assistente virtual da empresa.
- Responda de forma natural e humana, como se estivesse numa conversa real.
- CONSULTE OS DADOS ACIMA: use apenas as informações que estão no config. Nunca invente serviços, áreas ou ofertas.
- CRÍTICO: O negócio atende SOMENTE as áreas/serviços listados. Se o cliente pedir algo FORA dessas áreas, responda com empatia mas diga claramente que não atuamos, explique quais áreas atendemos e pergunte se precisa de ajuda em alguma delas. NUNCA ofereça agendar para área que não está na lista.
- PREÇOS: Se um serviço tem valor em "R$ X" nos dados, o cliente está perguntando o preço e você DEVE informar esse valor. NUNCA diga "não tenho os valores" se o preço está nos dados. Use o nome exato do serviço do config ao informar.
- HORÁRIO PARA UM DIA ESPECÍFICO: Se o cliente perguntar se tem horário/disponibilidade para um dia (ex.: "tem horário para amanhã?", "atendem amanhã?", "tem vaga hoje?"), use os dados de "Horário" e dias de atendimento acima. Responda no contexto: se esse dia está entre os dias que atendemos, diga que sim e repita o horário (ex.: "Sim, amanhã atendemos das 08:00 às 18:00. Quer agendar?"); se esse dia NÃO está (ex.: amanhã é sábado e só atendemos segunda a sexta), diga claramente e sugira outro dia. NUNCA responda só com o horário genérico sem considerar o dia que o cliente perguntou.
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

export async function generateAdaptiveGreetingWithAI(
  config: SimulatorConfig,
  message: string,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const businessName = config.business_name || "a empresa"
  const primaryStaff = Array.isArray(config.staff) && config.staff.length > 0 ? config.staff[0]?.name : undefined
  const assistantLabel = primaryStaff?.trim() || "assistente virtual"
  const contactName = senderDisplayName?.trim() || null
  const historyText =
    history.length > 0
      ? history
          .slice(-4)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem historico)"

  const systemPrompt = `Voce escreve a PRIMEIRA resposta de atendimento via WhatsApp.
Negocio: ${businessName}
Quem atende: ${assistantLabel}
Contato do WhatsApp: ${contactName || "desconhecido"}

Regras:
- Responda em portugues do Brasil.
- Espelhe o TOM do cliente: informal com informal, formal com formal.
- Se houver saudacao ("oi", "e ai", "boa tarde", etc.), responda a saudacao naturalmente.
- Se o nome do contato estiver disponivel, USE esse nome na resposta.
- Identifique a empresa explicitamente quando o nome do negocio estiver disponivel.
- Apresente quem esta falando usando o nome de quem atende quando disponivel.
- Se o cliente sinalizar interesse em agendar, conduza suavemente para o agendamento.
- Se o cliente so cumprimentar ou puxar assunto, responda educadamente e abra espaco para ajudar.
- Nao invente promessas, horarios ou servicos fora do contexto.
- Responda em 1 ou 2 frases, no maximo 240 caracteres.`

  const userPrompt = `Historico recente:
${historyText}

Mensagem do cliente: "${message}"

Gere a resposta inicial do WhatsApp:`

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
        max_tokens: 140,
        temperature: 0.7,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const normalizedContent = normalizeText(content)
    const normalizedContact = normalizeText(contactName || "")
    const normalizedBusiness = normalizeText(config.business_name || "")
    const informalCustomer = /\b(opa|fala|salve|e ai|e ai\?|suave|tranquilo|man)\b/.test(normalizeText(message))
    let finalContent = content

    const hasContactName = Boolean(normalizedContact) && normalizedContent.includes(normalizedContact)
    const hasBusinessName =
      Boolean(normalizedBusiness) &&
      (normalizedContent.includes(normalizedBusiness) || normalizedContent.includes(`da ${normalizedBusiness}`))

    if (!hasContactName || !hasBusinessName) {
      const greetingLead = informalCustomer ? "Opa" : "Ola"
      const contactPart = contactName ? ` ${contactName}` : ""
      const companyPart = config.business_name ? ` da ${config.business_name}` : ""
      const agentPart = primaryStaff?.trim() ? ` Aqui e ${primaryStaff?.trim()}${companyPart}.` : ` Aqui e a assistente${companyPart}.`
      const supportPart = /agend/.test(normalizeText(message))
        ? " Vou te ajudar com o agendamento."
        : " Estou a disposicao para ajudar no que precisar."
      finalContent = `${greetingLead}${contactPart}! Tudo bem por aqui, e voce?${agentPart}${supportPart}`
    }

    return finalContent
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
- Se o cliente fez pergunta DIRETA sobre serviço que não oferecemos (ex: "não tem X?", "tem Y?") NUNCA retorne ask_clarification com "não ficou claro". Use no_match_fallback ou considere que a intenção é saber se oferecemos - a resposta deve explicar o que oferecemos.
- PEDIDO GENÉRICO vs ESPECÍFICO (muito importante):
  * Se o cliente expressou vontade de forma GENÉRICA (ex: "quero um atendimento", "preciso de um serviço", "quero agendar algo") sem citar o nome exato de um serviço da lista, retorne suggested_action: "list_services" e NÃO preencha inferred_service. O sistema vai mostrar todas as opções para o cliente ESCOLHER.
  * Só retorne suggested_action: "start_booking" com inferred_service quando o cliente tiver mencionado um serviço ESPECÍFICO da lista. NUNCA assuma um serviço específico só porque o cliente usou termo genérico da área.
- inferred_service: use apenas quando a mensagem citar claramente um serviço da lista (nome exato ou variação direta). Para pedidos genéricos (categoria/tema sem escolha explícita), retorne list_services sem inferred_service.
- Se o histórico indica que o cliente perguntou sobre X antes e agora pede Y para outra(s) pessoa(s), considere inferred_attendees: "other_person" ou "multiple".
- Se não conseguir mapear, retorne suggested_action: "no_match_fallback".
- MENSAGENS VAGAS OU INCOMPLETAS: Se a mensagem for muito curta, incompleta ou não transmitir intenção clara (ex: letra solta, "a", "o", "kk", fragmento), retorne suggested_action: "ask_clarification" com clarification_question amigável como "Não entendi, pode repetir? Como posso ajudar?" — NUNCA assuma serviço ou intenção em mensagens ambíguas.
- Retorne APENAS JSON válido.`

  const style = config.interaction_style || "numbered_options"
  const styleNote =
    style === "conversational"
      ? " Estilo: CONVERSA NATURAL — priorize interpretar intenção em texto livre; retorne start_booking quando o cliente manifestar vontade de agendar/marcar em QUALQUER redação (não exija palavras como 'agendar' ou 'marcar')."
      : style === "hybrid"
        ? " Estilo: MISTO — interpre contexto; em dúvida, aceite formas naturais de pedir agendamento como start_booking."
        : " Estilo: OPÇÕES NUMERADAS — cliente pode responder por número em alguns momentos."

  const userPrompt = `Mensagem atual do cliente: "${message}"

Histórico recente:
${historyText}

Config do negócio:
- Tipo: ${businessType}
- Serviços oferecidos: ${servicesJson}
-${styleNote}

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

/** Extração de slots a partir de mensagem livre. Usa IA para interpretar contexto. */
export type SlotsInterpretation = {
  /** Nome da pessoa que receberá o agendamento. NÃO incluir termos de parentesco. */
  attendee_name?: string | null
  /** Cliente citou apenas parentesco sem nome (ex: "meu filho") — perguntar o nome. */
  relationship_only?: boolean
  /** Parentesco citado (ex: "filho", "marido") para contexto. */
  relationship?: string | null
  /** Serviço da lista que corresponde ao pedido. */
  service?: string | null
  /** Data em ISO (YYYY-MM-DD) ou dia da semana. */
  date?: string | null
  /** Horário no formato HH:MM. */
  time?: string | null
  /** Cliente quer saber se há horário disponível — consultar agenda antes de responder. */
  needs_availability_check?: boolean
}

export async function interpretSlotsFromMessageWithAI(
  message: string,
  context: {
    waiting_for?: "attendee_name" | "service" | "date" | "time" | "contact"
    current_slots?: { attendee_name?: string; service?: string; date?: string; time?: string }
    services?: Array<{ name: string }>
    history?: Array<{ role: string; content: string }>
    last_assistant_message?: string
    /** Nome do remetente (ex: pushName WhatsApp). Nunca usar como attendee_name. */
    sender_display_name?: string
  },
  config: SimulatorConfig
): Promise<SlotsInterpretation | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const servicesList = (context.services || config.services || []).map((s) => s.name).filter(Boolean)
  const servicesJson = servicesList.length ? JSON.stringify(servicesList) : "[]"
  const historyText =
    context.history && context.history.length > 0
      ? context.history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem histórico)"
  const lastAssistant = context.last_assistant_message || ""
  const waitingFor = context.waiting_for || "attendee_name"
  const slotsDesc = context.current_slots
    ? `Slots atuais: attendee=${context.current_slots.attendee_name || "-"}, service=${context.current_slots.service || "-"}, date=${context.current_slots.date || "-"}, time=${context.current_slots.time || "-"}`
    : ""

  const senderNote =
    context.sender_display_name && context.sender_display_name.trim()
      ? `\nIDENTIDADE DO REMETENTE: A pessoa que ESCREVE pode ter o nome "${context.sender_display_name.trim()}".
- Use "${context.sender_display_name.trim()}" como attendee_name QUANDO a mensagem indica que ELA MESMA quer o serviço: "quero agendar meu corte", "pra mim", "para mim", "agendar para mim".
- NUNCA use "${context.sender_display_name.trim()}" como attendee_name QUANDO a mensagem indica agendamento PARA OUTRA PESSOA: "meu marido", "meu filho", "pro meu marido", "agenda para o meu filho", etc. Nestes casos, use relationship_only + relationship ou o nome da outra pessoa.`
      : ""

  const systemPrompt = `Você extrai informações estruturadas de mensagens livres do cliente em um fluxo de agendamento.
${senderNote}

REGRAS para attendee_name:
- attendee_name = a pessoa que VAI RECEBER o serviço (a persona do agendamento). Quem escreve pode estar agendando para si ou para outro (filho, marido, etc.).
- Use compreensão de linguagem natural: leia a frase no contexto da última pergunta do assistente e identifique a persona (quem recebe o agendamento). Extraia o nome próprio dessa pessoa, independentemente de como o cliente se expressou — só o nome, nome na frase, parentesco + nome, referência a si + nome, etc.
- Se a última pergunta foi "De quem será o primeiro/próximo agendamento?" ou "Qual o nome dele(a)?", a resposta do cliente pode ser imprevisível. Sua tarefa é interpretar o texto e extrair o nome da pessoa que receberá o agendamento. Não espere formato fixo.
- relationship_only: true apenas quando o cliente menciona parentesco ou relação (filho, marido, etc.) e NÃO informa o nome próprio. Se houver nome próprio na mensagem, extraia em attendee_name e relationship_only: false.
- Se o cliente indicar que é para ele mesmo mas não disser o nome, use sender_display_name se disponível no contexto; caso contrário deixe attendee_name null e relationship_only conforme o caso.
- Nome = substantivo próprio da pessoa (não cargo, não profissão, não só "meu filho" sem nome). Se só há relação sem nome, relationship_only + relationship.

REGRAS para service, date, time:
- Extraia serviço apenas se corresponder à lista: ${servicesJson}
- Datas: "hoje", "pra hoje", "para hoje" → date: YYYY-MM-DD de hoje. "amanhã", "pra amanhã", "para amanhã" → date: YYYY-MM-DD de amanhã. "segunda", "terça", etc. → a próxima ocorrência.
- Horários: "às 14", "14h", "as 14" → time: "14:00"
- "tem horário às 14?" ou "tem disponibilidade às 14?" → needs_availability_check: true, time: "14:00"
- "quero agendar pra amanhã", "pra hoje ainda tem vaga?" → extraia a data (hoje/amanhã) em YYYY-MM-DD.
${(config.interaction_style === "conversational" || config.interaction_style === "hybrid") ? " Estilo conversacional/híbrido: o cliente pode indicar serviço, data e horário de qualquer forma; use o histórico e a mensagem para extrair, mesmo que seja indireto ou coloquial." : ""}

Retorne APENAS JSON: attendee_name (string ou null), relationship_only (boolean), relationship (string ou null), service (string da lista ou null), date (YYYY-MM-DD ou null), time (HH:MM ou null), needs_availability_check (boolean).`

  const userPrompt = `Última pergunta do assistente: "${lastAssistant}"

${slotsDesc}

Mensagem atual do cliente: "${message}"

${historyText ? `Histórico:\n${historyText}` : ""}

Extraia as informações. Retorne JSON.`

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
        max_tokens: 150,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    let attendee =
      parsed.attendee_name != null && typeof parsed.attendee_name === "string" && parsed.attendee_name.trim()
        ? parsed.attendee_name.trim()
        : undefined
    let relOnly = parsed.relationship_only === true
    let rel = parsed.relationship && typeof parsed.relationship === "string" ? parsed.relationship.trim() : null

    // Só rejeitar attendee=remetente quando há evidência de que está agendando para OUTRA pessoa (marido, filho, etc.)
    const sender = context.sender_display_name?.trim()
    const schedulingForOther = relOnly || (rel && !/^(eu|mesm[ao]|mim)$/i.test(rel))
    if (attendee && sender && normalizeText(attendee) === normalizeText(sender) && schedulingForOther) {
      attendee = undefined
      relOnly = true
      rel = rel || "pessoa"
    }
    const svc =
      parsed.service && typeof parsed.service === "string"
        ? servicesList.find((s) => normalizeText(s) === normalizeText(parsed.service)) || parsed.service
        : undefined
    const time =
      parsed.time && typeof parsed.time === "string"
        ? parsed.time.includes(":")
          ? parsed.time
          : `${String(parseInt(parsed.time, 10)).padStart(2, "0")}:00`
        : undefined
    return {
      attendee_name: attendee ?? null,
      relationship_only: relOnly,
      relationship: rel ?? null,
      service: svc ?? null,
      date: parsed.date && typeof parsed.date === "string" ? parsed.date : null,
      time: time ?? null,
      needs_availability_check: parsed.needs_availability_check === true,
    }
  } catch {
    return null
  }
}

/**
 * Extrai o nome do atendido quando o contexto é "De quem será o primeiro/próximo agendamento?".
 * A IA interpreta o texto livre e identifica a persona que receberá o agendamento, sem depender de exemplos fixos.
 */
export async function extractAttendeeNameForMultiBooking(
  message: string,
  context: { lastAssistantMessage?: string }
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const trimmed = (message || "").trim()
  if (trimmed.length < 2 || trimmed.length > 300) return null

  const lastMsg = (context.lastAssistantMessage || "").trim()
  const prompt = `Contexto: o assistente perguntou quem será o primeiro ou o próximo agendamento.

Resposta do cliente: "${trimmed}"
${lastMsg ? `Última pergunta do assistente: "${lastMsg}"` : ""}

Tarefa: a partir da resposta do cliente, identifique a pessoa que vai receber o agendamento (a persona do atendimento) e extraia apenas o nome próprio dessa pessoa. Use compreensão de linguagem natural: o cliente pode escrever só o nome, uma frase com parentesco e nome, referência a si mesmo e nome, ou qualquer outra forma. Interprete o contexto e extraia o nome.

Se não for possível identificar um nome próprio (pessoa que recebe o serviço), retorne null.
Retorne APENAS um JSON: { "attendee_name": "Nome" } ou { "attendee_name": null }.`

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
          { role: "system", content: "Você é um extrator de entidades. Dada a pergunta do assistente e a resposta do cliente, identifique a persona que receberá o agendamento e extraia apenas o nome próprio. Interprete o texto; não dependa de formato fixo. Retorne apenas JSON com attendee_name (string ou null)." },
          { role: "user", content: prompt },
        ],
        max_tokens: 60,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const name = parsed?.attendee_name
    if (name != null && typeof name === "string" && name.trim().length >= 2 && name.length <= 120) {
      return name.trim()
    }
    return null
  } catch {
    return null
  }
}

/**
 * Gera resposta fluida quando o cliente pergunta sobre disponibilidade.
 * Ex: cliente pergunta se tem horário às 14 → consulta agenda → confirma e pergunta se pode confirmar.
 */
export async function generateAvailabilityResponseWithAI(
  config: SimulatorConfig,
  context: {
    attendee_name?: string
    requested_time: string
    date_iso: string
    is_available: boolean
    available_slots?: string[]
    service?: string
    /** Motivo real (ex.: pausa, fora do expediente). Quando informado, a IA DEVE usar esse motivo e não inventar "intervalo entre atendimentos". */
    unavailable_reason?: string
  },
  history: Array<{ role: string; content: string }> = []
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  const fallbackUnavailable = `Infelizmente as ${context.requested_time} nao esta disponivel. Temos: ${(context.available_slots || []).slice(0, 6).join(", ")}. Qual prefere?`
  if (!apiKey) {
    return context.is_available
      ? `Claro! Temos horario as ${context.requested_time}. Posso confirmar?`
      : fallbackUnavailable
  }

  const historyText =
    history.length > 0
      ? history
          .slice(-4)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : ""
  const attendeePart = context.attendee_name ? ` para ${context.attendee_name}` : ""
  const servicePart = context.service ? ` (${context.service})` : ""

  const reasonInstruction =
    context.unavailable_reason?.trim()
      ? `MOTIVO REAL (use exatamente isso, nao invente "intervalo entre atendimentos"): ${context.unavailable_reason}. Sugira apenas horarios da lista Horarios livres.`
      : "Informe que aquele horario nao esta livre e sugira alternativas da lista available_slots."

  const systemPrompt = `Voce gera mensagens curtas e naturais para atendimento via chat.
O cliente perguntou se ha horario disponivel. Voce ja consultou a agenda.

Se is_available=true: confirme que temos o horario e pergunte se pode confirmar o agendamento. Seja cordial.
Se is_available=false: ${reasonInstruction} Convide a escolher.

Mantenha 1-2 frases. Retorne apenas o texto, sem markdown.`

  const userPrompt = `Contexto:
- Cliente quer agendar${attendeePart}${servicePart}
- Horario solicitado: ${context.requested_time}
- Data: ${context.date_iso}
- Disponivel: ${context.is_available ? "sim" : "nao"}
${!context.is_available && context.available_slots?.length ? `- Horarios livres (sugira apenas estes): ${context.available_slots.slice(0, 10).join(", ")}` : ""}
${!context.is_available && context.unavailable_reason ? `- Motivo: ${context.unavailable_reason}` : ""}
${historyText ? `\nHistorico:\n${historyText}` : ""}

Gere a resposta fluida:`

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
        max_tokens: 150,
        temperature: 0.5,
      }),
    })
    if (!response.ok) throw new Error()
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (content) return content
  } catch {
    // fallback
  }
  return context.is_available
    ? `Claro! Temos horario as ${context.requested_time}. Posso confirmar?`
    : `Infelizmente as ${context.requested_time} nao esta disponivel. Temos: ${(context.available_slots || []).slice(0, 6).join(", ")}. Qual prefere?`
}

/** Retorno da análise de agendamentos: único vs múltiplos e para quem. */
export type AdditionalBookingsInterpretation = {
  count?: number
  has_additional?: boolean
  /** Quando é um ÚNICO agendamento para outra pessoa (ex: "quero agendar para meu marido"). */
  for_whom?: string | null
}


export type BookingRequestInterpretation = {
  booking_intent?: boolean
  includes_self?: boolean
  attendee_names?: string[]
  additional_count?: number
  for_whom?: string | null
  service_names?: string[]
}
export async function interpretAdditionalBookingsWithAI(
  text: string,
  context?: { has_completed_booking?: boolean; history?: Array<{ role: string; content: string }> }
): Promise<AdditionalBookingsInterpretation | null> {
  const normalized = normalizeText(text || "")
  if (normalized) {
    const explicitMultiplePeople =
      /\b(pra|para|pro)\s+mim\s+e\s+(pro|pra|para)?\s*meu\s+(filho|irmao|irmão|marido|pai|primo|amigo)\b/.test(normalized) ||
      /\b(eu)\s+e\s+(meu|minha)\s+(filho|filha|irmao|irmão|irma|irmã|marido|esposa|pai|mae|mãe|primo|prima|amigo|amiga)\b/.test(normalized) ||
      /\bum\s+pra\s+mim\s+e\s+outro\b/.test(normalized) ||
      /\bdois\s+agendamentos\b/.test(normalized)
    if (explicitMultiplePeople) {
      return { has_additional: true, count: 1, for_whom: null }
    }
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return null

  const historyText =
    context?.history && context.history.length > 0
      ? context.history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : ""

  const systemPrompt =
    "Voce interpreta pedidos de agendamento em linguagem natural. " +
    "Use o historico da conversa quando fornecido: o cliente pode ter feito perguntas antes (endereco, horarios, precos) e SO AGORA expressar o pedido. " +
    "Retorne apenas JSON valido com os campos: count (numero de agendamentos adicionais, inteiro >=0), " +
    "has_additional (true/false) e for_whom (string ou null). Nao invente dados."
  const userPrompt =
    (historyText ? `Historico recente:\n${historyText}\n\n` : "") +
    `Mensagem atual: "${text}"\n` +
    `Contexto: ${context?.has_completed_booking ? "ja existe um agendamento finalizado" : "nao ha agendamento finalizado"}\n` +
    "REGRAS:\n" +
    "- VARIOS SERVICOS para a MESMA pessoa (ex: 'corte e barba', 'corte de cabelo e barba', 'quero os dois') = UM so agendamento. Retorne has_additional FALSE e count 0.\n" +
    "- Um UNICO agendamento PARA outra pessoa (ex.: 'quero agendar para meu marido', 'agendar para minha esposa', 'para [nome]') = UM só agendamento. Retorne has_additional FALSE, count 0 e for_whom com a menção (parentesco ou nome).\n" +
    "- Múltiplos agendamentos: só quando o cliente quer MAIS DE UMA PESSOA/horário (ex.: 'pra mim e pro meu filho', 'dois agendamentos', 'um pra mim e outro pra outra pessoa'). " +
    "Retorne has_additional true e count com a quantidade de PESSOAS adicionais.\n" +
    "- Se nao houver mencao a outra pessoa nem multiplos, retorne count 0, has_additional false e for_whom null."

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
    const forWhom =
      parsed.for_whom === null || parsed.for_whom === undefined
        ? undefined
        : typeof parsed.for_whom === "string" && parsed.for_whom.trim()
          ? parsed.for_whom.trim()
          : undefined
    if (count === null && hasAdditional === null && forWhom === undefined) return null
    return {
      count: count ?? undefined,
      has_additional: hasAdditional ?? undefined,
      for_whom: forWhom ?? null,
    }
  } catch {
    return null
  }
}


export async function interpretBookingRequestWithAI(
  text: string,
  context: {
    history?: Array<{ role: string; content: string }>
    sender_display_name?: string
  },
  config: SimulatorConfig
): Promise<BookingRequestInterpretation | null> {
  const normalized = normalizeText(text || "")
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  const heuristicServices = findServicesFromText(text, config.services || [])
  const explicitCountMatch =
    normalized.match(/\bnos?\s+(\d+)\b/) ||
    normalized.match(/\b(\d+)\s+(pessoas|agendamentos|cortes?)\b/)
  const explicitTotal = explicitCountMatch ? Number(explicitCountMatch[1]) : null
  if (explicitTotal && explicitTotal >= 2) {
    return {
      booking_intent: true,
      includes_self: /\b(pra|para|pro)\s+mim\b|\beu\b|\bnos\b|\bn[o?]s\b/.test(normalized),
      attendee_names: [],
      additional_count: explicitTotal - 1,
      for_whom: null,
      service_names: heuristicServices,
    }
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) {
    return heuristicServices.length > 0
      ? {
          booking_intent: true,
          includes_self: /\b(pra|para|pro)\s+mim\b|\beu\b/.test(normalized),
          attendee_names: [],
          additional_count: 0,
          for_whom: null,
          service_names: heuristicServices,
        }
      : null
  }

  const historyText =
    context.history && context.history.length > 0
      ? context.history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : "(sem historico)"
  const servicesJson = servicesList.length ? JSON.stringify(servicesList) : "[]"
  const senderLine = context.sender_display_name?.trim()
    ? `Nome do remetente atual: "${context.sender_display_name.trim()}".`
    : "Nome do remetente atual: desconhecido."

  const systemPrompt =
    "Voce extrai um pedido de agendamento em estrutura semantica. " +
    "Interprete linguagem natural, variacoes informais, nomes, parentescos e quantidade de pessoas. " +
    "Nao dependa de frases fixas. Retorne apenas JSON valido."

  const userPrompt =
    `Mensagem atual: "${text}"\n` +
    `Historico recente:\n${historyText}\n` +
    `${senderLine}\n` +
    `Servicos do negocio: ${servicesJson}\n\n` +
    "Retorne JSON com:\n" +
    '- booking_intent (boolean): true quando a mensagem quer marcar/agendar atendimento.\n' +
    '- includes_self (boolean): true quando a pessoa inclui a si mesma no pedido ("pra mim", "eu", "nos").\n' +
    '- attendee_names (array de strings): nomes proprios de pessoas citadas que vao receber atendimento. Nao inclua parentesco sem nome. Nao invente nome.\n' +
    '- additional_count (numero inteiro >= 0): quantidade de pessoas adicionais apos o primeiro agendamento.\n' +
    '- for_whom (string ou null): quando for um unico agendamento para outra pessoa sem multiagendamento claro.\n' +
    '- service_names (array de strings): servicos citados que existam na lista do negocio.\n\n' +
    "Regras criticas:\n" +
    '- "pra mim e meu irmao", "eu e meu amigo", "nos 3", "cabelo dos muleque Davi, Carlos, Joao" = booking_intent true e additional_count correto.\n' +
    '- Quando a mensagem citar 2 ou mais pessoas pelo nome, considere multiagendamento.\n' +
    '- "quero agendar um corte pro Gustavo" = booking_intent true, attendee_names ["Gustavo"], additional_count 0.\n' +
    '- "quero agendar pro Elisa e o Malaquias" = booking_intent true, attendee_names ["Elisa","Malaquias"], additional_count 1.\n' +
    '- Varios servicos para a mesma pessoa NAO significam multiagendamento.\n' +
    '- Se houver duvida entre uma ou varias pessoas, prefira refletir a mensagem literal do cliente.\n'

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
        max_tokens: 220,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const attendeeNames = Array.isArray(parsed.attendee_names)
      ? parsed.attendee_names
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => value.trim())
      : []
    const matchedServices = Array.isArray(parsed.service_names)
      ? parsed.service_names
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => servicesList.find((svc) => normalizeText(svc) === normalizeText(value)) || value.trim())
      : heuristicServices
    const additionalCountRaw =
      typeof parsed.additional_count === "number" && parsed.additional_count >= 0
        ? parsed.additional_count
        : null
    return {
      booking_intent: parsed.booking_intent === true,
      includes_self: parsed.includes_self === true,
      attendee_names: Array.from(new Set(attendeeNames)),
      additional_count:
        additionalCountRaw ??
        (attendeeNames.length > 1 ? attendeeNames.length - 1 : 0),
      for_whom:
        typeof parsed.for_whom === "string" && parsed.for_whom.trim()
          ? parsed.for_whom.trim()
          : null,
      service_names: Array.from(new Set(matchedServices.filter(Boolean))),
    }
  } catch {
    return null
  }
}

/**
 * Extrai preferência de contato (celular, email ou ambos) a partir de texto livre.
 * Usa IA para entender respostas como "pode ser pelo meu celular", "telefone", "por email", etc.
 * Retorna "phone" | "email" | "both" | null.
 */
export async function extractContactPreferenceFromText(
  message: string,
  history: Array<{ role: string; content: string }> = []
): Promise<"phone" | "email" | "both" | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const historyText =
    history.length > 0
      ? history
          .slice(-4)
          .map((m) => `${m.role === "user" ? "Cliente" : "Assistente"}: ${m.content}`)
          .join("\n")
      : ""

  const systemPrompt = `Você extrai a preferência de contato do cliente. O assistente perguntou como prefere ser contatado para confirmar o agendamento (opções: só celular/telefone, só email, ou os dois).
O cliente respondeu em texto livre. Sua tarefa: identificar se ele quer ser contatado por CELULAR/TELEFONE, por EMAIL, ou pelos DOIS.
Retorne APENAS uma das palavras: phone, email, both. Se não der para identificar, retorne: unknown.
Exemplos: "pode ser pelo meu celular" -> phone. "celular" -> phone. "telefone" -> phone. "por email" -> email. "no meu email" -> email. "os dois" -> both. "tanto faz" -> unknown.`

  const userPrompt = historyText
    ? `Histórico recente:\n${historyText}\n\nResposta atual do cliente: "${message}"\n\nPreferência (phone/email/both/unknown):`
    : `Resposta do cliente: "${message}"\n\nPreferência (phone/email/both/unknown):`

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
        max_tokens: 20,
        temperature: 0.1,
      }),
    })
    if (!response.ok) return null
    const data = await response.json()
    const content = (data.choices?.[0]?.message?.content?.trim() || "").toLowerCase()
    if (content === "phone") return "phone"
    if (content === "email") return "email"
    if (content === "both") return "both"
    return null
  } catch {
    return null
  }
}

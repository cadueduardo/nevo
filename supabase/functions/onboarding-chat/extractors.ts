// @ts-nocheck
// Funções de extração de modelo de negócio (IA + fallback)

export interface BusinessModelExtraction {
  business_type?: string
  business_segment?:
    | 'juridico'
    | 'odontologia'
    | 'saude'
    | 'psicologia'
    | 'barbearia'
    | 'beleza'
    | 'imobiliaria'
    | 'contabilidade'
    | 'consultoria'
    | 'educacao'
    | 'tecnologia'
    | 'outros'
  business_name?: string
  services?: Array<{
    name: string
    duration_minutes?: number
    base_price?: number
    description?: string
  }>
  services_duration_configured?: boolean
  staff?: Array<{
    name: string
    use_business_schedule?: boolean
    schedule?: {
      days_of_week?: string[]
      start_time?: string
      end_time?: string
      breaks?: Array<{ start: string; end: string }>
      interval_minutes?: number
    }
  }>
  service_area?: {
    region?: string
    coverage?: string
  }
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
  }
  policies?: {
    cancellation_hours?: number
    deposit_percentage?: number
  }
  context?: 'booking' | 'quote' | 'both'
  tone_of_voice?: 'formal' | 'friendly' | 'professional' | 'funny'
  handoff_mode?: 'always' | 'conditional' | 'never'
  target_audience?: {
    mode?: 'all' | 'women_only' | 'men_only' | 'kids_only' | 'custom'
    modes?: ('all' | 'women_only' | 'men_only' | 'kids_only' | 'custom')[]
    note?: string
  }
  interaction_style?: 'numbered_options' | 'conversational' | 'hybrid'
  /** Cliente pode agendar vários serviços em sequência na mesma visita. */
  allow_sequence_booking?: boolean
  /** Serviços que podem ser combinados em sequência (quando allow_sequence_booking). */
  sequence_eligible_services?: string[]
}

function normalizeServiceName(value: string): string {
  return value.trim().replace(/\.+$/, '').replace(/\s{2,}/g, ' ')
}

/**
 * Classifica se o usuário demonstra falta de orientação / não sabe o que fazer.
 * IA first: detecta frases variadas fora do escopo de padrões fixos.
 */
export async function classifyNeedsIntroTutorial(message: string): Promise<boolean> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) return isNeedsIntroTutorialFallback(message)

  try {
    const prompt = `Você classifica a intenção do usuário em um chat de onboarding de negócios.
O usuário está na fase inicial e enviou uma mensagem.

Mensagem: "${message}"

Retorne APENAS um JSON com: { "needs_intro_tutorial": true ou false }

needs_intro_tutorial = true quando o usuário demonstra:
- Não saber o que fazer ("não sei o que fazer", "por onde começo", "tô perdido", "me orienta")
- Dúvida sobre o serviço ("o que é isso", "como funciona", "não entendi")
- Pedido de explicação genérico ("me explica", "pode explicar", "preciso de ajuda")
- Frases curtas de confusão ("?", "e agora?", "hã?")
- PERGUNTAS SOBRE O QUE PODE FAZER no sistema ("posso cadastrar endereço?", "posso cadastrar serviços?", "dá pra configurar X?", "eu posso cadastrar meu endereço?") — são dúvidas, NÃO descrição do negócio

needs_intro_tutorial = false quando o usuário:
- Já descreve o negócio ("tenho uma barbearia", "sou manicure", "cabeleireiro")
- Dá cumprimento curto mas com contexto ("oi, quero configurar", "vamos começar")

IMPORTANTE: "posso cadastrar X?" ou "eu posso cadastrar meu endereço?" = dúvida sobre o produto, retorne true. Não confunda com o ramo do negócio.

Retorne APENAS o JSON, sem markdown.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é um classificador de intenções. Retorne apenas JSON válido.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 50,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
    if (!response.ok) return isNeedsIntroTutorialFallback(message)
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim() || '{}'
    const parsed = JSON.parse(content)
    return parsed.needs_intro_tutorial === true
  } catch {
    return isNeedsIntroTutorialFallback(message)
  }
}

/**
 * Responde fluidamente a dúvidas do usuário no início do onboarding.
 * Retorna resposta natural + se parece pronto para iniciar o fluxo.
 */
export async function answerDoubtWithAI(
  message: string,
  context?: { lastWasTutorial?: boolean }
): Promise<{ response: string; ready_to_start?: boolean }> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) {
    return {
      response:
        'Fique à vontade! Posso te explicar como funciona. O Nevo te ajuda a configurar um assistente virtual para o seu negócio.',
    }
  }

  try {
    const prompt = `Você é a assistente do Nevo, uma plataforma que configura assistentes virtuais para negócios (agendamento, orçamento, atendimento).
O usuário está no início do cadastro e demonstrou dúvidas (ex: "preciso de ajuda", "posso cadastrar serviços?").
${context?.lastWasTutorial ? 'Ele já viu o tutorial inicial antes e ainda tem dúvidas.' : ''}

Mensagem do usuário: "${message}"

Responda de forma **fluida, acolhedora e natural** em 1-3 frases curtas. Seja direta.
- Se ele perguntar se pode fazer algo (ex: "posso cadastrar serviços?"): responda de forma positiva e incentive a começar. Ex: "Claro que sim! Você pode cadastrar os serviços, colocar valores e muito mais. Vamos começar?"
- Se ele ainda está perdido: acolha e diga que você vai mostrar o passo a passo de novo.
- NÃO repita o tutorial inteiro no seu texto — apenas responda à dúvida dele. O tutorial completo será mostrado em seguida.

Retorne APENAS um JSON: { "response": "sua resposta aqui", "ready_to_start": true ou false }
ready_to_start = true se ele parece pronto para iniciar (perguntou se pode fazer X, disse que quer começar, etc).`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Você é uma assistente acolhedora. Retorne apenas JSON válido.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.6,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) throw new Error('API error')
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() || '{}'
    const parsed = JSON.parse(content)
    return {
      response: typeof parsed.response === 'string' ? parsed.response : 'Fique à vontade, vou te guiar!',
      ready_to_start: parsed.ready_to_start === true,
    }
  } catch {
    return {
      response: 'Fique à vontade! Vou te mostrar o passo a passo de novo.',
    }
  }
}

/**
 * Sugere exemplos de serviços com base no tipo de negócio via IA.
 * IA categoriza o ramo e retorna serviços equivalentes ao negócio — sem mapeamento estático.
 */
export async function suggestServicesWithAI(businessType: string): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey || !businessType?.trim()) return 'consulta, avaliacao, atendimento'

  try {
    const prompt = `O negócio é: "${businessType}".

Pense no ramo de atividade e liste os serviços ou procedimentos típicos que esse negócio oferece. Seja específico ao ramo — ex.: editor de vídeo: edição, motion graphics, correção de cor; barbearia: corte, barba, sobrancelha.

Liste de 4 a 8 serviços (mais se o ramo tiver muitas opções comuns). Separe por vírgula, em português, termos curtos.

Retorne APENAS a lista, sem explicação, sem numeração. Exemplo: "edicao de video, motion graphics, correcao de cor, transcricao, legenda"`

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Retorne apenas uma lista de serviços separados por vírgula, em minúsculas.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 80,
        temperature: 0.3,
      }),
    })
    if (!res.ok) throw new Error('API error')
    const data = await res.json()
    const text = (data.choices?.[0]?.message?.content || '').trim()
    if (!text) return 'consulta, avaliacao, atendimento'
    // Garantir formato: remover numeração, quebras de linha, manter só vírgulas
    const cleaned = text.replace(/[\d.)\-]\s*/g, '').replace(/\n/g, ', ').replace(/\s*,\s*/g, ', ')
    return cleaned || 'consulta, avaliacao, atendimento'
  } catch {
    return 'consulta, avaliacao, atendimento'
  }
}

/** Fallback determinístico quando a IA não está disponível. */
export function isNeedsIntroTutorialFallback(message: string): boolean {
  const t = (message || '').toLowerCase().trim()
  if (t.length < 3) return false
  const patterns = [
    /n[aã]o\s+sei\s+o\s+que\s+fazer/i,
    /por\s+onde\s+come[cç]o/i,
    /o\s+que\s+(eu\s+)?fa[cç]o\s+aqui/i,
    /como\s+funciona/i,
    /n[aã]o\s+entendi/i,
    /me\s+explica/i,
    /preciso\s+de\s+ajuda/i,
    /t[oô]\s+perdido/i,
    /me\s+orienta/i,
    /n[aã]o\s+tenho\s+ideia/i,
    /o\s+que\s+[eé]\s+isso/i,
    /(eu\s+)?posso\s+cadastrar/i,
    /d[aá]\s+pra\s+(cadastrar|configurar)/i,
  ]
  return patterns.some((p) => p.test(t))
}

export function extractServicesFromText(message: string): Array<{ name: string }> {
  const text = (message || '').trim()
  if (!text) return []

  const lower = text.toLowerCase()
  const markers = [
    'meus servicos sao',
    'meus serviços são',
    'servicos:',
    'serviços:',
    'faço',
    'faco',
    'fazemos',
    'oferecemos',
  ]

  let segment = ''
  for (const m of markers) {
    const idx = lower.indexOf(m)
    if (idx >= 0) {
      segment = text.slice(idx + m.length).trim()
      break
    }
  }

  if (!segment) return []

  const parts = segment
    .split(',')
    .flatMap((p) => p.split(/\s+e\s+/i))
    .map((p) => normalizeServiceName(p))
    .filter(Boolean)

  return parts.map((name) => ({ name }))
}

export async function extractBusinessModelWithAI(
  message: string,
  currentData: Partial<BusinessModelExtraction> = {}
): Promise<Partial<BusinessModelExtraction>> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')

  if (!openaiKey) {
    console.log('OpenAI key não configurada, usando fallback')
    return extractBusinessModelFallback(message, currentData)
  }

  try {
    const prompt = `Você é um assistente especializado em extração de informações estruturadas sobre um negócio. Analise a mensagem abaixo e extraia APENAS as informações que o usuário informou explicitamente (ou que sejam inequívocas no texto).

Dados já coletados: ${JSON.stringify(currentData)}

Mensagem do usuário: "${message}"

INSTRUÇÕES DE EXTRAÇÃO INTELIGENTE:

1. TIPO DE NEGÓCIO (business_type):
   - Identifique o ramo de atividade mencionado ou inferido
   - Seja específico: "barbearia", "esmalteria", "loja de cortinas", "design de sobrancelhas", etc.
   - Use o contexto para inferir se não estiver explícito

2. SEGMENTO (business_segment):
   - Classifique o ramo de atividade em UMA das categorias abaixo
   - Use apenas estas opções (ou omita se não for possível classificar):
     juridico, odontologia, saude, psicologia, barbearia, beleza, imobiliaria,
     contabilidade, consultoria, educacao, tecnologia, outros
   - Se o tipo de negócio indicar claramente a categoria, inclua business_segment

3. NOME DO NEGÓCIO (business_name):
   - Procure por padrões: "chamada X", "nome X", "chama X", "meu negócio é X"
   - Extraia o nome completo mencionado

4. SERVIÇOS (services):
   - Extraia APENAS serviços que o usuário oferece de fato no negócio (explícitos na mensagem)
   - Se mencionar "faço X e Y", extraia ambos como serviços separados
   - Se mencionar "vendo X", considere "Venda de X" como serviço
   - Se mencionar "presto serviço de X", extraia X como serviço
   - NÃO inferir serviços só pelo tipo de negócio
   - NÃO cadastrar como serviço frases sobre a plataforma/produto (ex.: "quero um assistente de agendamento", "quero um bot", "quero configurar")
   - Cada serviço: {"name": "Nome do Serviço", "base_price": número APENAS se valor em R$/reais (ex: "R$ 50", "custa 40 reais"), "duration_minutes": número APENAS se duração em min/minutos (ex: "40 min", "duração de 30 minutos"), "description": texto apenas se o usuário descrever}
   - CRÍTICO: "duração de X é 40 min" = duration_minutes: 40. "X custa 40" sem "min" = base_price: 40. Nunca confunda min com reais.

5. LOCALIZAÇÃO (service_area.region):
   - Extraia cidade, região ou bairro mencionados
   - Padrões: "em X", "fica em X", "cidade de X", "atua em X"

6. HORÁRIO E DIAS (schedule):
   - Extraia horário de funcionamento APENAS se o usuário informou (ex.: "9h às 18h", "das 8 as 18", etc.)
   - Converta para formato "HH:mm" (ex: "09:00", "18:00")
   - Para dias da semana, extraia APENAS se o usuário mencionou explicitamente:
     * Se mencionar explicitamente (segunda, terça, etc), converta para inglês: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
     * Se mencionar "segunda a sexta" ou similar, extraia todos os dias do intervalo
     * Se NÃO mencionar dias, NÃO invente/infira dias (deixe o campo ausente)

7. CONTEXTO (context):
   - "booking": se mencionar agendamento, marcação, horários
   - "quote": se mencionar orçamento, preço, valores
   - "both": se mencionar ambos
   - Frases como "quero um assistente de agendamento" devem preencher context="booking" (e não services)

8. COLABORADORES (staff):
   - Extraia apenas se o usuário mencionar colaboradores por nome
   - Ex.: "tenho a Carla e a Maria" -> [{"name":"Carla"},{"name":"Maria"}]
   - Não inventar nomes

9. TOM DE VOZ (tone_of_voice):
   - Extraia APENAS se o usuário pediu explicitamente um tom (ex.: "pode ser mais formal", "bem amigável", etc.)
   - NÃO inferir tom pelo estilo da mensagem
   - Valores: "formal", "friendly", "professional", "funny"

IMPORTANTE:
- NÃO inferir/preencher automaticamente: dias da semana, horários ou tom de voz.
- Se o usuário não informou um desses itens, NÃO inclua o campo no JSON.

Retorne APENAS um JSON válido com os campos identificados:
{
  "business_type": "tipo de negócio",
  "business_segment": "juridico | odontologia | saude | psicologia | barbearia | beleza | imobiliaria | contabilidade | consultoria | educacao | tecnologia | outros",
  "business_name": "nome se mencionado",
  "services": [{"name": "serviço 1", "base_price": número ou omitir, "description": "texto ou omitir"}, {"name": "serviço 2"}],
  "service_area": {"region": "localização"},
  "schedule": {
    "days_of_week": ["monday", "tuesday", ...],
    "start_time": "HH:mm",
    "end_time": "HH:mm"
  },
  "staff": [{"name": "Carla"}, {"name": "Maria"}],
  "context": "booking" | "quote" | "both",
  "tone_of_voice": "formal" | "friendly" | "professional" | "funny"
}

Retorne APENAS o JSON, sem markdown, sem explicações, sem texto adicional.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente especializado em extrair informações estruturadas de textos sobre negócios. Retorne APENAS JSON válido, sem markdown, sem explicações.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('OpenAI API error:', response.status, errorText)
      return extractBusinessModelFallback(message, currentData)
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content?.trim() || '{}'

    try {
      const extracted = JSON.parse(content) as Partial<BusinessModelExtraction>
      // Log apenas de metadados (evitar conteúdo sensível)
      console.log('OpenAI extracted (metadados):', {
        extracted_keys: Object.keys(extracted || {}),
        services_count: Array.isArray((extracted as any)?.services) ? (extracted as any).services.length : 0,
      })
      return extracted
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError)
      return extractBusinessModelFallback(message, currentData)
    }
  } catch (error) {
    console.error('Error calling OpenAI:', error)
    return extractBusinessModelFallback(message, currentData)
  }
}

export function identifyMissingFields(
  data: Partial<BusinessModelExtraction>,
  context?: 'booking' | 'quote' | 'both'
): string[] {
  const missing: string[] = []

  if (!data.business_type) missing.push('business_type')
  if (!data.business_name) missing.push('business_name')

  if (context === 'booking' || context === 'both') {
    if (!data.staff || data.staff.length === 0) missing.push('staff')
    if (!data.services || data.services.length === 0) missing.push('services')
    if (!data.schedule?.days_of_week || data.schedule.days_of_week.length === 0) {
      missing.push('schedule.days_of_week')
    }
    if (!data.schedule?.start_time) missing.push('schedule.start_time')
    if (!data.schedule?.end_time) missing.push('schedule.end_time')
    if (!data.schedule?.interval_minutes) missing.push('schedule.interval_minutes')
    if (data.schedule?.interval_minutes && data.schedule?.min_booking_lead_minutes == null) {
      missing.push('schedule.min_booking_lead_minutes')
    }
  }

  return missing
}

export function parseServicesList(servicesText: string): Array<{ name: string }> {
  return servicesText
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((name) => ({ name }))
}

export function extractQuoteVariables(message: string): string[] {
  const lower = message.toLowerCase()
  const variables: string[] = []

  const keywords = {
    medida: ['medida', 'tamanho', 'dimensão', 'metro', 'cm'],
    largura: ['largura', 'larga', 'lado'],
    altura: ['altura', 'alto', 'pé direito'],
    quantidade: ['quantidade', 'qtd', 'quantos'],
    material: ['material', 'tecido', 'tipo'],
    cor: ['cor', 'cores'],
  }

  for (const [key, terms] of Object.entries(keywords)) {
    if (terms.some((term) => lower.includes(term))) {
      variables.push(key)
    }
  }

  return variables
}

function extractBusinessModelFallback(
  message: string,
  _currentData: Partial<BusinessModelExtraction> = {}
): Partial<BusinessModelExtraction> {
  const lower = message.toLowerCase()
  const result: Partial<BusinessModelExtraction> = {}

  // Extrair tipo de negócio
  if (lower.includes('sobrancelha') || lower.includes('design')) {
    result.business_type = 'design de sobrancelhas'
    result.business_segment = 'beleza'
  } else if (lower.includes('barbearia') || lower.includes('barbeiro')) {
    result.business_type = 'barbearia'
    result.business_segment = 'barbearia'
  } else if (lower.includes('cortina')) {
    result.business_type = 'loja de cortinas'
    result.business_segment = 'outros'
  } else if (lower.includes('advocacia') || lower.includes('advogado') || lower.includes('jurid')) {
    result.business_type = 'escritorio de advocacia'
    result.business_segment = 'juridico'
  } else if (lower.includes('odont') || lower.includes('dent')) {
    result.business_type = 'clinica odontologica'
    result.business_segment = 'odontologia'
  } else if (lower.includes('psicolog') || lower.includes('psico') || lower.includes('terapia')) {
    result.business_type = 'psicologia'
    result.business_segment = 'psicologia'
  } else if (lower.includes('clinica') || lower.includes('medic') || lower.includes('saude')) {
    result.business_type = 'clinica de saude'
    result.business_segment = 'saude'
  }

  // Extrair nome do negócio (padrões: "chamada: X", "nome X", "chama X")
  const namePatterns = [
    /(?:chamada|nome|chama)\s*:?\s*([A-Z][a-záàâãéèêíïóôõöúçñ\s]+?)(?:\s|,|$)/i,
    /(?:meu|minha)\s+(?:negócio|empresa|loja|barbearia|salão)\s+(?:chama|é|se chama)\s+([A-Z][a-záàâãéèêíïóôõöúçñ\s]+?)(?:\s|,|$)/i,
  ]
  
  for (const pattern of namePatterns) {
    const match = message.match(pattern)
    if (match && match[1]) {
      result.business_name = match[1].trim()
      break
    }
  }

  // Extrair região/localização (padrões: "em X", "fica em X", "região X")
  const regionPatterns = [
    /(?:fica\s+)?em\s+([A-Z][a-záàâãéèêíïóôõöúçñ]+(?:\s+[A-Z][a-záàâãéèêíïóôõöúçñ]+)?)/i,
    /(?:região|atende)\s+([A-Z][a-záàâãéèêíïóôõöúçñ]+(?:\s+[A-Z][a-záàâãéèêíïóôõöúçñ]+)?)/i,
  ]
  
  for (const pattern of regionPatterns) {
    const match = message.match(pattern)
    if (match && match[1]) {
      result.service_area = { region: match[1].trim() }
      break
    }
  }

  // Cobertura detalhada (ex.: km18)
  const coverageMatch = lower.match(/\bkm\s?(\d{1,3})\b/)
  if (coverageMatch) {
    result.service_area = {
      ...(result.service_area || {}),
      coverage: `km${coverageMatch[1]}`,
    }
  }

  // Extrair horário (padrões: "9h às 18h", "das 9 as 18", "9 às 18")
  const timePatterns = [
    /(\d{1,2})\s*(?:h|hs|horas?)\s*(?:às|até|-)\s*(\d{1,2})\s*(?:h|hs|horas?)/i,
    /(?:das|de)\s+(\d{1,2})\s*(?:às|até|-)\s*(\d{1,2})/i,
  ]
  
  for (const pattern of timePatterns) {
    const match = message.match(pattern)
    if (match && match[1] && match[2]) {
      result.schedule = {
        start_time: `${match[1].padStart(2, '0')}:00`,
        end_time: `${match[2].padStart(2, '0')}:00`,
      }
      break
    }
  }

  // Extrair dias da semana
  const daysMap: Record<string, string> = {
    segunda: 'monday',
    terça: 'tuesday',
    terca: 'tuesday',
    quarta: 'wednesday',
    quinta: 'thursday',
    sexta: 'friday',
    sábado: 'saturday',
    sabado: 'saturday',
    domingo: 'sunday',
  }
  
  const daysOfWeek: string[] = []
  for (const [pt, en] of Object.entries(daysMap)) {
    if (lower.includes(pt)) {
      daysOfWeek.push(en)
    }
  }
  
  // Padrões especiais
  if (lower.includes('segunda a sexta') || lower.includes('segunda-feira a sexta-feira')) {
    daysOfWeek.push('monday', 'tuesday', 'wednesday', 'thursday', 'friday')
  } else if (lower.includes('segunda a sábado')) {
    daysOfWeek.push('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')
  } else if (lower.includes('todos os dias')) {
    daysOfWeek.push('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  }
  
  if (daysOfWeek.length > 0) {
    result.schedule = {
      ...result.schedule,
      days_of_week: [...new Set(daysOfWeek)], // Remove duplicatas
    }
  }

  // Extrair contexto de uso (agendamento/orçamento)
  const hasBookingIntent =
    lower.includes('agendamento') || lower.includes('agendar') || lower.includes('marcação') || lower.includes('marcacao')
  const hasQuoteIntent =
    lower.includes('orçamento') || lower.includes('orcamento') || lower.includes('orcar') || lower.includes('cotacao') || lower.includes('cotação')
  if (hasBookingIntent && hasQuoteIntent) result.context = 'both'
  else if (hasBookingIntent) result.context = 'booking'
  else if (hasQuoteIntent) result.context = 'quote'

  // NÃO inferir serviços no fallback - deixar a IA fazer isso
  // O fallback é apenas para casos extremos quando a IA não está disponível
  // A inferência de serviços deve ser feita pela IA de forma inteligente e contextual
  const services = extractServicesFromText(message)
  if (services.length > 0) {
    result.services = services
  }

  return result
}

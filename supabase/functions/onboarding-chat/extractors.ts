// @ts-nocheck
// Funções de extração de modelo de negócio (IA + fallback)

export interface BusinessModelExtraction {
  business_type?: string
  business_name?: string
  services?: Array<{
    name: string
    duration_minutes?: number
    base_price?: number
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

2. NOME DO NEGÓCIO (business_name):
   - Procure por padrões: "chamada X", "nome X", "chama X", "meu negócio é X"
   - Extraia o nome completo mencionado

3. SERVIÇOS (services):
   - Seja INTELIGENTE: identifique serviços mencionados explicitamente OU inferidos pelo tipo de negócio
   - Se mencionar "faço X e Y", extraia ambos como serviços separados
   - Se mencionar "vendo X", considere "Venda de X" como serviço
   - Se mencionar "presto serviço de X", extraia X como serviço
   - INFIRA serviços comuns do tipo de negócio quando fizer sentido contextual
   - Cada serviço deve ser um objeto: {"name": "Nome do Serviço"}

4. LOCALIZAÇÃO (service_area.region):
   - Extraia cidade, região ou bairro mencionados
   - Padrões: "em X", "fica em X", "cidade de X", "atua em X"

5. HORÁRIO E DIAS (schedule):
   - Extraia horário de funcionamento APENAS se o usuário informou (ex.: "9h às 18h", "das 8 as 18", etc.)
   - Converta para formato "HH:mm" (ex: "09:00", "18:00")
   - Para dias da semana, extraia APENAS se o usuário mencionou explicitamente:
     * Se mencionar explicitamente (segunda, terça, etc), converta para inglês: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
     * Se mencionar "segunda a sexta" ou similar, extraia todos os dias do intervalo
     * Se NÃO mencionar dias, NÃO invente/infira dias (deixe o campo ausente)

6. CONTEXTO (context):
   - "booking": se mencionar agendamento, marcação, horários
   - "quote": se mencionar orçamento, preço, valores
   - "both": se mencionar ambos

7. TOM DE VOZ (tone_of_voice):
   - Extraia APENAS se o usuário pediu explicitamente um tom (ex.: "pode ser mais formal", "bem amigável", etc.)
   - NÃO inferir tom pelo estilo da mensagem
   - Valores: "formal", "friendly", "professional", "funny"

IMPORTANTE:
- NÃO inferir/preencher automaticamente: dias da semana, horários ou tom de voz.
- Se o usuário não informou um desses itens, NÃO inclua o campo no JSON.

Retorne APENAS um JSON válido com os campos identificados:
{
  "business_type": "tipo de negócio",
  "business_name": "nome se mencionado",
  "services": [{"name": "serviço 1"}, {"name": "serviço 2"}],
  "service_area": {"region": "localização"},
  "schedule": {
    "days_of_week": ["monday", "tuesday", ...],
    "start_time": "HH:mm",
    "end_time": "HH:mm"
  },
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
    if (!data.services || data.services.length === 0) missing.push('services')
    if (!data.schedule?.days_of_week || data.schedule.days_of_week.length === 0) {
      missing.push('schedule.days_of_week')
    }
    if (!data.schedule?.start_time) missing.push('schedule.start_time')
    if (!data.schedule?.end_time) missing.push('schedule.end_time')
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
  } else if (lower.includes('barbearia') || lower.includes('barbeiro')) {
    result.business_type = 'barbearia'
  } else if (lower.includes('cortina')) {
    result.business_type = 'loja de cortinas'
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

  // NÃO inferir serviços no fallback - deixar a IA fazer isso
  // O fallback é apenas para casos extremos quando a IA não está disponível
  // A inferência de serviços deve ser feita pela IA de forma inteligente e contextual

  return result
}

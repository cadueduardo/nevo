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
    const prompt = `Analise a seguinte mensagem e extraia informações sobre o negócio. Retorne APENAS um JSON válido com os campos que conseguir identificar.

Dados já coletados: ${JSON.stringify(currentData)}

Mensagem: "${message}"

Extraia e retorne um JSON com os seguintes campos (apenas os que conseguir identificar):
{
  "business_type": "tipo de negócio (ex: design de sobrancelhas, barbearia, loja de cortinas)",
  "business_name": "nome do negócio se mencionado",
  "services": [{"name": "nome do serviço", "duration_minutes": número, "base_price": número}],
  "service_area": {"region": "região/cidade", "coverage": "área de cobertura"},
  "schedule": {
    "days_of_week": ["monday", "tuesday", etc],
    "start_time": "HH:mm",
    "end_time": "HH:mm",
    "breaks": [{"start": "HH:mm", "end": "HH:mm"}],
    "interval_minutes": número
  },
  "policies": {
    "cancellation_hours": número,
    "deposit_percentage": número
  },
  "context": "booking" | "quote" | "both",
  "tone_of_voice": "formal" | "friendly" | "professional" | "funny"
}

Retorne APENAS o JSON, sem markdown, sem explicações.`

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
      console.log('OpenAI extracted:', extracted)
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

  if (!data.tone_of_voice) missing.push('tone_of_voice')

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

  if (lower.includes('sobrancelha') || lower.includes('design')) {
    result.business_type = 'design de sobrancelhas'
  } else if (lower.includes('barbearia') || lower.includes('corte')) {
    result.business_type = 'barbearia'
  } else if (lower.includes('cortina')) {
    result.business_type = 'loja de cortinas'
  }

  const regionMatch = message.match(/(?:região|em|de)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
  if (regionMatch) {
    result.service_area = { region: regionMatch[1] }
  }

  const timeMatch = message.match(/(\d{1,2})\s*(?:h|hs|horas?)\s*(?:às|até|-)\s*(\d{1,2})\s*(?:h|hs|horas?)/i)
  if (timeMatch) {
    result.schedule = {
      start_time: `${timeMatch[1].padStart(2, '0')}:00`,
      end_time: `${timeMatch[2].padStart(2, '0')}:00`,
    }
  }

  return result
}
// Funções de extração inteligente usando OpenAI

interface BusinessModelExtraction {
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
}

// Extrair múltiplos campos de uma vez usando IA
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
    const prompt = `Analise a seguinte mensagem e extraia informações sobre o negócio. Retorne APENAS um JSON válido com os campos que conseguir identificar.

Dados já coletados: ${JSON.stringify(currentData)}

Mensagem: "${message}"

Extraia e retorne um JSON com os seguintes campos (apenas os que conseguir identificar):
{
  "business_type": "tipo de negócio (ex: design de sobrancelhas, barbearia, loja de cortinas)",
  "business_name": "nome do negócio se mencionado",
  "services": [{"name": "nome do serviço", "duration_minutes": número, "base_price": número}],
  "service_area": {"region": "região/cidade", "coverage": "área de cobertura"},
  "schedule": {
    "days_of_week": ["monday", "tuesday", etc],
    "start_time": "HH:mm",
    "end_time": "HH:mm",
    "breaks": [{"start": "HH:mm", "end": "HH:mm"}],
    "interval_minutes": número
  },
  "policies": {
    "cancellation_hours": número,
    "deposit_percentage": número
  },
  "context": "booking" | "quote" | "both",
  "tone_of_voice": "formal" | "friendly" | "professional" | "funny"
}

Retorne APENAS o JSON, sem markdown, sem explicações.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Usar modelo mais barato para extração
        messages: [
          {
            role: 'system',
            content: 'Você é um assistente especializado em extrair informações estruturadas de textos sobre negócios. Retorne APENAS JSON válido, sem markdown, sem explicações.',
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
      console.log('OpenAI extracted:', extracted)
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

// Fallback básico (extração simples sem IA)
function extractBusinessModelFallback(
  message: string,
  currentData: Partial<BusinessModelExtraction> = {}
): Partial<BusinessModelExtraction> {
  const lower = message.toLowerCase()
  const result: Partial<BusinessModelExtraction> = {}

  // Detectar tipo de negócio básico
  if (lower.includes('sobrancelha') || lower.includes('design')) {
    result.business_type = 'design de sobrancelhas'
  } else if (lower.includes('barbearia') || lower.includes('corte')) {
    result.business_type = 'barbearia'
  } else if (lower.includes('cortina')) {
    result.business_type = 'loja de cortinas'
  }

  // Detectar região
  const regionMatch = message.match(/(?:região|em|de)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
  if (regionMatch) {
    result.service_area = { region: regionMatch[1] }
  }

  // Detectar horários básicos
  const timeMatch = message.match(/(\d{1,2})\s*(?:h|hs|horas?)\s*(?:às|até|-)\s*(\d{1,2})\s*(?:h|hs|horas?)/i)
  if (timeMatch) {
    result.schedule = {
      start_time: `${timeMatch[1].padStart(2, '0')}:00`,
      end_time: `${timeMatch[2].padStart(2, '0')}:00`,
    }
  }

  return result
}

// Identificar campos faltantes baseado no contexto
export function identifyMissingFields(
  data: Partial<BusinessModelExtraction>,
  context?: 'booking' | 'quote' | 'both'
): string[] {
  const missing: string[] = []

  // Campos sempre obrigatórios
  if (!data.business_type) missing.push('business_type')
  if (!data.business_name) missing.push('business_name')

  // Campos obrigatórios para agendamento
  if (context === 'booking' || context === 'both') {
    if (!data.services || data.services.length === 0) missing.push('services')
    if (!data.schedule?.days_of_week || data.schedule.days_of_week.length === 0) {
      missing.push('schedule.days_of_week')
    }
    if (!data.schedule?.start_time) missing.push('schedule.start_time')
    if (!data.schedule?.end_time) missing.push('schedule.end_time')
  }

  // Campos obrigatórios para orçamento
  if (context === 'quote' || context === 'both') {
    // Variáveis dinâmicas serão identificadas durante a conversa
  }

  // Campos opcionais mas importantes
  if (!data.tone_of_voice) missing.push('tone_of_voice')

  return missing
}

// Processar lista de serviços (separada por vírgula)
export function parseServicesList(servicesText: string): Array<{ name: string }> {
  return servicesText
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(name => ({ name }))
}

// Extrair variáveis dinâmicas de contexto de orçamento
export function extractQuoteVariables(message: string): string[] {
  const lower = message.toLowerCase()
  const variables: string[] = []

  // Palavras-chave comuns para variáveis de orçamento
  const keywords = {
    'medida': ['medida', 'tamanho', 'dimensão', 'metro', 'cm'],
    'largura': ['largura', 'larga', 'lado'],
    'altura': ['altura', 'alto', 'pé direito'],
    'quantidade': ['quantidade', 'qtd', 'quantos'],
    'material': ['material', 'tecido', 'tipo'],
    'cor': ['cor', 'cores'],
  }

  for (const [key, terms] of Object.entries(keywords)) {
    if (terms.some(term => lower.includes(term))) {
      variables.push(key)
    }
  }

  return variables
}

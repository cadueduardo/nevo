import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Importar funções dos módulos auxiliares
// Nota: Deno não suporta imports relativos de .ts, então vamos incluir as funções aqui por enquanto

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OnboardingRequest {
  session_id: string
  message: string
  current_step?: string
}

interface OnboardingResponse {
  assistant_message: string
  next_step: string
  extracted_data?: Record<string, any>
  requires_action?: string | null
  action_options?: string[]
}

serve(async (req) => {
  // Handle CORS preflight - deve ser a primeira coisa, ANTES de qualquer await
  if (req.method === 'OPTIONS') {
    return new Response('ok', { 
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Max-Age': '86400',
      }
    })
  }

  try {
    // Validar input - só fazer await req.json() depois do OPTIONS
    const body: OnboardingRequest = await req.json()
    
    if (!body.session_id || !body.message) {
      return new Response(
        JSON.stringify({ error: 'session_id e message são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Criar cliente Supabase com service_role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Buscar ou criar session
    let { data: session, error: sessionError } = await supabaseAdmin
      .from('onboarding_sessions')
      .select('*')
      .eq('session_id', body.session_id)
      .single()

    if (sessionError && sessionError.code === 'PGRST116') {
      // Session não existe, criar nova
      const { data: newSession, error: createError } = await supabaseAdmin
        .from('onboarding_sessions')
        .insert({
          session_id: body.session_id,
          current_step_key: 'welcome',
          collected_data: {},
        })
        .select()
        .single()

      if (createError) {
        throw createError
      }
      session = newSession
    } else if (sessionError) {
      throw sessionError
    }

    // Salvar mensagem do usuário
    await supabaseAdmin
      .from('onboarding_messages')
      .insert({
        session_id: body.session_id,
        role: 'user',
        content: body.message,
      })

    // Obter dados coletados e step atual
    const currentStep = body.current_step || session.current_step_key || 'welcome'
    const collectedData = session.collected_data || {}
    const isFirstMessage = currentStep === 'welcome' || !session.current_step_key
    
    let response: OnboardingResponse

    if (isFirstMessage) {
      // Primeira mensagem: extrair tudo que conseguir e começar onboarding inteligente
      const extracted = await extractBusinessModelWithAI(body.message, collectedData)
      const mergedData = { ...collectedData, ...extracted }
      const missing = identifyMissingFields(mergedData, extracted.context)
      
      response = {
        assistant_message: `Oi! 👋 Eu sou o Nevo.\n\nVou te ajudar a configurar seu atendimento inteligente. Pelo que você me contou, entendi que é um negócio de **${extracted.business_type || 'serviços'}**.\n\nVou fazer algumas perguntas para completar a configuração. Pode ser?`,
        next_step: 'collecting',
        extracted_data: extracted,
      }
    } else {
      // Processar mensagem baseado no step atual
      response = await processMessage(
        body.message,
        currentStep,
        collectedData,
        session
      )
    }

    // Mesclar dados extraídos com dados coletados
    const updatedData = { ...collectedData, ...response.extracted_data }
    
    // Identificar campos faltantes para próxima iteração
    const missingFields = identifyMissingFields(updatedData, updatedData.context)
    
    // Se não há campos faltantes e não está em signup, ir para resumo
    if (missingFields.length === 0 && !currentStep.startsWith('signup') && currentStep !== 'summary' && currentStep !== 'completed') {
      response.next_step = 'summary'
      response.assistant_message = generateSummary(updatedData)
      response.action_options = ['Está correto', 'Quero ajustar']
      response.requires_action = 'summary_confirmation'
    }

    // Atualizar session
    await supabaseAdmin
      .from('onboarding_sessions')
      .update({
        current_step_key: response.next_step,
        collected_data: updatedData,
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', body.session_id)

    // Salvar mensagem do assistente
    await supabaseAdmin
      .from('onboarding_messages')
      .insert({
        session_id: body.session_id,
        role: 'assistant',
        content: response.assistant_message,
        metadata: {
          next_step: response.next_step,
          requires_action: response.requires_action,
          action_options: response.action_options,
          missing_fields: missingFields,
        },
      })

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Processar mensagem baseado no step atual
async function processMessage(
  message: string,
  currentStep: string,
  collectedData: Record<string, any>,
  session: any
): Promise<OnboardingResponse> {
  // Sempre tentar extrair informações da mensagem
  const extracted = await extractBusinessModelWithAI(message, collectedData)
  const mergedData = { ...collectedData, ...extracted }

  // Processar steps específicos
  switch (currentStep) {
    case 'collecting':
      // Coletando informações - usar fluxo adaptativo
      const missing = identifyMissingFields(mergedData, mergedData.context)
      const nextStep = determineNextStep(mergedData, message, {
        step: currentStep,
        collected_data: mergedData,
        missing_fields: missing,
        context: mergedData.context,
      })
      
      return {
        assistant_message: nextStep.message,
        next_step: nextStep.step,
        extracted_data: extracted,
        action_options: nextStep.action_options,
        requires_action: nextStep.requires_action,
      }

    case 'services_list':
      // Processar lista de serviços (separada por vírgula)
      const services = parseServicesList(message)
      return {
        assistant_message: `✅ Adicionei seus serviços:\n${services.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}\n\nQuer adicionar mais algum? Ou podemos continuar?`,
        next_step: 'services_details',
        extracted_data: { services },
        action_options: ['Continuar', 'Adicionar mais'],
      }

    case 'services_details':
      if (message.toLowerCase().includes('continuar') || message.toLowerCase().includes('continuar')) {
        // Continuar para próximo passo
        const missing = identifyMissingFields(mergedData, mergedData.context)
        const nextStep = determineNextStep(mergedData, message, {
          step: currentStep,
          collected_data: mergedData,
          missing_fields: missing,
          context: mergedData.context,
        })
        return {
          assistant_message: nextStep.message,
          next_step: nextStep.step,
          extracted_data: {},
          action_options: nextStep.action_options,
          requires_action: nextStep.requires_action,
        }
      } else {
        // Adicionar mais serviços
        const newServices = parseServicesList(message)
        const existingServices = mergedData.services || []
        return {
          assistant_message: `✅ Adicionei mais serviços:\n${newServices.map((s, i) => `${existingServices.length + i + 1}. ${s.name}`).join('\n')}\n\nMais algum?`,
          next_step: 'services_list',
          extracted_data: { services: [...existingServices, ...newServices] },
        }
      }

    case 'quote_variables':
      // Extrair variáveis de orçamento
      const variables = extractQuoteVariables(message)
      const dynamicVars = variables.map(v => ({
        key: v,
        label: v.charAt(0).toUpperCase() + v.slice(1),
        type: 'text',
        context: 'quote',
      }))
      
      return {
        assistant_message: `Entendi! Para calcular o orçamento, você precisa de: ${variables.join(', ')}\n\nVocê tem mais alguma variável? (ex: tipo de material, cor, etc.)`,
        next_step: 'quote_variables_confirm',
        extracted_data: { dynamic_variables: dynamicVars },
      }

    case 'faq_offer':
      if (message.toLowerCase().includes('sim') || message.toLowerCase().includes('quero')) {
        return {
          assistant_message: 'Perfeito! Me diga uma pergunta que seus clientes costumam fazer e a resposta que você daria.\n\nFormato: "Pergunta? Resposta"',
          next_step: 'faq_question',
          extracted_data: {},
        }
      } else {
        // Pular FAQ
        const missing = identifyMissingFields(mergedData, mergedData.context)
        const nextStep = determineNextStep(mergedData, message, {
          step: currentStep,
          collected_data: mergedData,
          missing_fields: missing,
          context: mergedData.context,
        })
        return {
          assistant_message: nextStep.message,
          next_step: nextStep.step,
          extracted_data: {},
          action_options: nextStep.action_options,
          requires_action: nextStep.requires_action,
        }
      }

    case 'faq_question':
      // Processar FAQ (formato: "Pergunta? Resposta")
      const faqMatch = message.match(/^(.+?)\s*\?\s*(.+)$/)
      if (faqMatch) {
        const faq = {
          question: faqMatch[1].trim(),
          answer: faqMatch[2].trim(),
        }
        const existingFaq = mergedData.faq || []
        return {
          assistant_message: `✅ Adicionei:\nPergunta: "${faq.question}"\nResposta: "${faq.answer}"\n\nQuer adicionar mais alguma pergunta frequente?`,
          next_step: 'faq_more',
          extracted_data: { faq: [...existingFaq, faq] },
          action_options: ['Sim, adicionar mais', 'Não, continuar'],
        }
      } else {
        return {
          assistant_message: 'Por favor, use o formato: "Pergunta? Resposta"\n\nExemplo: "Quanto custa o serviço? R$ 80,00"',
          next_step: 'faq_question',
          extracted_data: {},
        }
      }

    case 'faq_more':
      if (message.toLowerCase().includes('sim') || message.toLowerCase().includes('adicionar')) {
        return {
          assistant_message: 'Me diga outra pergunta frequente e resposta:\n\nFormato: "Pergunta? Resposta"',
          next_step: 'faq_question',
          extracted_data: {},
        }
      } else {
        // Continuar
        const missing = identifyMissingFields(mergedData, mergedData.context)
        const nextStep = determineNextStep(mergedData, message, {
          step: currentStep,
          collected_data: mergedData,
          missing_fields: missing,
          context: mergedData.context,
        })
        return {
          assistant_message: nextStep.message,
          next_step: nextStep.step,
          extracted_data: {},
          action_options: nextStep.action_options,
          requires_action: nextStep.requires_action,
        }
      }

    case 'summary':
      if (message.toLowerCase().includes('correto') || message.toLowerCase().includes('está certo')) {
        return {
          assistant_message: 'Perfeito! 😊 Já consigo montar a primeira versão do seu atendimento.\n\nPara salvar tudo e te mostrar o fluxo visual, preciso criar sua conta rapidinho.',
          next_step: 'signup_request',
          requires_action: 'signup',
          action_options: ['Criar conta', 'Continuar depois'],
          extracted_data: {},
        }
      } else {
        // Quer ajustar
        return {
          assistant_message: 'O que você gostaria de ajustar?',
          next_step: 'adjusting',
          extracted_data: {},
        }
      }

    case 'signup_request':
      if (message.toLowerCase().includes('criar') || message.toLowerCase().includes('conta')) {
        return {
          assistant_message: 'Qual email você quer usar para acessar o Nevo?',
          next_step: 'signup_email',
          extracted_data: {},
        }
      } else {
        return {
          assistant_message: 'Sem problemas! Você pode criar sua conta depois. Quer que eu salve essas informações temporariamente?',
          next_step: 'signup_deferred',
          extracted_data: {},
        }
      }

    case 'signup_email':
      if (!message.includes('@')) {
        return {
          assistant_message: 'Por favor, informe um email válido.',
          next_step: 'signup_email',
          extracted_data: {},
        }
      } else {
        return {
          assistant_message: 'Agora crie uma senha (mínimo 8 caracteres).',
          next_step: 'signup_password',
          extracted_data: { email: message },
        }
      }

    case 'signup_password':
      if (message.length < 8) {
        return {
          assistant_message: 'A senha deve ter no mínimo 8 caracteres. Tente novamente.',
          next_step: 'signup_password',
          extracted_data: {},
        }
      } else {
        return {
          assistant_message: 'Repita a senha para confirmar.',
          next_step: 'signup_confirm_password',
          extracted_data: { password: message },
        }
      }

    case 'signup_confirm_password':
      const password = collectedData.password || ''
      if (message !== password) {
        return {
          assistant_message: 'As senhas não coincidem. Digite novamente.',
          next_step: 'signup_password',
          extracted_data: {},
        }
      } else {
        // TODO: Criar conta no Supabase Auth e migrar dados
        return {
          assistant_message: 'Conta criada 🎉\n\nJá montei a primeira versão do seu fluxo. Em breve você poderá visualizar e editar o fluxo visual no dashboard!',
          next_step: 'completed',
          extracted_data: { password_confirmed: true },
        }
      }

    case 'completed':
      return {
        assistant_message: 'Seu onboarding está completo! 🎉\n\nEm breve você será redirecionado para o dashboard onde poderá visualizar e editar seu fluxo de atendimento.',
        next_step: 'completed',
        extracted_data: {},
      }

    default:
      // Step genérico - usar fluxo adaptativo
      const missing = identifyMissingFields(mergedData, mergedData.context)
      const nextStep = determineNextStep(mergedData, message, {
        step: currentStep,
        collected_data: mergedData,
        missing_fields: missing,
        context: mergedData.context,
      })
      
      return {
        assistant_message: nextStep.message,
        next_step: nextStep.step,
        extracted_data: extracted,
        action_options: nextStep.action_options,
        requires_action: nextStep.requires_action,
      }
  }
}

// Gerar resumo dos dados coletados
function generateSummary(data: Record<string, any>): string {
  const parts: string[] = []
  
  parts.push('**Resumo do seu negócio:**\n')
  
  if (data.business_name) parts.push(`• Negócio: ${data.business_name}`)
  if (data.business_type) parts.push(`• Tipo: ${data.business_type}`)
  
  if (data.services && data.services.length > 0) {
    parts.push(`• Serviços: ${data.services.map((s: any) => s.name).join(', ')}`)
  }
  
  if (data.schedule) {
    const days = data.schedule.days_of_week?.join(', ') || 'Não informado'
    const time = data.schedule.start_time && data.schedule.end_time
      ? `${data.schedule.start_time} às ${data.schedule.end_time}`
      : 'Não informado'
    parts.push(`• Agenda: ${days} - ${time}`)
  }
  
  if (data.service_area?.region) {
    parts.push(`• Região: ${data.service_area.region}`)
  }
  
  if (data.tone_of_voice) {
    parts.push(`• Tom: ${data.tone_of_voice}`)
  }
  
  parts.push('\nEstá tudo correto?')
  
  return parts.join('\n')
}

// ============================================================================
// FUNÇÕES DE EXTRAÇÃO INTELIGENTE
// ============================================================================

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
async function extractBusinessModelWithAI(
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
        model: 'gpt-4o-mini',
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
function identifyMissingFields(
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

  // Campos opcionais mas importantes
  if (!data.tone_of_voice) missing.push('tone_of_voice')

  return missing
}

// Processar lista de serviços (separada por vírgula)
function parseServicesList(servicesText: string): Array<{ name: string }> {
  return servicesText
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(name => ({ name }))
}

// Extrair variáveis dinâmicas de contexto de orçamento
function extractQuoteVariables(message: string): string[] {
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

// ============================================================================
// GERENCIADOR DE FLUXO ADAPTATIVO
// ============================================================================

interface BusinessModelData {
  business_type?: string
  business_name?: string
  services?: Array<{ name: string; duration_minutes?: number; base_price?: number }>
  service_area?: { region?: string; coverage?: string }
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
  faq?: Array<{ question: string; answer: string }>
  dynamic_variables?: Array<{ key: string; label: string; type: string }>
}

interface FlowState {
  step: string
  collected_data: Partial<BusinessModelData>
  missing_fields: string[]
  context?: 'booking' | 'quote' | 'both'
}

// Determinar próximo passo baseado no que falta
function determineNextStep(
  currentData: Partial<BusinessModelData>,
  message: string,
  currentState: FlowState
): {
  step: string
  message: string
  action_options?: string[]
  requires_action?: string
} {
  const missing = currentState.missing_fields

  // Prioridade: tipo de negócio
  if (missing.includes('business_type') || !currentData.business_type) {
    return {
      step: 'business_type',
      message: 'Qual é o tipo do seu negócio? (ex: design de sobrancelhas, barbearia, loja de cortinas)',
    }
  }

  // Nome do negócio
  if (missing.includes('business_name') || !currentData.business_name) {
    return {
      step: 'business_name',
      message: 'Qual é o nome do seu negócio?',
    }
  }

  // Contexto (agendamento ou orçamento)
  if (!currentData.context) {
    return {
      step: 'context',
      message: 'O que você quer configurar primeiro?\n\n• Agendamento (clientes marcam horários)\n• Orçamento (clientes pedem valores)\n• Ambos',
      action_options: ['Agendamento', 'Orçamento', 'Ambos'],
      requires_action: 'context',
    }
  }

  // Serviços (para agendamento)
  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    (missing.includes('services') || !currentData.services || currentData.services.length === 0)
  ) {
    return {
      step: 'services_list',
      message: 'Quais os serviços que seu cliente pode agendar? Liste separando por vírgula.\n\nExemplo: Corte de cabelo, Barba, Corte + Barba',
    }
  }

  // Agenda (para agendamento)
  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    missing.some(f => f.startsWith('schedule.'))
  ) {
    if (missing.includes('schedule.days_of_week')) {
      return {
        step: 'schedule_days',
        message: 'Quais dias da semana você atende?\n\n• Segunda a Sexta\n• Segunda a Sábado\n• Todos os dias\n• Personalizado',
        action_options: ['Segunda a Sexta', 'Segunda a Sábado', 'Todos os dias', 'Personalizado'],
        requires_action: 'schedule_days',
      }
    }
    if (missing.includes('schedule.start_time')) {
      return {
        step: 'schedule_time',
        message: 'Qual seu horário de funcionamento? (ex: 9h às 18h)',
      }
    }
  }

  // Variáveis dinâmicas (para orçamento)
  if (
    (currentData.context === 'quote' || currentData.context === 'both') &&
    (!currentData.dynamic_variables || currentData.dynamic_variables.length === 0)
  ) {
    return {
      step: 'quote_variables',
      message: 'Para calcular o orçamento, quais informações você precisa do cliente?\n\nExemplo: medidas (largura, altura), quantidade, tipo de material, etc.',
    }
  }

  // Área de atendimento (opcional mas importante)
  if (!currentData.service_area?.region) {
    return {
      step: 'service_area',
      message: 'Qual região você atende? (ex: Osasco e região, São Paulo capital)',
    }
  }

  // Políticas (opcional)
  if (!currentData.policies) {
    return {
      step: 'policies',
      message: 'Você tem alguma política de cancelamento ou sinal? (ex: 50% de sinal, cancelamento com 24h de antecedência)',
    }
  }

  // FAQ (opcional)
  if (!currentData.faq || currentData.faq.length === 0) {
    return {
      step: 'faq_offer',
      message: 'Ótimo! Agora, para que eu possa responder dúvidas dos seus clientes de forma inteligente, você gostaria de adicionar algumas perguntas frequentes?\n\nIsso ajuda a IA a responder automaticamente quando seus clientes perguntarem algo similar.',
      action_options: ['Sim, quero adicionar', 'Não, pular'],
      requires_action: 'faq_offer',
    }
  }

  // Tom de voz
  if (missing.includes('tone_of_voice') || !currentData.tone_of_voice) {
    return {
      step: 'tone_of_voice',
      message: 'Qual tom de voz você prefere para o atendimento?',
      action_options: ['Formal', 'Amigável', 'Profissional', 'Engraçado'],
      requires_action: 'tone_of_voice',
    }
  }

  // Modo de decisão
  if (!currentData.handoff_mode) {
    return {
      step: 'handoff_mode',
      message: 'Como você deseja decidir quando escalar para um humano?',
      action_options: ['Sempre humano', 'Condicional (alguns casos)', 'Automático'],
      requires_action: 'handoff_mode',
    }
  }

  // Resumo e confirmação
  return {
    step: 'summary',
    message: generateSummary(currentData),
    action_options: ['Está correto', 'Quero ajustar'],
    requires_action: 'summary_confirmation',
  }
}

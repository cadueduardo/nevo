// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  extractBusinessModelWithAI,
  identifyMissingFields,
  parseServicesList,
  extractQuoteVariables,
  BusinessModelExtraction,
} from './extractors.ts'
import {
  determineNextStep,
  generateSummary,
  BusinessModelData,
  FlowState,
} from './flow-manager.ts'
import { migrateOnboardingToTenant } from './migrate.ts'

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  try {
    const body = await parseBody(req)
    if (!body) {
      return json({ error: 'Body inválido ou não é JSON' }, 400)
    }
    if (!body.session_id || !body.message) {
      return json({ error: 'session_id e message são obrigatórios' }, 400)
    }

    const { supabaseAdmin, envError } = createSupabaseAdmin()
    if (envError) return json({ error: envError }, 500)

    const session = await getOrCreateSession(supabaseAdmin, body.session_id)
    if (!session) return json({ error: 'Não foi possível criar ou buscar sessão' }, 500)

    await supabaseAdmin.from('onboarding_messages').insert({
      session_id: body.session_id,
      role: 'user',
      content: body.message,
    })

    const currentStep = body.current_step || session.current_step_key || 'welcome'
    const collectedData = session.collected_data || {}
    const isFirstMessage = currentStep === 'welcome' || !session.current_step_key

    let response: OnboardingResponse
    if (isFirstMessage) {
      const extracted = await extractBusinessModelWithAI(body.message, collectedData)
      response = {
        assistant_message: `Oi! 👋 Eu sou o Nevo.\n\nVou te ajudar a configurar seu atendimento inteligente. Pelo que você me contou, entendi que é um negócio de **${extracted.business_type || 'serviços'}**.\n\nVou fazer algumas perguntas para completar a configuração. Pode ser?`,
        next_step: 'collecting',
        extracted_data: extracted,
      }
    } else {
      response = await processMessage(body.message, currentStep, collectedData, session, supabaseAdmin)
    }

    const updatedData = { ...collectedData, ...response.extracted_data }
    const missingFields = identifyMissingFields(
      updatedData as BusinessModelExtraction,
      (updatedData as any).context
    )

    if (missingFields.length === 0 && !currentStep.startsWith('signup') && currentStep !== 'summary' && currentStep !== 'completed') {
      response.next_step = 'summary'
      response.assistant_message = generateSummary(updatedData)
      response.action_options = ['Está correto', 'Quero ajustar']
      response.requires_action = 'summary_confirmation'
    }

    await supabaseAdmin
      .from('onboarding_sessions')
      .update({
        current_step_key: response.next_step,
        collected_data: updatedData,
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', body.session_id)

    await supabaseAdmin.from('onboarding_messages').insert({
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

    return json(response)
  } catch (error: any) {
    console.error('Error na Edge Function:', error)
    return json(
      {
        error: error?.message || error?.toString() || 'Erro desconhecido',
        details: Deno.env.get('DENO_ENV') === 'development' ? error?.stack : undefined,
      },
      500
    )
  }
})

async function processMessage(
  message: string,
  currentStep: string,
  collectedData: Record<string, any>,
  session: any,
  supabaseAdmin: any
): Promise<OnboardingResponse> {
  const extracted = await extractBusinessModelWithAI(message, collectedData)
  const mergedData = { ...collectedData, ...extracted }

  switch (currentStep) {
    case 'collecting': {
      const missing = identifyMissingFields(mergedData, mergedData.context)
      const nextStep = determineNextStep(mergedData as BusinessModelData, message, {
        step: currentStep,
        collected_data: mergedData,
        missing_fields: missing,
        context: mergedData.context,
      } as FlowState)
      return {
        assistant_message: nextStep.message,
        next_step: nextStep.step,
        extracted_data: extracted,
        action_options: nextStep.action_options,
        requires_action: nextStep.requires_action,
      }
    }

    case 'services_list': {
      const services = parseServicesList(message)
      return {
        assistant_message: `✅ Adicionei seus serviços:\n${services.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}\n\nQuer adicionar mais algum? Ou podemos continuar?`,
        next_step: 'services_details',
        extracted_data: { services },
        action_options: ['Continuar', 'Adicionar mais'],
      }
    }

    case 'services_details': {
      if (message.toLowerCase().includes('continuar')) {
        const missing = identifyMissingFields(mergedData, mergedData.context)
        const nextStep = determineNextStep(mergedData as BusinessModelData, message, {
          step: currentStep,
          collected_data: mergedData,
          missing_fields: missing,
          context: mergedData.context,
        } as FlowState)
        return {
          assistant_message: nextStep.message,
          next_step: nextStep.step,
          extracted_data: {},
          action_options: nextStep.action_options,
          requires_action: nextStep.requires_action,
        }
      }

      const newServices = parseServicesList(message)
      const existingServices = mergedData.services || []
      return {
        assistant_message: `✅ Adicionei mais serviços:\n${newServices.map((s, i) => `${existingServices.length + i + 1}. ${s.name}`).join('\n')}\n\nMais algum?`,
        next_step: 'services_list',
        extracted_data: { services: [...existingServices, ...newServices] },
      }
    }

    case 'quote_variables': {
      const variables = extractQuoteVariables(message)
      const dynamicVars = variables.map((v) => ({
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
    }

    case 'faq_offer': {
      if (message.toLowerCase().includes('sim') || message.toLowerCase().includes('quero')) {
        return {
          assistant_message: 'Perfeito! Me diga uma pergunta que seus clientes costumam fazer e a resposta que você daria.\n\nFormato: "Pergunta? Resposta"',
          next_step: 'faq_question',
          extracted_data: {},
        }
      }

      const missing = identifyMissingFields(mergedData, mergedData.context)
      const nextStep = determineNextStep(mergedData as BusinessModelData, message, {
        step: currentStep,
        collected_data: mergedData,
        missing_fields: missing,
        context: mergedData.context,
      } as FlowState)
      return {
        assistant_message: nextStep.message,
        next_step: nextStep.step,
        extracted_data: {},
        action_options: nextStep.action_options,
        requires_action: nextStep.requires_action,
      }
    }

    case 'faq_question': {
      const faqMatch = message.match(/^(.+?)\s*\?\s*(.+)$/)
      if (!faqMatch) {
        return {
          assistant_message: 'Por favor, use o formato: "Pergunta? Resposta"\n\nExemplo: "Quanto custa o serviço? R$ 80,00"',
          next_step: 'faq_question',
          extracted_data: {},
        }
      }

      const faq = { question: faqMatch[1].trim(), answer: faqMatch[2].trim() }
      const existingFaq = mergedData.faq || []
      return {
        assistant_message: `✅ Adicionei:\nPergunta: "${faq.question}"\nResposta: "${faq.answer}"\n\nQuer adicionar mais alguma pergunta frequente?`,
        next_step: 'faq_more',
        extracted_data: { faq: [...existingFaq, faq] },
        action_options: ['Sim, adicionar mais', 'Não, continuar'],
      }
    }

    case 'faq_more': {
      if (message.toLowerCase().includes('sim') || message.toLowerCase().includes('adicionar')) {
        return {
          assistant_message: 'Me diga outra pergunta frequente e resposta:\n\nFormato: "Pergunta? Resposta"',
          next_step: 'faq_question',
          extracted_data: {},
        }
      }

      const missing = identifyMissingFields(mergedData, mergedData.context)
      const nextStep = determineNextStep(mergedData as BusinessModelData, message, {
        step: currentStep,
        collected_data: mergedData,
        missing_fields: missing,
        context: mergedData.context,
      } as FlowState)
      return {
        assistant_message: nextStep.message,
        next_step: nextStep.step,
        extracted_data: {},
        action_options: nextStep.action_options,
        requires_action: nextStep.requires_action,
      }
    }

    case 'schedule_days': {
      const daysMap: Record<string, string[]> = {
        'segunda a sexta': ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        'segunda a sábado': ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        'todos os dias': ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      }

      const messageLower = message.toLowerCase()
      let selectedDays: string[] = []

      for (const [key, days] of Object.entries(daysMap)) {
        if (messageLower.includes(key)) {
          selectedDays = days
          break
        }
      }

      if (selectedDays.length === 0) {
        const dayMap: Record<string, string> = {
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

        for (const [pt, en] of Object.entries(dayMap)) {
          if (messageLower.includes(pt) && !selectedDays.includes(en)) {
            selectedDays.push(en)
          }
        }
      }

      if (selectedDays.length === 0) {
        return {
          assistant_message: 'Não consegui identificar os dias. Pode informar novamente? (ex: Segunda a Sexta)',
          next_step: 'schedule_days',
          extracted_data: {},
          action_options: ['Segunda a Sexta', 'Segunda a Sábado', 'Todos os dias'],
        }
      }

      return {
        assistant_message: `✅ Anotei: ${selectedDays.length} dias da semana.\n\nQual seu horário de funcionamento? (ex: 9h às 18h)`,
        next_step: 'schedule_time',
        extracted_data: { schedule: { ...mergedData.schedule, days_of_week: selectedDays } },
      }
    }

    case 'schedule_time': {
      const timeMatch = message.match(/(\d{1,2})[h:]?\s*(?:às|até|-)\s*(\d{1,2})[h:]?/i)
      if (!timeMatch) {
        return {
          assistant_message: 'Não consegui entender o horário. Pode informar novamente? (ex: 9h às 18h)',
          next_step: 'schedule_time',
          extracted_data: {},
        }
      }

      const startHour = parseInt(timeMatch[1]).toString().padStart(2, '0')
      const endHour = parseInt(timeMatch[2]).toString().padStart(2, '0')

      return {
        assistant_message: `✅ Horário: ${startHour}:00 às ${endHour}:00\n\nVou continuar coletando as outras informações.`,
        next_step: 'collecting',
        extracted_data: {
          schedule: {
            ...mergedData.schedule,
            start_time: `${startHour}:00`,
            end_time: `${endHour}:00`,
          },
        },
      }
    }

    case 'context': {
      const contextLower = message.toLowerCase()
      let selectedContext: 'booking' | 'quote' | 'both' | null = null

      if (contextLower.includes('agendamento') || contextLower.includes('agendar')) {
        selectedContext = contextLower.includes('orçamento') || contextLower.includes('ambos') ? 'both' : 'booking'
      } else if (contextLower.includes('orçamento') || contextLower.includes('orcamento')) {
        selectedContext = 'quote'
      } else if (contextLower.includes('ambos')) {
        selectedContext = 'both'
      }

      if (!selectedContext) {
        return {
          assistant_message: 'Não entendi. Você quer usar o Nevo para agendamento, orçamento ou ambos?',
          next_step: 'context',
          extracted_data: {},
          action_options: ['Agendamento', 'Orçamento', 'Ambos'],
        }
      }

      return {
        assistant_message: `✅ Entendi! Você vai usar para ${selectedContext === 'booking' ? 'agendamento' : selectedContext === 'quote' ? 'orçamento' : 'agendamento e orçamento'}.\n\nVou continuar coletando as informações necessárias.`,
        next_step: 'collecting',
        extracted_data: { context: selectedContext },
      }
    }

    case 'tone_of_voice': {
      const toneLower = message.toLowerCase()
      let selectedTone: 'formal' | 'friendly' | 'professional' | 'funny' | null = null

      if (toneLower.includes('formal') || toneLower.includes('sério')) selectedTone = 'formal'
      else if (toneLower.includes('amigável') || toneLower.includes('friendly')) selectedTone = 'friendly'
      else if (toneLower.includes('profissional')) selectedTone = 'professional'
      else if (toneLower.includes('engraçado') || toneLower.includes('funny')) selectedTone = 'funny'

      if (!selectedTone) {
        return {
          assistant_message: 'Não entendi. Qual tom você prefere?',
          next_step: 'tone_of_voice',
          extracted_data: {},
          action_options: ['Formal', 'Amigável', 'Profissional', 'Engraçado'],
        }
      }

      return {
        assistant_message: `✅ Tom de voz: ${
          selectedTone === 'formal'
            ? 'Formal'
            : selectedTone === 'friendly'
              ? 'Amigável'
              : selectedTone === 'professional'
                ? 'Profissional'
                : 'Engraçado'
        }.\n\nVou continuar.`,
        next_step: 'collecting',
        extracted_data: { tone_of_voice: selectedTone },
      }
    }

    case 'handoff_mode': {
      const handoffLower = message.toLowerCase()
      let selectedHandoff: 'always' | 'conditional' | 'never' | null = null

      if (handoffLower.includes('sempre')) selectedHandoff = 'always'
      else if (handoffLower.includes('nunca') || handoffLower.includes('automático')) selectedHandoff = 'never'
      else if (handoffLower.includes('condicional') || handoffLower.includes('quando necessário'))
        selectedHandoff = 'conditional'

      if (!selectedHandoff) {
        return {
          assistant_message: 'Não entendi. Como você quer que o Nevo decida quando transferir para um humano?',
          next_step: 'handoff_mode',
          extracted_data: {},
          action_options: ['Sempre transferir', 'Condicional (quando necessário)', 'Nunca transferir (automático)'],
        }
      }

      return {
        assistant_message: `✅ Modo configurado: ${
          selectedHandoff === 'always' ? 'Sempre transferir' : selectedHandoff === 'conditional' ? 'Condicional' : 'Automático'
        }.\n\nVou gerar um resumo para você confirmar.`,
        next_step: 'summary',
        extracted_data: { handoff_mode: selectedHandoff },
      }
    }

    case 'summary': {
      if (message.toLowerCase().includes('correto') || message.toLowerCase().includes('está certo')) {
        return {
          assistant_message: 'Perfeito! 😊 Já consigo montar a primeira versão do seu atendimento.\n\nPara salvar tudo e te mostrar o fluxo visual, preciso criar sua conta rapidinho.',
          next_step: 'signup_request',
          requires_action: 'signup',
          action_options: ['Criar conta', 'Continuar depois'],
          extracted_data: {},
        }
      }
      return {
        assistant_message: 'O que você gostaria de ajustar?',
        next_step: 'adjusting',
        extracted_data: {},
      }
    }

    case 'signup_request': {
      if (message.toLowerCase().includes('criar') || message.toLowerCase().includes('conta')) {
        return {
          assistant_message: 'Qual email você quer usar para acessar o Nevo?',
          next_step: 'signup_email',
          extracted_data: {},
        }
      }
      return {
        assistant_message: 'Sem problemas! Você pode criar sua conta depois. Quer que eu salve essas informações temporariamente?',
        next_step: 'signup_deferred',
        extracted_data: {},
      }
    }

    case 'signup_email': {
      if (!message.includes('@')) {
        return {
          assistant_message: 'Por favor, informe um email válido.',
          next_step: 'signup_email',
          extracted_data: {},
        }
      }
      return {
        assistant_message: 'Agora crie uma senha (mínimo 8 caracteres).',
        next_step: 'signup_password',
        extracted_data: { email: message },
      }
    }

    case 'signup_password': {
      if (message.length < 8) {
        return {
          assistant_message: 'A senha deve ter no mínimo 8 caracteres. Tente novamente.',
          next_step: 'signup_password',
          extracted_data: {},
        }
      }
      return {
        assistant_message: 'Repita a senha para confirmar.',
        next_step: 'signup_confirm_password',
        extracted_data: { password: message },
      }
    }

    case 'signup_confirm_password': {
      const password = collectedData.password || ''
      if (message !== password) {
        return {
          assistant_message: 'As senhas não coincidem. Digite novamente.',
          next_step: 'signup_password',
          extracted_data: {},
        }
      }

      const migrationResult = await migrateOnboardingToTenant(supabaseAdmin, session.session_id, mergedData)
      if (!migrationResult.success) {
        return {
          assistant_message: `Ops, ocorreu um erro ao criar sua conta: ${migrationResult.error}\n\nPode tentar novamente?`,
          next_step: 'signup_email',
          extracted_data: {},
        }
      }

      return {
        assistant_message: 'Conta criada 🎉\n\nJá montei a primeira versão do seu fluxo. Em breve você poderá visualizar e editar o fluxo visual no dashboard!',
        next_step: 'completed',
        extracted_data: {
          password_confirmed: true,
          user_id: migrationResult.user_id,
          tenant_id: migrationResult.tenant_id,
        },
      }
    }

    case 'completed': {
      return {
        assistant_message: 'Seu onboarding está completo! 🎉\n\nEm breve você será redirecionado para o dashboard onde poderá visualizar e editar seu fluxo de atendimento.',
        next_step: 'completed',
        extracted_data: {},
      }
    }

    default: {
      const missing = identifyMissingFields(mergedData, mergedData.context)
      const nextStep = determineNextStep(mergedData as BusinessModelData, message, {
        step: currentStep,
        collected_data: mergedData,
        missing_fields: missing,
        context: mergedData.context,
      } as FlowState)
      return {
        assistant_message: nextStep.message,
        next_step: nextStep.step,
        extracted_data: extracted,
        action_options: nextStep.action_options,
        requires_action: nextStep.requires_action,
      }
    }
  }
}

async function parseBody(req: Request): Promise<OnboardingRequest | null> {
  try {
    return await req.json()
  } catch (e) {
    console.error('Erro ao fazer parse do body:', e)
    return null
  }
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      supabaseAdmin: null,
      envError: 'Configuração do servidor incompleta',
    }
  }

  return {
    supabaseAdmin: createClient(supabaseUrl, serviceRoleKey),
    envError: null,
  }
}

async function getOrCreateSession(supabaseAdmin: any, sessionId: string) {
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('onboarding_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .single()

  if (session) return session
  if (sessionError && sessionError.code !== 'PGRST116') throw sessionError

  const { data: newSession, error: createError } = await supabaseAdmin
    .from('onboarding_sessions')
    .insert({
      session_id: sessionId,
      current_step_key: 'welcome',
      collected_data: {},
    })
    .select()
    .single()

  if (createError) throw createError
  return newSession
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

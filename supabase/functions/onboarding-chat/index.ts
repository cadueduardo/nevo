import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  requires_action?: 'domain_confirmation' | 'signup' | null
  action_options?: string[]
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validar input
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

    // Processar mensagem baseado no step atual
    const currentStep = body.current_step || session.current_step_key || 'welcome'
    const collectedData = session.collected_data || {}
    
    let response: OnboardingResponse

    switch (currentStep) {
      case 'welcome':
        response = {
          assistant_message: 'Oi! 👋 Eu sou o Nevo.\n\nVou te fazer algumas perguntas rápidas pra entender seu negócio e montar um atendimento inteligente no WhatsApp. Pode ser?',
          next_step: 'domain_detection',
        }
        break

      case 'domain_detection':
        // TODO: Usar IA para extrair domínio (por enquanto, mock)
        const suggestedDomain = extractDomainFromMessage(body.message)
        response = {
          assistant_message: `Pelo que você me contou, parece que seu negócio é **${suggestedDomain}**.\n\nEstá certo ou prefere ajustar?`,
          next_step: 'domain_confirmation',
          requires_action: 'domain_confirmation',
          action_options: ['Está certo', 'Quero ajustar'],
          extracted_data: { domain_suggested: suggestedDomain },
        }
        break

      case 'domain_confirmation':
        if (body.message.toLowerCase().includes('certo') || body.message.toLowerCase().includes('sim')) {
          const confirmedDomain = session.domain_suggested || collectedData.domain_suggested || 'outro'
          response = {
            assistant_message: 'Perfeito! Agora me conta: qual é o nome do seu negócio?',
            next_step: 'business_name',
            extracted_data: { domain_confirmed: confirmedDomain },
          }
        } else {
          response = {
            assistant_message: 'Qual ramo descreve melhor seu negócio?\n\n• Advocacia\n• Cortinas\n• Personal Chef\n• Outro',
            next_step: 'domain_selection',
          }
        }
        break

      case 'domain_selection':
        const selectedDomain = extractDomainFromMessage(body.message)
        response = {
          assistant_message: 'Ótimo! Agora me conta: qual é o nome do seu negócio?',
          next_step: 'business_name',
          extracted_data: { domain_confirmed: selectedDomain },
        }
        break

      case 'business_name':
        response = {
          assistant_message: 'Entendi! O que seu negócio atende? (ex: consultas jurídicas, orçamentos de cortinas, etc.)',
          next_step: 'what_serves',
          extracted_data: { business_name: body.message },
        }
        break

      case 'what_serves':
        response = {
          assistant_message: 'E o que seu negócio NÃO atende? (ex: casos criminais, cortinas para empresas, etc.)',
          next_step: 'what_not_serves',
          extracted_data: { what_serves: body.message },
        }
        break

      case 'what_not_serves':
        response = {
          assistant_message: 'Como você deseja decidir quando escalar para um humano?\n\n• Sempre humano\n• Condicional (alguns casos)\n• Automático',
          next_step: 'decision_mode',
          extracted_data: { what_not_serves: body.message },
        }
        break

      case 'decision_mode':
        const decisionMode = extractDecisionMode(body.message)
        response = {
          assistant_message: 'Qual tom de voz você prefere para o atendimento?\n\n• Amigável\n• Profissional\n• Formal',
          next_step: 'tone',
          extracted_data: { decision_mode: decisionMode },
        }
        break

      case 'tone':
        const tone = extractTone(body.message)
        // Resumo
        const summary = {
          business_name: collectedData.business_name || 'Não informado',
          what_serves: collectedData.what_serves || 'Não informado',
          what_not_serves: collectedData.what_not_serves || 'Não informado',
          decision_mode: collectedData.decision_mode || 'Não informado',
          tone: tone,
        }
        
        response = {
          assistant_message: `Entendi até agora:\n• Negócio: ${summary.business_name}\n• Atende: ${summary.what_serves}\n• Não atende: ${summary.what_not_serves}\n• Decisão: ${summary.decision_mode}\n• Tom: ${summary.tone}\n\nSe algo estiver errado, me diga 😊\n\nPerfeito 😊 Já consigo montar a primeira versão do seu atendimento.\n\nPara salvar tudo e te mostrar o fluxo visual, preciso criar sua conta rapidinho.`,
          next_step: 'signup_request',
          requires_action: 'signup',
          action_options: ['Criar conta', 'Continuar depois'],
          extracted_data: { tone },
        }
        break

      case 'signup_request':
        if (body.message.toLowerCase().includes('criar') || body.message.toLowerCase().includes('conta')) {
          response = {
            assistant_message: 'Qual email você quer usar para acessar o Nevo?',
            next_step: 'signup_email',
          }
        } else {
          response = {
            assistant_message: 'Sem problemas! Você pode criar sua conta depois. Quer que eu salve essas informações temporariamente?',
            next_step: 'signup_deferred',
          }
        }
        break

      case 'signup_email':
        // Validar email básico
        if (!body.message.includes('@')) {
          response = {
            assistant_message: 'Por favor, informe um email válido.',
            next_step: 'signup_email',
          }
        } else {
          response = {
            assistant_message: 'Agora crie uma senha (mínimo 8 caracteres).',
            next_step: 'signup_password',
            extracted_data: { email: body.message },
          }
        }
        break

      case 'signup_password':
        if (body.message.length < 8) {
          response = {
            assistant_message: 'A senha deve ter no mínimo 8 caracteres. Tente novamente.',
            next_step: 'signup_password',
          }
        } else {
          response = {
            assistant_message: 'Repita a senha para confirmar.',
            next_step: 'signup_confirm_password',
            extracted_data: { password: body.message },
          }
        }
        break

      case 'signup_confirm_password':
        const password = collectedData.password || ''
        if (body.message !== password) {
          response = {
            assistant_message: 'As senhas não coincidem. Digite novamente.',
            next_step: 'signup_password',
          }
        } else {
          // TODO: Criar conta no Supabase Auth e migrar dados
          response = {
            assistant_message: 'Conta criada 🎉\n\nJá montei a primeira versão do seu fluxo. Vou te mostrar agora.',
            next_step: 'completed',
            extracted_data: { password_confirmed: true },
          }
        }
        break

      default:
        response = {
          assistant_message: 'Desculpe, não entendi. Pode repetir?',
          next_step: currentStep,
        }
    }

    // Atualizar session com dados coletados
    const updatedData = { ...collectedData, ...response.extracted_data }
    await supabaseAdmin
      .from('onboarding_sessions')
      .update({
        current_step_key: response.next_step,
        collected_data: updatedData,
        domain_suggested: response.extracted_data?.domain_suggested || session.domain_suggested,
        domain_confirmed: response.extracted_data?.domain_confirmed || session.domain_confirmed,
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

// Funções auxiliares (mock - depois usar IA)
function extractDomainFromMessage(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('advocacia') || lower.includes('advogado') || lower.includes('jurídico')) {
    return 'advocacia'
  }
  if (lower.includes('cortina')) {
    return 'cortinas'
  }
  if (lower.includes('chef') || lower.includes('culinária') || lower.includes('culinaria')) {
    return 'personal_chef'
  }
  return 'outro'
}

function extractDecisionMode(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('sempre') || lower.includes('sempre humano')) {
    return 'always'
  }
  if (lower.includes('automático') || lower.includes('automatico')) {
    return 'never'
  }
  return 'conditional'
}

function extractTone(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('amigável') || lower.includes('amigavel')) {
    return 'friendly'
  }
  if (lower.includes('formal')) {
    return 'formal'
  }
  return 'professional'
}

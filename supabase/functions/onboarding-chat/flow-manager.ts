// Gerenciador de fluxo adaptativo do onboarding

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
  collecting_services?: boolean
  collecting_faq?: boolean
  services_list?: string[]
  current_faq_question?: string
}

// Determinar próximo passo baseado no que falta
export function determineNextStep(
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

  // Se está coletando serviços (lista por vírgula)
  if (currentState.collecting_services && currentState.services_list) {
    return {
      step: 'services_details',
      message: `✅ Adicionei seus serviços:\n${currentState.services_list.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nQuer adicionar mais algum? Ou podemos continuar?`,
      action_options: ['Continuar', 'Adicionar mais'],
    }
  }

  // Se está coletando FAQ
  if (currentState.collecting_faq) {
    if (!currentState.current_faq_question) {
      // Primeira pergunta do FAQ
      return {
        step: 'faq_question',
        message: 'Perfeito! Me diga uma pergunta que seus clientes costumam fazer e a resposta que você daria.\n\nFormato: "Pergunta? Resposta"',
      }
    }
  }

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

// Gerar resumo dos dados coletados
function generateSummary(data: Partial<BusinessModelData>): string {
  const parts: string[] = []
  
  parts.push('**Resumo do seu negócio:**\n')
  
  if (data.business_name) parts.push(`• Negócio: ${data.business_name}`)
  if (data.business_type) parts.push(`• Tipo: ${data.business_type}`)
  
  if (data.services && data.services.length > 0) {
    parts.push(`• Serviços: ${data.services.map(s => s.name).join(', ')}`)
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

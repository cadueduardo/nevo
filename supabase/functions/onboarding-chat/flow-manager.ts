import { BusinessModelExtraction } from './extractors.ts'

export interface BusinessModelData extends BusinessModelExtraction {
  faq?: Array<{ question: string; answer: string }>
  dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
}

export interface FlowState {
  step: string
  collected_data: Partial<BusinessModelData>
  missing_fields: string[]
  context?: 'booking' | 'quote' | 'both'
}

function formatContextLabel(context?: 'booking' | 'quote' | 'both'): string | null {
  if (!context) return null
  if (context === 'booking') return 'Agendamento'
  if (context === 'quote') return 'Orçamento'
  return 'Agendamento + Orçamento'
}

export function determineNextStep(
  currentData: Partial<BusinessModelData>,
  _message: string,
  currentState: FlowState
): {
  step: string
  message: string
  action_options?: string[]
  requires_action?: string
} {
  const missing = currentState.missing_fields

  if (missing.includes('business_type') || !currentData.business_type) {
    return {
      step: 'business_type',
      message:
        'Pra eu montar seu atendimento do jeito certo, me diz primeiro: qual é o tipo do seu negócio (o que você faz/vende)?\n\nEx.: design de sobrancelhas, barbearia, loja de cortinas.',
    }
  }

  if (missing.includes('business_name') || !currentData.business_name) {
    return {
      step: 'business_name',
      message: `Entendi que você atua com **${currentData.business_type}**. Pra eu personalizar as mensagens e o resumo, qual é o nome do seu negócio?`,
    }
  }

  if (!currentData.context) {
    return {
      step: 'context',
      message:
        `Perfeito — **${currentData.business_name}** (${currentData.business_type}).\n\nSó pra eu direcionar as próximas perguntas: você quer configurar primeiro **agendamento**, **orçamento**, ou **ambos**?`,
      action_options: ['Agendamento', 'Orçamento', 'Ambos'],
      requires_action: 'context',
    }
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    missing.some((f) => f.startsWith('schedule.'))
  ) {
    if (missing.includes('schedule.days_of_week')) {
      return {
        step: 'schedule_days',
        message:
          'Perfeito. Pra eu configurar o agendamento certinho, em quais **dias da semana** você atende? (você pode selecionar nos checkboxes)',
        requires_action: 'schedule_days',
      }
    }
    if (missing.includes('schedule.start_time') || missing.includes('schedule.end_time')) {
      return {
        step: 'schedule_time',
        message:
          'Boa. E qual é a **faixa de horário** que você atende? (ex.: 08:00 às 18:00)\n\nPergunto isso pra eu liberar os horários certos no agendamento.',
      }
    }
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    (missing.includes('services') || !currentData.services || currentData.services.length === 0)
  ) {
    return {
      step: 'services_list',
      message:
        'Beleza. Pra eu montar a parte de **agendamento**, preciso saber o que o cliente pode marcar.\n\nQuais serviços você oferece? (separe por vírgulas)\nEx.: manicure, pedicure, alongamento de unhas.',
    }
  }

  if (
    (currentData.context === 'quote' || currentData.context === 'both') &&
    (!currentData.dynamic_variables || currentData.dynamic_variables.length === 0)
  ) {
    return {
      step: 'quote_variables',
      message:
        'Ótimo. Pra eu conseguir **qualificar um orçamento** automaticamente, quais informações você precisa que o cliente informe?\n\nEx.: medidas (largura/altura), quantidade, tipo de material, cor, etc.',
    }
  }

  if (!currentData.service_area?.region) {
    return {
      step: 'service_area',
      message:
        'Entendi. Pra eu responder certinho quando o cliente perguntar “você atende aqui?”, qual é a **região de atendimento**?\n\nEx.: Osasco e região, São Paulo capital.',
    }
  }

  if (!currentData.policies) {
    return {
      step: 'policies',
      message:
        'Pra evitar dor de cabeça com remarcação/cancelamento, você tem alguma **política de cancelamento** ou **sinal**?\n\nSe não tiver, tudo bem — você pode deixar isso pra depois.',
      action_options: ['Não por enquanto', 'Tenho política'],
      requires_action: 'policies',
    }
  }

  if (missing.includes('tone_of_voice') || !currentData.tone_of_voice) {
    return {
      step: 'tone_of_voice',
      message:
        'E sobre o jeito de falar com seus clientes: qual **tom de voz** você prefere que eu use?\n\nPergunto isso pra deixar as mensagens com a cara do seu negócio.',
      action_options: ['Formal', 'Amigável', 'Profissional', 'Engraçado'],
      requires_action: 'tone_of_voice',
    }
  }

  if (!currentData.handoff_mode) {
    return {
      step: 'handoff_mode',
      message:
        'Pra eu não “segurar” conversa quando você quiser assumir, quando você prefere que eu **passe para um humano**?',
      action_options: ['Sempre humano', 'Condicional (alguns casos)', 'Automático'],
      requires_action: 'handoff_mode',
    }
  }

  // FAQ é opcional: se o usuário escolheu "pular", não perguntar de novo.
  if (!(currentData as any).faq_skipped && (!currentData.faq || currentData.faq.length === 0)) {
    return {
      step: 'faq_offer',
      message:
        'Pra reduzir perguntas repetidas no dia a dia, quer que eu já cadastre algumas **perguntas frequentes** (FAQ) agora? Você pode editar depois.',
      action_options: ['Sim, quero adicionar', 'Não, pular'],
      requires_action: 'faq_offer',
    }
  }

  return {
    step: 'summary',
    message: generateSummary(currentData),
    action_options: ['Está correto', 'Quero ajustar'],
    requires_action: 'summary_confirmation',
  }
}

export function generateInitialConfirmation(data: Partial<BusinessModelData>): {
  message: string
  editableItems: Array<{ id: string; label: string; value: string; type: string }>
} {
  const messageParts: string[] = []
  const editableItems: Array<{ id: string; label: string; value: string; type: string }> = []

  // Resumo inicial (mínimo): apenas nome + tipo + contexto.
  if (data.business_name) messageParts.push(`Perfeito! 😊 Só confirmando rapidinho sobre o seu negócio:`)
  else messageParts.push('Perfeito! 😊 Só confirmando rapidinho:')

  // Adicionar campos editáveis
  if (data.business_type) {
    editableItems.push({
      id: 'business_type',
      label: 'Ramo de atividade',
      value: data.business_type,
      type: 'business_type',
    })
  }

  if (data.business_name) {
    editableItems.push({
      id: 'business_name',
      label: 'Nome da empresa',
      value: data.business_name,
      type: 'business_name',
    })
  }

  const contextLabel = formatContextLabel(data.context)
  if (contextLabel) {
    editableItems.push({
      id: 'context',
      label: 'Contexto',
      value: contextLabel,
      type: 'context',
    })
  }

  messageParts.push(
    '\nÉ isso mesmo? Se quiser mudar alguma coisa, pode editar os dados acima.\n\nConfirmando, eu sigo para os próximos ajustes do onboarding.'
  )

  return {
    message: messageParts.join(''),
    editableItems,
  }
}

export function generateSummary(data: Partial<BusinessModelData>): string {
  const parts: string[] = []

  const daysLabels: Record<string, string> = {
    monday: 'Segunda',
    tuesday: 'Terça',
    wednesday: 'Quarta',
    thursday: 'Quinta',
    friday: 'Sexta',
    saturday: 'Sábado',
    sunday: 'Domingo',
  }

  parts.push('Deixa eu te contar rapidinho o que já entendi:\n')

  if (data.business_name) parts.push(`• Negócio: ${data.business_name}`)
  if (data.business_type) parts.push(`• Tipo: ${data.business_type}`)

  if (data.services && data.services.length > 0) {
    parts.push(`• Serviços: ${data.services.map((s) => s.name).join(', ')}`)
  }

  // Agenda/horários: só mostrar se o usuário informou (não exibir "Não informado")
  if (
    data.schedule &&
    Array.isArray(data.schedule.days_of_week) &&
    data.schedule.days_of_week.length > 0 &&
    data.schedule.start_time &&
    data.schedule.end_time
  ) {
    const days = data.schedule.days_of_week.map((d) => daysLabels[d] || d).join(', ')
    const time = `${data.schedule.start_time} às ${data.schedule.end_time}`
    parts.push(`• Agenda: ${days} - ${time}`)
  }

  if (data.service_area?.region || (data.service_area as any)?.coverage) {
    const baseRegion = data.service_area?.region ? `${data.service_area.region}` : ''
    const coverage = (data.service_area as any)?.coverage
      ? ` (atuação: ${(data.service_area as any).coverage})`
      : ''
    parts.push(`• Região: ${baseRegion}${coverage}`.trim())
  }

  if (data.tone_of_voice) {
    const toneLabel =
      data.tone_of_voice === 'formal'
        ? 'Formal'
        : data.tone_of_voice === 'friendly'
          ? 'Amigável'
          : data.tone_of_voice === 'professional'
            ? 'Profissional'
            : 'Engraçado'
    parts.push(`• Tom: ${toneLabel}`)
  }

  parts.push('\nFicou assim. Pode tocar nos ícones para editar/excluir ou me dizer o que mudar.')

  return parts.join('\n')
}

export function generateFullStructure(data: Partial<BusinessModelData>): string {
  const parts: string[] = []

  parts.push('**Estrutura completa do seu atendimento:**\n\n')

  if (data.business_name) {
    parts.push(`**Nome da empresa:** ${data.business_name}\n`)
  }

  if (data.business_type) {
    parts.push(`**Ramo de atividade:** ${data.business_type}\n`)
  }

  if (data.service_area?.region) {
    parts.push(`**Localização:** ${data.service_area.region}\n`)
  }

  if (
    data.schedule &&
    Array.isArray(data.schedule.days_of_week) &&
    data.schedule.days_of_week.length > 0 &&
    data.schedule.start_time &&
    data.schedule.end_time
  ) {
    const daysLabels: Record<string, string> = {
      monday: 'Segunda-feira',
      tuesday: 'Terça-feira',
      wednesday: 'Quarta-feira',
      thursday: 'Quinta-feira',
      friday: 'Sexta-feira',
      saturday: 'Sábado',
      sunday: 'Domingo',
    }
    const days = data.schedule.days_of_week.map((d) => daysLabels[d] || d).join(', ')
    const time = `${data.schedule.start_time} às ${data.schedule.end_time}`
    parts.push(`**Horário:** ${days} - ${time}\n`)
  }

  if (data.services && data.services.length > 0) {
    parts.push(`**Serviços:**\n${data.services.map((s, i) => `${i + 1}. ${s.name}`).join('\n')}\n`)
  }

  if (data.faq && data.faq.length > 0) {
    parts.push(`**Perguntas Frequentes:**\n`)
    data.faq.forEach((faq, i) => {
      parts.push(`${i + 1}. **${faq.question}**\n   ${faq.answer}\n`)
    })
  }

  if (data.tone_of_voice) {
    const toneLabels: Record<string, string> = {
      formal: 'Formal',
      friendly: 'Amigável',
      professional: 'Profissional',
      funny: 'Engraçado',
    }
    parts.push(`**Tom de voz:** ${toneLabels[data.tone_of_voice] || data.tone_of_voice}\n`)
  }

  return parts.join('')
}

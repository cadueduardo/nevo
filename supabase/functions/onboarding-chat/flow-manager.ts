import { BusinessModelExtraction } from './extractors.ts'

export interface BusinessModelData extends BusinessModelExtraction {
  faq?: Array<{ question: string; answer: string }>
  dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
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
  staff_setup_index?: number
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

function isStaffScheduleComplete(staff: { schedule?: any; use_business_schedule?: boolean }): boolean {
  if (staff.use_business_schedule) return true
  const s = staff.schedule || {}
  return Boolean(
    Array.isArray(s.days_of_week) &&
      s.days_of_week.length > 0 &&
      s.start_time &&
      s.end_time &&
      s.interval_minutes
  )
}

function getNextStaffStep(data: Partial<BusinessModelData>) {
  const staff = Array.isArray(data.staff) ? data.staff : []
  if (!staff.length) return null

  for (let i = 0; i < staff.length; i += 1) {
    const member = staff[i]
    if (!member?.name) continue

    if (member.use_business_schedule === undefined) {
      return {
        step: 'staff_schedule_mode',
        message: `A agenda de **${member.name}** é a mesma do estabelecimento ou tem horário próprio?`,
        action_options: ['Mesmo horário do estabelecimento', 'Horário próprio'],
        requires_action: 'staff_schedule_mode',
      }
    }

    if (!isStaffScheduleComplete(member)) {
      if (!member.schedule?.days_of_week || member.schedule.days_of_week.length === 0) {
        return {
          step: 'staff_schedule_days',
          message: `Em quais dias da semana **${member.name}** atende? (você pode selecionar nos checkboxes)`,
          requires_action: 'schedule_days',
        }
      }
      if (!member.schedule?.start_time || !member.schedule?.end_time) {
        return {
          step: 'staff_schedule_time',
          message: `E qual é a faixa de horário que **${member.name}** atende? (ex.: 08:00 às 18:00)`,
        }
      }
      if (!member.schedule?.interval_minutes) {
        return {
          step: 'staff_schedule_interval',
          message: `Qual é o intervalo entre atendimentos para **${member.name}**?`,
          action_options: ['15 min', '30 min', '45 min', '60 min', 'Outro intervalo'],
          requires_action: 'schedule_interval',
        }
      }
    }
  }

  return null
}

function normalizeForMatch(value?: string): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function buildServiceExamples(businessType?: string, businessSegment?: BusinessModelData['business_segment']): string {
  if (businessSegment) {
    const examplesBySegment: Record<string, string> = {
      juridico: 'direito de familia, direito trabalhista, direito do consumidor',
      odontologia: 'limpeza, avaliacao, clareamento dental',
      saude: 'consulta, retorno, exames',
      psicologia: 'sessao individual, terapia de casal, avaliacao',
      barbearia: 'corte, barba, sobrancelha',
      beleza: 'corte, escova, coloracao',
      imobiliaria: 'visita ao imovel, avaliacao, consultoria',
      contabilidade: 'abertura de empresa, imposto de renda, consultoria contabil',
      consultoria: 'diagnostico, plano de acao, acompanhamento',
      educacao: 'aula experimental, matricula, reforco escolar',
      tecnologia: 'diagnostico, implantacao, suporte tecnico',
      outros: 'consulta, avaliacao, atendimento',
    }

    return examplesBySegment[businessSegment] || 'consulta, avaliacao, atendimento'
  }

  const normalized = normalizeForMatch(businessType)

  const examplesByKeyword: Array<{ keywords: string[]; examples: string }> = [
    {
      keywords: ["advocacia", "advogado", "jurid", "escritorio de advocacia"],
      examples: "direito de familia, direito trabalhista, direito do consumidor",
    },
    {
      keywords: ["odont", "dent", "odonto"],
      examples: "limpeza, avaliacao, clareamento dental",
    },
    {
      keywords: ["clinica", "medic", "saude"],
      examples: "consulta, retorno, exames",
    },
    {
      keywords: ["psico", "terapia", "psicolog"],
      examples: "sessao individual, terapia de casal, avaliacao",
    },
    {
      keywords: ["barbearia", "barbeiro"],
      examples: "corte, barba, sobrancelha",
    },
    {
      keywords: ["salao", "beleza", "estetica", "cabeleireiro"],
      examples: "corte, escova, coloracao",
    },
    {
      keywords: ["imobiliaria", "corretor", "imovel"],
      examples: "visita ao imovel, avaliacao, consultoria",
    },
    {
      keywords: ["contabilidade", "contador", "contabil"],
      examples: "abertura de empresa, imposto de renda, consultoria contabil",
    },
    {
      keywords: ["consultoria", "consultor"],
      examples: "diagnostico, plano de acao, acompanhamento",
    },
  ]

  for (const entry of examplesByKeyword) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.examples
    }
  }

  return "manicure, pedicure, alongamento de unhas"
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

  const serviceExamples = buildServiceExamples(currentData.business_type, currentData.business_segment)

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
    (missing.includes('services') || !currentData.services || currentData.services.length === 0)
  ) {
    return {
      step: 'services_list',
      message:
        `Beleza. Pra eu montar a parte de **agendamento**, preciso saber o que o cliente pode marcar.\n\nQuais servicos voce oferece? (separe por virgulas)\nEx.: ${serviceExamples}.`,
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
    if (missing.includes('schedule.interval_minutes')) {
      return {
        step: 'schedule_interval',
        message:
          'Qual é o **intervalo entre atendimentos**?\n\nIsso define de quanto em quanto tempo os horários aparecem na agenda.',
        action_options: ['15 min', '30 min', '45 min', '60 min', 'Outro intervalo'],
        requires_action: 'schedule_interval',
      }
    }
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    Array.isArray(currentData.services) &&
    currentData.services.length > 0 &&
    currentData.schedule?.interval_minutes &&
    !currentData.services_duration_configured
  ) {
    return {
      step: 'services_duration',
      message:
        'Algum serviço tem duração diferente do padrão? Se quiser, ajuste abaixo o tempo de cada serviço.',
      action_options: ['Continuar'],
      requires_action: 'services_duration',
    }
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    (missing.includes('staff') || !currentData.staff || currentData.staff.length === 0)
  ) {
    return {
      step: 'staff_mode',
      message: 'Você atende sozinho ou tem colaboradores?',
      action_options: ['Atendo sozinho', 'Tenho colaboradores'],
      requires_action: 'staff_mode',
    }
  }

  const nextStaffStep = getNextStaffStep(currentData)
  if (nextStaffStep && (currentData.context === 'booking' || currentData.context === 'both')) {
    return nextStaffStep
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

  const formatSchedule = (schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
  }): string | null => {
    if (
      !schedule ||
      !Array.isArray(schedule.days_of_week) ||
      schedule.days_of_week.length === 0 ||
      !schedule.start_time ||
      !schedule.end_time
    ) {
      return null
    }
    const days = schedule.days_of_week.map((d) => daysLabels[d] || d).join(', ')
    const time = `${schedule.start_time} às ${schedule.end_time}`
    const interval = schedule.interval_minutes ? ` | ${schedule.interval_minutes} min` : ''
    const breaks =
      Array.isArray(schedule.breaks) && schedule.breaks.length > 0
        ? ` | Pausa: ${schedule.breaks.map((b) => `${b.start} às ${b.end}`).join(', ')}`
        : ''
    return `${days} - ${time}${interval}${breaks}`
  }

  parts.push('Deixa eu te contar rapidinho o que já entendi:\n')

  if (data.business_name) parts.push(`• Negócio: ${data.business_name}`)
  if (data.business_type) parts.push(`• Tipo: ${data.business_type}`)

  if (data.services && data.services.length > 0) {
    parts.push(
      `• Serviços: ${data.services
        .map((s) => `${s.name}${s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}`)
        .join(', ')}`
    )
  }

  if (data.staff && data.staff.length > 0) {
    parts.push(`• Colaboradores: ${data.staff.map((s) => s.name).join(', ')}`)
    const baseScheduleText = formatSchedule(data.schedule)
    data.staff.forEach((member) => {
      if (!member?.name) return
      const staffSchedule = member.use_business_schedule ? data.schedule : member.schedule
      const scheduleText = formatSchedule(staffSchedule)
      if (scheduleText) {
        parts.push(`  - ${member.name}: ${scheduleText}`)
      } else if (member.use_business_schedule && baseScheduleText) {
        parts.push(`  - ${member.name}: ${baseScheduleText}`)
      }
    })
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
  if (data.schedule?.interval_minutes) {
    parts.push(`• Intervalo: ${data.schedule.interval_minutes} min`)
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
    parts.push(
      `**Serviços:**\n${data.services
        .map((s, i) => `${i + 1}. ${s.name}${s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}`)
        .join('\n')}\n`
    )
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

import { BusinessModelExtraction } from './extractors.ts'

export interface BusinessModelData extends BusinessModelExtraction {
  services_confirmed?: boolean
  schedule_breaks_configured?: boolean
  faq?: Array<{ question: string; answer: string }>
  dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
  services_duration_configured?: boolean
  services_pricing_configured?: boolean
  services_pricing_entered?: boolean
  /** Indica que a pergunta de sequência foi respondida. */
  sequence_booking_configured?: boolean
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

export const SERVICE_EXAMPLES_FALLBACK = 'consulta, avaliacao, atendimento'

/** Converte string de exemplos "a, b, c" em selectable_options para checkboxes. */
export function buildServiceSelectableOptions(examplesStr: string): Array<{ id: string; label: string; value: string }> {
  const items = (examplesStr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return items.map((name, i) => {
    const label = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
    return { id: `svc_${i}`, label, value: label }
  })
}

/** Opções de variáveis para orçamento (checkboxes). */
const QUOTE_VARIABLE_OPTIONS: Array<{ id: string; label: string; value: string }> = [
  { id: 'qv_medidas', label: 'Medidas (largura/altura)', value: 'medidas' },
  { id: 'qv_quantidade', label: 'Quantidade', value: 'quantidade' },
  { id: 'qv_material', label: 'Tipo de material', value: 'material' },
  { id: 'qv_cor', label: 'Cor', value: 'cor' },
  { id: 'qv_modelo', label: 'Modelo', value: 'modelo' },
  { id: 'qv_instalacao', label: 'Instalação (sim/não)', value: 'instalacao' },
]

export function buildQuoteVariablesSelectableOptions(
  existing: Array<{ key: string; label?: string }> = []
): Array<{ id: string; label: string; value: string; selected?: boolean }> {
  const selectedKeys = new Set(existing.map((v) => (v.key || v.label || '').toLowerCase()))
  return QUOTE_VARIABLE_OPTIONS.map((opt) => ({
    ...opt,
    selected: selectedKeys.has(opt.value.toLowerCase()),
  }))
}

export function buildServiceExamples(businessType?: string, businessSegment?: BusinessModelData['business_segment']): string {
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
      petshop: 'banho, tosa, consulta veterinaria, vacinacao',
      outros: SERVICE_EXAMPLES_FALLBACK,
    }

    return examplesBySegment[businessSegment] || SERVICE_EXAMPLES_FALLBACK
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
      keywords: ["salao", "beleza", "estetica", "cabeleireiro", "manicure", "pedicure", "unhas"],
      examples: "corte, escova, coloracao, manicure, pedicure, alongamento",
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
    {
      keywords: ["pet", "petshop", "pet shop", "veterinar", "animal"],
      examples: "banho, tosa, consulta veterinaria, vacinacao, hospedagem",
    },
    {
      keywords: ["restaurante", "lanchonete", "pizzaria", "delivery", "aliment"],
      examples: "reserva, delivery, evento privado, bufet",
    },
    {
      keywords: ["cortina", "persiana", "decora"],
      examples: "medicao, instalacao, orcamento de tecido",
    },
  ]

  for (const entry of examplesByKeyword) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.examples
    }
  }

  return SERVICE_EXAMPLES_FALLBACK
}

export function determineNextStep(
  currentData: Partial<BusinessModelData>,
  _message: string,
  currentState: FlowState
): {
  step: string
  message: string
  action_options?: string[]
  selectable_options?: Array<{ id: string; label: string; value: string }>
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
    (
      missing.includes('services') ||
      !currentData.services ||
      currentData.services.length === 0 ||
      currentData.services_confirmed !== true
    )
  ) {
    const serviceOpts = buildServiceSelectableOptions(serviceExamples)
    return {
      step: 'services_list',
      message:
        `Beleza. Pra eu montar a parte de **agendamento**, preciso saber o que o cliente pode marcar.\n\nSelecione os que você oferece ou adicione outros abaixo:`,
      selectable_options: serviceOpts,
      requires_action: 'services_list',
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
          'Boa. E qual é a **faixa de horário** que você atende? Pode escolher nos botões ou informar de outra forma.\n\nPergunto isso pra eu liberar os horários certos no agendamento.',
        action_options: [
          '08:00 às 18:00',
          '09:00 às 18:00',
          '08:00 às 17:00',
          '09:00 às 17:00',
          '07:00 às 17:00',
          '10:00 às 19:00',
          '06:00 às 12:00',
          'Outro horário',
        ],
        requires_action: 'schedule_time',
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
    if (missing.includes('schedule.min_booking_lead_minutes')) {
      return {
        step: 'min_booking_lead',
        message:
          'Com quanto tempo de **antecedência** o cliente pode agendar para hoje?\n\nHorários que já passaram ou estão muito próximos não aparecem. Ex.: com 20 min, às 14:55 só oferecemos horários a partir das 15:15.',
        action_options: ['5 min', '10 min', '15 min', '20 min', '30 min'],
        requires_action: 'min_booking_lead',
      }
    }
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    currentData.schedule?.start_time &&
    currentData.schedule?.end_time &&
    !currentData.schedule_breaks_configured
  ) {
    return {
      step: 'schedule_breaks',
      message:
        `✅ Perfeito. Horário: ${currentData.schedule.start_time} às ${currentData.schedule.end_time}.` +
        '\n\nVocê tem alguma pausa no dia? Pode escolher nos botões ou informar de outra forma.',
      action_options: [
        '12:00 às 13:00',
        '12:00 às 14:00',
        '11:30 às 12:30',
        'Não tenho pausa',
        'Outra pausa',
      ],
      requires_action: 'schedule_breaks',
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
    Array.isArray(currentData.services) &&
    currentData.services.length > 0 &&
    currentData.services_duration_configured &&
    !currentData.services_pricing_configured
  ) {
    return {
      step: 'services_pricing',
      message:
        'Quer informar o **valor** de cada serviço? Assim o cliente já pode saber na hora. (Se preferir, pode pular e informar depois.)',
      action_options: ['Informar valores', 'Pular por enquanto'],
      requires_action: 'services_pricing',
    }
  }

  // Sequência de serviços: permitir agendar vários na mesma visita
  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    Array.isArray(currentData.services) &&
    currentData.services.length > 0 &&
    currentData.services_pricing_configured &&
    !(currentData as any).sequence_booking_configured
  ) {
    return {
      step: 'sequence_booking_offer',
      message:
        'O cliente pode agendar **vários serviços na mesma visita** (em sequência) ou apenas **um serviço por agendamento**?',
      action_options: ['Apenas um serviço por agendamento', 'Sim, pode agendar em sequência'],
      requires_action: 'sequence_booking_offer',
    }
  }

  // Se permitir sequência, perguntar quais serviços podem ser combinados
  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    (currentData as any).allow_sequence_booking === true &&
    (!(currentData as any).sequence_eligible_services || (currentData as any).sequence_eligible_services.length === 0)
  ) {
    const serviceNames = (currentData.services || []).map((s) => s?.name).filter(Boolean)
    const selectableOpts = serviceNames.map((name, i) => ({
      id: `seq_svc_${i}`,
      label: name,
      value: name,
    }))
    return {
      step: 'sequence_services_select',
      message:
        'Quais serviços podem ser combinados em sequência? Selecione os que fazem sentido oferecer juntos (ex: banho + tosa).',
      selectable_options: selectableOpts,
      requires_action: 'sequence_services_select',
    }
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    (missing.includes('staff') || !currentData.staff || currentData.staff.length === 0)
  ) {
    return {
      step: 'staff_mode',
      message:
        '**Você** atende sozinho (só você) ou tem outros colaboradores além de você? (O sistema já considera que você é o dono/primeiro atendente.)',
      action_options: ['Só eu atendo', 'Eu e outros colaboradores'],
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
    const quoteVarOpts = buildQuoteVariablesSelectableOptions(currentData.dynamic_variables || [])
    return {
      step: 'quote_variables',
      message:
        'Ótimo. Pra eu conseguir **qualificar um orçamento** automaticamente, quais informações você precisa que o cliente informe?\n\nSelecione nos checkboxes abaixo e clique em **Confirmar seleção**:',
      selectable_options: quoteVarOpts,
      requires_action: 'quote_variables',
    }
  }

  // Localização: ponto fixo ou atendimento no local do cliente
  if (!(currentData as any).location_mode) {
    return {
      step: 'location_mode',
      message:
        'Seu serviço tem um **endereço fixo** (loja, clínica, escritório) ou você **atende no endereço do cliente**?',
      action_options: ['Tenho endereço fixo', 'Atendo no endereço do cliente'],
      requires_action: 'location_mode',
    }
  }

  if ((currentData as any).location_mode === 'fixed' && !(currentData as any).establishment_address) {
    return {
      step: 'address',
      message:
        'Informe o endereço do estabelecimento. Comece pelo CEP para preencher automaticamente.',
      requires_action: 'address',
    }
  }

  if ((currentData as any).location_mode === 'mobile' && !currentData.service_area?.region) {
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


  if (!(currentData as any).target_audience) {
    return {
      step: 'target_audience',
      message:
        'Seu atendimento e focado em algum publico especifico? Isso ajuda a qualificar melhor as conversas.',
      action_options: ['Atendo todos os publicos', 'Somente mulheres', 'Somente homens', 'Infantil', 'Outro publico especifico'],
      requires_action: 'target_audience',
    }
  }

  if (!(currentData as any).interaction_style) {
    return {
      step: 'interaction_style',
      message:
        'Como voce prefere o estilo das respostas no chat?',
      action_options: ['Misto (recomendado)', 'Opcoes numeradas (mais agil)', 'Conversa natural (mais humana)'],
      requires_action: 'interaction_style',
    }
  }

  // Feriados: opcional (apenas para booking/both)
  if (
    !(currentData as any).holidays_skipped &&
    (currentData.context === 'booking' || currentData.context === 'both')
  ) {
    return {
      step: 'holidays_offer',
      message:
        'Sobre **feriados nacionais**: por padrao o agendamento fica fechado. Voce atende em algum feriado? (Pode marcar os que trabalha ou pular.)',
      action_options: ['Atendo todos os feriados', 'Sim, quero marcar', 'Nao atendo em feriados', 'Pular por enquanto'],
      requires_action: 'holidays_offer',
    }
  }

  // Periodos de fechamento (ferias): opcional
  if (
    !(currentData as any).closure_skipped &&
    (currentData.context === 'booking' || currentData.context === 'both')
  ) {
    return {
      step: 'closure_offer',
      message:
        'Tem algum **periodo de ferias** ou fechamento planejado? (ex: de 20/12 a 05/01)',
      action_options: ['Sim, tenho periodo', 'Nao', 'Pular por enquanto'],
      requires_action: 'closure_offer',
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
        .map((s) => {
          const dur = s.duration_minutes ? ` (${s.duration_minutes} min)` : ''
          const price = s.base_price != null ? ` — R$ ${s.base_price}` : ''
          return `${s.name}${dur}${price}`
        })
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

  if ((data as any).establishment_address?.logradouro) {
    const a = (data as any).establishment_address
    parts.push(
      `• Endereço: ${a.logradouro}, ${a.numero}${a.complemento ? ` ${a.complemento}` : ''} - ${a.bairro}, ${a.localidade}/${a.uf}`
    )
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

  if ((data as any).policies?.note) {
    const note = ((data as any).policies.note as string).trim()
    if (note) parts.push(`• Políticas: ${note.slice(0, 100)}${note.length > 100 ? '...' : ''}`)
  }

  if ((data as any).handoff_mode) {
    const handoffLabel =
      (data as any).handoff_mode === 'always'
        ? 'Sempre passa para humano'
        : (data as any).handoff_mode === 'conditional'
          ? 'Passa para humano em alguns casos'
          : 'Atendimento automático'
    parts.push(`• Passar para humano: ${handoffLabel}`)
  }


  if ((data as any).target_audience) {
    const ta = (data as any).target_audience
    const labels: Record<string, string> = {
      all: 'Todos os publicos',
      women_only: 'Somente mulheres',
      men_only: 'Somente homens',
      kids_only: 'Infantil',
      custom: ta?.note ? `Personalizado (${ta.note})` : 'Personalizado',
    }
    const audienceLabel =
      Array.isArray(ta?.modes) && ta.modes.length > 0
        ? ta.modes.map((m: string) => labels[m] || m).filter(Boolean).join(' e ')
        : ta?.mode
          ? labels[ta.mode] || ta.mode
          : 'Todos os publicos'
    parts.push(`• Publico-alvo: ${audienceLabel}`)
  }

  if ((data as any).interaction_style) {
    const interactionStyleLabel =
      (data as any).interaction_style === 'numbered_options'
        ? 'Opcoes numeradas'
        : (data as any).interaction_style === 'conversational'
          ? 'Conversa natural'
          : 'Misto'
    parts.push(`• Estilo de respostas: ${interactionStyleLabel}`)
  }

  if (Array.isArray((data as any).dynamic_variables) && (data as any).dynamic_variables.length > 0) {
    const vars = (data as any).dynamic_variables.map((v: any) => v.label || v.key).filter(Boolean)
    if (vars.length) parts.push(`• Variáveis dinâmicas: ${vars.join(', ')}`)
  }

  if (Array.isArray((data as any).faq) && (data as any).faq.length > 0) {
    parts.push(`• FAQ: ${(data as any).faq.length} pergunta(s) cadastrada(s)`)
  }

  if (Array.isArray((data as any).holidays_attend) && (data as any).holidays_attend.length > 0) {
    parts.push(`• Feriados em que atende: ${(data as any).holidays_attend.length} data(s)`)
  } else if ((data as any).holidays_skipped === true && !(data as any).holidays_attend) {
    parts.push(`• Feriados: nao configurado (pode ajustar depois)`)
  }

  if (Array.isArray((data as any).closure_periods) && (data as any).closure_periods.length > 0) {
    const periods = (data as any).closure_periods
      .map((p: { start: string; end: string }) => `${p.start} a ${p.end}`)
      .join('; ')
    parts.push(`• Periodos de fechamento: ${periods}`)
  } else if ((data as any).closure_skipped === true) {
    parts.push(`• Periodos de fechamento: nao configurado`)
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
        .map((s, i) => {
          const dur = s.duration_minutes ? ` (${s.duration_minutes} min)` : ''
          const price = s.base_price != null ? ` — R$ ${s.base_price}` : ''
          return `${i + 1}. ${s.name}${dur}${price}`
        })
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

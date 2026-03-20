import { BusinessModelExtraction } from './extractors.ts'

export interface BusinessModelData extends BusinessModelExtraction {
  /** Lista geral do que a empresa oferece (informacional). */
  catalog_services?: Array<{ name: string; description?: string }>
  /** Lista do que pode ser agendado (agenda/preço/duração). */
  booking_services?: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
  /** Versão do modelo de configuração do negócio. */
  business_config_version?: number
  /** @deprecated manter durante janela de compatibilidade. */
  services?: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
  business_profile?: {
    business_name?: string
    business_type?: string
    services?: Array<{
      name: string
      description?: string
      duration_minutes?: number
      base_price?: number
      bookable?: boolean
      catalog_visible?: boolean
      sequence_eligible?: boolean
    }>
  }
  services_confirmed?: boolean
  schedule_breaks_configured?: boolean
  faq?: Array<{ question: string; answer: string }>
  dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
  services_duration_configured?: boolean
  services_pricing_configured?: boolean
  services_pricing_entered?: boolean
  /** Indica que a pergunta de sequência foi respondida. */
  sequence_booking_configured?: boolean
  /** Indica que o usuário respondeu à oferta de descrições do catálogo (Gerar ou Pular). */
  catalog_descriptions_offer_done?: boolean
  /** Serviços de orçamento (nome + pricing_type). Coletados em quote_services_list + quote_service_pricing. */
  quote_services?: Array<{ name: string; pricing_type: string }>
  /** Variáveis para estimativa rápida (cliente). Subconjunto de dynamic_variables. */
  quote_external_variable_keys?: string[]
  location_mode?: 'fixed' | 'mobile'
  establishment_address?: {
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    localidade?: string
    uf?: string
  }
  service_area?: {
    region?: string
    coverage?: string
  }
  interaction_style?: 'hybrid' | 'conversational' | 'numbered_options'
  target_audience?: {
    mode?: 'all' | 'women_only' | 'men_only' | 'kids_only' | 'custom'
    modes?: Array<'all' | 'women_only' | 'men_only' | 'kids_only' | 'custom'>
    note?: string
    kids_age_min?: number
  }
  policies?: {
    cancellation_hours?: number
    deposit_percentage?: number
    note?: string
  }
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
  holidays_attend?: string[]
  holidays_skipped?: boolean
  closure_periods?: Array<{ start: string; end: string; reason?: string }>
  closure_skipped?: boolean
  branding?: {
    enabled?: boolean
    logo_url?: string
    company_legal_name?: string
    cnpj?: string
    company_phone?: string
    company_email?: string
  }
  branding_offer_skipped?: boolean
  handoff_mode?: 'always' | 'conditional' | 'never'
  tone_of_voice?: 'formal' | 'friendly' | 'professional' | 'funny'
}

export interface FlowState {
  step: string
  collected_data: Partial<BusinessModelData>
  missing_fields: string[]
  context?: 'booking' | 'quote' | 'both'
}

function normalizeServiceKey(value?: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function resolveMergedServices(data: Partial<BusinessModelData>) {
  const merged = new Map<string, {
    name: string
    description?: string
    duration_minutes?: number
    base_price?: number
    bookable?: boolean
    catalog_visible?: boolean
    sequence_eligible?: boolean
  }>()

  const upsert = (
    service?: {
      name?: string
      description?: string
      duration_minutes?: number
      base_price?: number
      bookable?: boolean
      catalog_visible?: boolean
      sequence_eligible?: boolean
    },
    flags?: { bookable?: boolean; catalog_visible?: boolean }
  ) => {
    const key = normalizeServiceKey(service?.name)
    if (!key) return
    const previous = merged.get(key) || { name: service?.name || '' }
    merged.set(key, {
      ...previous,
      ...service,
      name: service?.name || previous.name,
      description: service?.description ?? previous.description,
      duration_minutes: service?.duration_minutes ?? previous.duration_minutes,
      base_price: service?.base_price ?? previous.base_price,
      bookable: flags?.bookable ?? service?.bookable ?? previous.bookable,
      catalog_visible: flags?.catalog_visible ?? service?.catalog_visible ?? previous.catalog_visible,
      sequence_eligible: service?.sequence_eligible ?? previous.sequence_eligible,
    })
  }

  ;(Array.isArray(data.services) ? data.services : []).forEach((service) => upsert(service))
  ;(Array.isArray(data.catalog_services) ? data.catalog_services : []).forEach((service) =>
    upsert(service, { catalog_visible: true })
  )
  ;(Array.isArray(data.booking_services) ? data.booking_services : []).forEach((service) =>
    upsert(service, { bookable: true })
  )
  ;(Array.isArray(data.business_profile?.services) ? data.business_profile?.services : []).forEach((service) =>
    upsert(service)
  )

  return Array.from(merged.values())
}

function getCatalogServices(data: Partial<BusinessModelData>): Array<{ name: string; description?: string }> {
  if (Array.isArray(data.catalog_services) && data.catalog_services.length > 0) {
    const merged = resolveMergedServices({
      services: data.services,
      catalog_services: data.catalog_services,
      business_profile: {
        services: (Array.isArray(data.business_profile?.services) ? data.business_profile?.services : []).filter(
          (service) => service.catalog_visible === true
        ),
      },
    })
    return merged
  }

  const canonicalVisible = (Array.isArray(data.business_profile?.services) ? data.business_profile?.services : []).filter(
    (service) => service.catalog_visible === true
  )
  if (canonicalVisible.length > 0) return canonicalVisible
  return Array.isArray(data.services) ? data.services : []
}

function getBookingServices(
  data: Partial<BusinessModelData>
): Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }> {
  if (Array.isArray(data.booking_services) && data.booking_services.length > 0) {
    const merged = resolveMergedServices({
      services: data.services,
      booking_services: data.booking_services,
      business_profile: {
        services: (Array.isArray(data.business_profile?.services) ? data.business_profile?.services : []).filter(
          (service) => service.bookable === true
        ),
      },
    })
    return merged
  }

  const canonicalBookable = (Array.isArray(data.business_profile?.services) ? data.business_profile?.services : []).filter(
    (service) => service.bookable === true
  )
  if (canonicalBookable.length > 0) return canonicalBookable
  return Array.isArray(data.services) ? data.services : []
}

export function buildBusinessProfile(data: Partial<BusinessModelData>) {
  const catalogServices = Array.isArray(data.catalog_services) ? data.catalog_services : []
  const bookingServices = Array.isArray(data.booking_services) ? data.booking_services : []
  const legacyServices = Array.isArray(data.services) ? data.services : []
  const canonicalServices = Array.isArray(data.business_profile?.services) ? data.business_profile.services : []
  const byName = new Map<string, {
    name: string
    description?: string
    duration_minutes?: number
    base_price?: number
    bookable?: boolean
    catalog_visible?: boolean
    sequence_eligible?: boolean
  }>()

  const normalizeKey = (value?: string) =>
    (value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

  const sequenceEligible = new Set(
    (Array.isArray((data as any).sequence_eligible_services) ? (data as any).sequence_eligible_services : [])
      .map((item: string) => normalizeKey(item))
      .filter(Boolean)
  )

  const upsert = (
    service: { name: string; description?: string; duration_minutes?: number; base_price?: number },
    flags?: { bookable?: boolean; catalog_visible?: boolean }
  ) => {
    const key = normalizeKey(service?.name)
    if (!key) return
    const previous = byName.get(key) || { name: service.name }
    byName.set(key, {
      ...previous,
      ...service,
      name: service.name,
      description: service.description ?? previous.description,
      duration_minutes: service.duration_minutes ?? previous.duration_minutes,
      base_price: service.base_price ?? previous.base_price,
      bookable: flags?.bookable ?? previous.bookable,
      catalog_visible: flags?.catalog_visible ?? previous.catalog_visible,
      sequence_eligible:
        sequenceEligible.size > 0 ? sequenceEligible.has(key) : previous.sequence_eligible,
    })
  }

  legacyServices.forEach((service) => upsert(service))
  canonicalServices.forEach((service) => upsert(service))
  catalogServices.forEach((service) => upsert(service, { catalog_visible: true }))
  bookingServices.forEach((service) => upsert(service, { bookable: true }))

  return {
    business_name: data.business_name,
    business_type: data.business_type,
    services: Array.from(byName.values()).map((service) => ({
      ...service,
      bookable: service.bookable === true,
      catalog_visible: service.catalog_visible === true,
      sequence_eligible: service.sequence_eligible === true,
    })),
  }
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
  const catalogServices = getCatalogServices(currentData)
  const bookingServices = getBookingServices(currentData)

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
    missing.includes('catalog_services') ||
    catalogServices.length === 0
  ) {
    const serviceOpts = buildServiceSelectableOptions(serviceExamples)
    const names = catalogServices.map((s) => s?.name).filter(Boolean) as string[]
    const message =
      names.length > 0
        ? `Você informou: **${names.join('**, **')}**. Está certo? Quer adicionar mais? (pode selecionar abaixo ou digitar outros)`
        : 'Quais serviços/produtos vocês oferecem no geral?\n\nSelecione os que você oferece ou adicione outros abaixo:'
    return {
      step: 'catalog_services_list',
      message,
      selectable_options: serviceOpts,
      requires_action: 'catalog_services_list',
    }
  }

  // Step opcional (doc): oferta de sugestão de descrições para o catálogo — agendamento e orçamento
  if (
    catalogServices.length > 0 &&
    !currentData.catalog_descriptions_offer_done
  ) {
    return {
      step: 'catalog_services_descriptions_offer',
      message:
        'Pra você não perder tempo, eu posso sugerir uma descrição curta pra cada serviço. Você revisa e edita. Quer que eu gere agora?',
      action_options: ['Gerar descrições', 'Pular por enquanto'],
      requires_action: 'catalog_services_descriptions_offer',
    }
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    (
      missing.includes('booking_services') ||
      bookingServices.length === 0 ||
      currentData.services_confirmed !== true
    )
  ) {
    const serviceOpts = buildServiceSelectableOptions(serviceExamples)
    const names = bookingServices.map((s) => s?.name).filter(Boolean) as string[]
    const message =
      names.length > 0
        ? `Você informou: **${names.join('**, **')}**. Está certo? Quer adicionar mais? (pode selecionar abaixo ou digitar outros)`
        : 'Beleza. Pra eu montar a parte de **agendamento**, preciso saber o que o cliente pode marcar.\n\nSelecione os que você oferece ou adicione outros abaixo:'
    return {
      step: 'booking_services_list',
      message,
      selectable_options: serviceOpts,
      requires_action: 'booking_services_list',
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
    bookingServices.length > 0 &&
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
    bookingServices.length > 0 &&
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
    bookingServices.length > 0 &&
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
    const serviceNames = bookingServices.map((s) => s?.name).filter(Boolean)
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

  // Sempre perguntar se atende sozinho ou tem colaboradores (mesmo com nome do dono já preenchido), para não pular cadastro de equipe.
  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    !(currentData as any).staff_mode
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

  // Step 12 (doc): quote_services_list — serviços que podem ser orçados
  if (
    (currentData.context === 'quote' || currentData.context === 'both') &&
    (!(currentData as any).quote_services || (currentData as any).quote_services.length === 0)
  ) {
    const examples = buildServiceExamples(currentData.business_type, currentData.business_segment)
    const opts = buildServiceSelectableOptions(examples)
    return {
      step: 'quote_services_list',
      message:
        'Para **orçamento**, quais são seus principais serviços que podem ser orçados?\n\nSelecione ou digite (ex.: Cortina, Persiana).',
      selectable_options: opts,
      requires_action: 'quote_services_list',
    }
  }

  // Step 13 (doc): quote_service_pricing — tipo de cobrança por serviço
  const quoteServices = (currentData as any).quote_services as Array<{ name: string; pricing_type?: string }> | undefined
  if (
    (currentData.context === 'quote' || currentData.context === 'both') &&
    Array.isArray(quoteServices) &&
    quoteServices.length > 0
  ) {
    const firstWithoutPricing = quoteServices.findIndex((s) => !s.pricing_type)
    if (firstWithoutPricing >= 0) {
      const svc = quoteServices[firstWithoutPricing]
      return {
        step: 'quote_service_pricing',
        message: `Para **${svc.name}**, você cobra por m², metro linear, unidade ou sob consulta?`,
        action_options: ['Por m² (área)', 'Por metro linear', 'Por unidade', 'Sob consulta'],
        requires_action: 'quote_service_pricing',
      }
    }
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

  // Step 15 (doc): quote_external_variables — variáveis para estimativa rápida (cliente)
  if (
    (currentData.context === 'quote' || currentData.context === 'both') &&
    Array.isArray(currentData.dynamic_variables) &&
    currentData.dynamic_variables.length > 0 &&
    (!(currentData as any).quote_external_variable_keys || (currentData as any).quote_external_variable_keys.length === 0)
  ) {
    const internalVars = currentData.dynamic_variables
    const externalOpts = internalVars.map((v, i) => ({
      id: `qev_${i}`,
      label: v.label || v.key,
      value: v.key,
      selected: (currentData as any).quote_external_variable_keys?.includes(v.key) ?? false,
    }))
    return {
      step: 'quote_external_variables',
      message:
        'Para o **cliente** pedir uma estimativa rápida (antes do orçamento completo), quais dados são suficientes?\n\nRecomendado: poucos (ex.: só largura e altura).',
      selectable_options: externalOpts,
      requires_action: 'quote_external_variables',
    }
  }

  // Branding opcional (FASE 4.4): apenas quando context inclui orçamento
  if (
    (currentData.context === 'quote' || currentData.context === 'both') &&
    (currentData as any).branding_offer_skipped === undefined &&
    (currentData as any).branding === undefined
  ) {
    return {
      step: 'branding_offer',
      message:
        'Quando eu gerar o PDF do orçamento, você quer que ele saia com seu **logo e dados da empresa** (timbrado)?',
      action_options: ['Sim, quero personalizar agora', 'Depois eu configuro'],
      requires_action: 'branding_offer',
    }
  }

  // Mini-fluxo branding (quando usuário escolheu "Sim")
  const branding = (currentData as any).branding
  if (branding?.enabled === true) {
    if (!branding.company_legal_name) {
      return {
        step: 'branding_company_legal_name',
        message: 'Qual é a **razão social** da sua empresa? (nome oficial)',
        requires_action: 'branding_company_legal_name',
      }
    }
    if (!branding.cnpj) {
      return {
        step: 'branding_cnpj',
        message: 'Qual é o **CNPJ** da empresa? (somente números)',
        requires_action: 'branding_cnpj',
      }
    }
    if (!branding.company_phone) {
      return {
        step: 'branding_company_phone',
        message: 'Qual é o **telefone** da empresa? (com DDD)',
        requires_action: 'branding_company_phone',
      }
    }
    if (!branding.company_email) {
      return {
        step: 'branding_company_email',
        message: 'Qual é o **e-mail** de contato da empresa?',
        requires_action: 'branding_company_email',
      }
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
        'Seu atendimento e focado em algum publico especifico? Isso ajuda a qualificar melhor as conversas. (Pode escolher mais de um, ex.: homens e infantil.)',
      action_options: [
        'Atendo todos os publicos',
        'Somente mulheres',
        'Somente homens',
        'Infantil',
        'Homens e infantil',
        'Mulheres e infantil',
        'Outro publico especifico',
      ],
      requires_action: 'target_audience',
    }
  }

  const ta = (currentData as any).target_audience
  const hasKidsAudience =
    ta?.mode === 'kids_only' ||
    (Array.isArray(ta?.modes) && ta.modes.includes('kids_only'))
  if (hasKidsAudience && ta?.kids_age_min === undefined) {
    return {
      step: 'target_audience_kids_age',
      message:
        'Você atende crianças de **qualquer idade** ou a partir de quantos anos? (Ex.: a partir de 6 anos, a partir de 8 anos. Se atende de qualquer idade, pode responder "qualquer idade" ou "0".)',
      action_options: ['Qualquer idade', 'A partir de 6 anos', 'A partir de 8 anos', 'A partir de 10 anos', 'Outra idade'],
      requires_action: 'target_audience_kids_age',
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
    message: generateNarrativeSummary(currentData),
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

  if (getCatalogServices(data).length > 0) {
    parts.push(
      `• Catálogo: ${getCatalogServices(data)
        .map((s) => s.name)
        .join(', ')}`
    )
  }

  if (getBookingServices(data).length > 0) {
    parts.push(
      `• Agendáveis: ${getBookingServices(data)
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

  if (Array.isArray((data as any).quote_services) && (data as any).quote_services.length > 0) {
    const qs = (data as any).quote_services
      .map((s: any) => (s.pricing_type ? `${s.name} (${s.pricing_type})` : s.name))
      .join(', ')
    parts.push(`• Serviços de orçamento: ${qs}`)
  }
  if (Array.isArray((data as any).dynamic_variables) && (data as any).dynamic_variables.length > 0) {
    const vars = (data as any).dynamic_variables.map((v: any) => v.label || v.key).filter(Boolean)
    if (vars.length) parts.push(`• Variáveis dinâmicas: ${vars.join(', ')}`)
  }
  if (Array.isArray((data as any).quote_external_variable_keys) && (data as any).quote_external_variable_keys.length > 0) {
    const ext = (data as any).quote_external_variable_keys
    const labels = (data as any).dynamic_variables || []
    const extLabels = ext.map((k: string) => labels.find((v: any) => v.key === k)?.label || k)
    parts.push(`• Estimativa rápida: ${extLabels.join(', ')}`)
  }

  const branding = (data as any).branding
  if (branding) {
    if (branding.enabled === true && (branding.company_legal_name || branding.cnpj)) {
      parts.push(`• Branding PDF: ${branding.company_legal_name || branding.cnpj || 'configurado'}`)
    } else if (branding.enabled === false || (data as any).branding_offer_skipped) {
      parts.push(`• Branding PDF: configurar depois`)
    }
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

export interface NarrativeSegment {
  kind: 'text' | 'editable'
  text: string
  item_id?: string
}

function pushNarrativeText(segments: NarrativeSegment[], text: string) {
  if (!text) return
  segments.push({ kind: 'text', text })
}

function pushNarrativeEditable(segments: NarrativeSegment[], itemId: string, text: string) {
  if (!text) return
  segments.push({ kind: 'editable', text, item_id: itemId })
}

function buildScheduleNarrative(data: Partial<BusinessModelData>): string | null {
  if (
    !data.schedule ||
    !Array.isArray(data.schedule.days_of_week) ||
    data.schedule.days_of_week.length === 0 ||
    !data.schedule.start_time ||
    !data.schedule.end_time
  ) {
    return null
  }

  const daysLabels: Record<string, string> = {
    monday: 'segunda',
    tuesday: 'terça',
    wednesday: 'quarta',
    thursday: 'quinta',
    friday: 'sexta',
    saturday: 'sábado',
    sunday: 'domingo',
  }

  const days = data.schedule.days_of_week.map((day) => daysLabels[day] || day).join(', ')
  const breaks =
    Array.isArray(data.schedule.breaks) && data.schedule.breaks.length > 0
      ? `, com pausa em ${data.schedule.breaks.map((item) => `${item.start} às ${item.end}`).join(', ')}`
      : ''

  return `${days}, das ${data.schedule.start_time} às ${data.schedule.end_time}${breaks}`
}

function buildToneNarrativeLabel(tone?: string): string | null {
  if (!tone) return null
  const labels: Record<string, string> = {
    formal: 'formal',
    friendly: 'amigável',
    professional: 'profissional',
    funny: 'descontraído',
  }
  return labels[tone] || tone
}

function buildInteractionStyleNarrativeLabel(style?: string): string | null {
  if (!style) return null
  const labels: Record<string, string> = {
    concise: 'mais objetivo',
    consultative: 'mais consultivo',
    hybrid: 'equilibrado entre objetividade e conversa',
    conversational: 'mais conversacional',
    numbered_options: 'mais guiado por opções',
  }
  return labels[style] || style
}

function buildTargetAudienceNarrative(data: Partial<BusinessModelData>): string | null {
  const ta = (data as any).target_audience
  if (!ta) return null

  const labels: Record<string, string> = {
    all: 'todos os públicos',
    women_only: 'mulheres',
    men_only: 'homens',
    kids_only: 'crianças',
    custom: typeof ta.note === 'string' && ta.note.trim() ? ta.note.trim() : 'público personalizado',
  }

  const modes = Array.isArray(ta.modes) && ta.modes.length > 0 ? ta.modes : ta.mode ? [ta.mode] : []
  if (modes.length === 0) return null

  let base = modes.map((mode: string) => labels[mode] || mode).join(' e ')
  if (modes.includes('kids_only') && ta.kids_age_min != null) {
    base += ta.kids_age_min === 0 ? ' de qualquer idade' : ` a partir de ${ta.kids_age_min} anos`
  }

  return base
}

export function generateNarrativeSummaryPayload(
  data: Partial<BusinessModelData>
): { text: string; segments: NarrativeSegment[] } {
  const segments: NarrativeSegment[] = []

  pushNarrativeText(segments, 'Ótimo. Foi assim que eu entendi o seu negócio até aqui:\n\n')

  if (data.business_type || data.business_name) {
    pushNarrativeText(segments, 'Você tem ')
    if (data.business_type) {
      pushNarrativeEditable(segments, 'business_type', data.business_type)
    } else {
      pushNarrativeText(segments, 'um negócio')
    }
    if (data.business_name) {
      pushNarrativeText(segments, ' que se chama ')
      pushNarrativeEditable(segments, 'business_name', data.business_name)
    }
    pushNarrativeText(segments, '.')
  }

  if (data.context) {
    const contextLabel = formatContextLabel(data.context)
    if (contextLabel) {
      pushNarrativeText(segments, '\n\nO foco principal desse agente é ')
      pushNarrativeEditable(segments, 'context', contextLabel)
      pushNarrativeText(segments, '.')
    }
  }

  const address = (data as any).establishment_address
  if ((data as any).location_mode === 'fixed' && address?.logradouro) {
    const addressText = `${address.logradouro}, ${address.numero}${address.complemento ? ` ${address.complemento}` : ''} - ${address.bairro}, ${address.localidade}/${address.uf}`
    pushNarrativeText(segments, '\n\nO atendimento acontece em ')
    pushNarrativeEditable(segments, 'establishment_address', addressText)
    pushNarrativeText(segments, '.')
  } else if ((data as any).service_area?.region) {
    const serviceAreaText = (data as any).service_area.coverage
      ? `${(data as any).service_area.region} (${(data as any).service_area.coverage})`
      : (data as any).service_area.region
    pushNarrativeText(segments, '\n\nA região principal de atendimento é ')
    pushNarrativeEditable(segments, 'service_area', serviceAreaText)
    pushNarrativeText(segments, '.')
  }

  const services = getBookingServices(data)
  if (services.length > 0) {
    pushNarrativeText(segments, '\n\nOs serviços que vão entrar no radar do agente são ')
    services.forEach((service, index) => {
      if (index > 0 && index === services.length - 1) {
        pushNarrativeText(segments, services.length === 2 ? ' e ' : ', e ')
      } else if (index > 0) {
        pushNarrativeText(segments, ', ')
      }

      pushNarrativeEditable(segments, `service_${index}`, service.name)

      const durationText =
        service.duration_minutes != null
          ? `${service.duration_minutes} min`
          : data.schedule?.interval_minutes
            ? `${data.schedule.interval_minutes} min`
            : ''
      if (durationText) {
        pushNarrativeText(segments, ' com duração de ')
        pushNarrativeEditable(segments, `service_duration_${index}`, durationText)
      }

      if (service.base_price != null) {
        pushNarrativeText(segments, ' e valor de ')
        pushNarrativeEditable(segments, `service_price_${index}`, `R$ ${service.base_price}`)
      }
    })
    pushNarrativeText(segments, '.')
  }

    const scheduleText = buildScheduleNarrative(data)
  if (scheduleText) {
    pushNarrativeText(segments, '\n\nO horário principal de funcionamento é ')
    pushNarrativeEditable(segments, 'schedule', scheduleText)
    pushNarrativeText(segments, '.')
  }

  const toneLabel = buildToneNarrativeLabel((data as any).tone_of_voice ?? (data as any).tone)
  if (toneLabel) {
    pushNarrativeText(segments, '\n\nO jeito de responder deve soar ')
    pushNarrativeEditable(segments, 'tone_of_voice', toneLabel)
    pushNarrativeText(segments, '.')
  }

  const interactionStyleLabel = buildInteractionStyleNarrativeLabel((data as any).interaction_style)
  if (interactionStyleLabel) {
    pushNarrativeText(segments, '\n\nNa conversa, o agente deve conduzir de um jeito ')
    pushNarrativeEditable(segments, 'interaction_style', interactionStyleLabel)
    pushNarrativeText(segments, '.')
  }

  const audienceText = buildTargetAudienceNarrative(data)
  if (audienceText) {
    pushNarrativeText(segments, '\n\nHoje vocês atendem ')
    pushNarrativeEditable(segments, 'target_audience', audienceText)
    pushNarrativeText(segments, '.')
  }

  const policiesNote = typeof (data as any).policies?.note === 'string' ? (data as any).policies.note.trim() : ''
  if (policiesNote) {
    pushNarrativeText(segments, '\n\nUma orientação importante para o atendimento é: ')
    pushNarrativeEditable(segments, 'policies', policiesNote)
    pushNarrativeText(segments, '.')
  }

  const faq = Array.isArray((data as any).faq) ? ((data as any).faq as Array<{ question?: string; answer?: string }>) : []
  const faqNormalized = faq
    .map((f) => ({
      question: typeof f?.question === 'string' ? f.question.trim() : '',
      answer: typeof f?.answer === 'string' ? f.answer.trim() : '',
    }))
    .filter((f) => f.question && f.answer)
  if (faqNormalized.length > 0) {
    pushNarrativeText(segments, `\n\nFAQ cadastrado (${faqNormalized.length}):`)
    const preview = faqNormalized.slice(0, 2)
    preview.forEach((f, i) => {
      pushNarrativeText(segments, '\n\n- ')
      pushNarrativeEditable(segments, `faq_${i}`, `${f.question} — ${f.answer}`)
    })
    if (faqNormalized.length > preview.length) {
      pushNarrativeText(segments, `\n\n(mais ${faqNormalized.length - preview.length} item(ns) no FAQ)`)
    }
  }

  const quoteVars = Array.isArray((data as any).dynamic_variables)
    ? (data as any).dynamic_variables.map((item: any) => item.label || item.key).filter(Boolean)
    : []
  if (quoteVars.length > 0 && (data.context === 'quote' || data.context === 'both')) {
    pushNarrativeText(segments, `\n\nPara orçamento, também vou considerar estas variáveis: ${quoteVars.join(', ')}.`)
  }

  return {
    text: segments.map((segment) => segment.text).join(''),
    segments,
  }
}

export function generateNarrativeSummary(data: Partial<BusinessModelData>): string {
  return generateNarrativeSummaryPayload(data).text
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

  if (getBookingServices(data).length > 0) {
    parts.push(
      `**Serviços agendáveis:**\n${getBookingServices(data)
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

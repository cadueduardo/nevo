// @ts-nocheck
// Funções de migração onboarding -> tenant

interface CollectedDataForMigration {
  email?: string
  password?: string
  business_name?: string
  business_type?: string
  services?: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
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
  location_mode?: 'fixed' | 'mobile'
  establishment_address?: {
    cep: string
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    localidade: string
    uf: string
  }
  service_area?: { region?: string; coverage?: string }
  policies?: {
    cancellation_hours?: number
    deposit_percentage?: number
  }
  dynamic_variables?: Array<{ key: string; label: string; type: string }>
  holidays_attend?: string[]
  closure_periods?: Array<{ start: string; end: string; reason?: string }>
  allow_sequence_booking?: boolean
  sequence_eligible_services?: string[]
  faq?: Array<{ question: string; answer: string }>
  tone_of_voice?: 'formal' | 'friendly' | 'professional' | 'funny'
  handoff_mode?: 'always' | 'conditional' | 'never'
  target_audience?: {
    mode: 'all' | 'women_only' | 'men_only' | 'kids_only' | 'custom'
    note?: string
  }
  interaction_style?: 'numbered_options' | 'conversational' | 'hybrid'
  context?: 'booking' | 'quote' | 'both'
}

interface MigrationResult {
  success: boolean
  user_id?: string
  tenant_id?: string
  error?: string
}

export async function migrateOnboardingToTenant(
  supabaseAdmin: any,
  sessionId: string,
  collectedData: CollectedDataForMigration
): Promise<MigrationResult> {
  try {
    if (!collectedData.email || !collectedData.password || !collectedData.business_name) {
      return { success: false, error: 'Email, senha e nome do negócio são obrigatórios' }
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: collectedData.email,
      password: collectedData.password,
      email_confirm: true,
    })

    if (authError) {
      return { success: false, error: `Erro ao criar usuário: ${authError.message}` }
    }

    const userId = authData.user.id
    const tenantSlug = await generateUniqueSlug(supabaseAdmin, collectedData.business_name)

    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenant')
      .insert({
        name: collectedData.business_name,
        slug: tenantSlug,
      })
      .select()
      .single()

    if (tenantError) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return { success: false, error: `Erro ao criar tenant: ${tenantError.message}` }
    }

    const tenantId = tenantData.id

    const { error: tenantUserError } = await supabaseAdmin.from('tenant_user').insert({
      tenant_id: tenantId,
      user_id: userId,
      role: 'owner',
    })

    if (tenantUserError) {
      await supabaseAdmin.from('tenant').delete().eq('id', tenantId)
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return { success: false, error: `Erro ao criar tenant_user: ${tenantUserError.message}` }
    }

    const businessConfig: Record<string, any> = {
      services:
        collectedData.services?.map((s) => ({
          name: s.name,
          duration_minutes: s.duration_minutes ?? undefined,
          base_price: s.base_price ?? undefined,
          description: s.description ?? undefined,
        })) ?? [],
      staff:
        collectedData.staff?.map((m) => ({
          name: m.name,
          use_business_schedule: m.use_business_schedule ?? true,
          schedule: m.schedule ?? null,
        })) ?? [],
      location_mode: collectedData.location_mode ?? 'fixed',
      establishment_address: collectedData.establishment_address ?? {},
      service_area: collectedData.service_area?.region ? collectedData.service_area : null,
      holidays_attend: collectedData.holidays_attend ?? [],
      closure_periods: collectedData.closure_periods ?? [],
      allow_sequence_booking: collectedData.allow_sequence_booking ?? false,
      sequence_eligible_services: collectedData.sequence_eligible_services ?? [],
      target_audience: collectedData.target_audience ?? { mode: 'all' },
      interaction_style: collectedData.interaction_style ?? 'hybrid',
      context_mode: collectedData.context ?? 'booking',
      business_type: collectedData.business_type ?? null,
    }
    if (collectedData.schedule) {
      businessConfig.schedule = collectedData.schedule
    }

    const { error: settingsError } = await supabaseAdmin.from('tenant_setting').insert({
      tenant_id: tenantId,
      tone:
        collectedData.tone_of_voice === 'friendly'
          ? 'friendly'
          : collectedData.tone_of_voice === 'formal'
            ? 'formal'
            : collectedData.tone_of_voice === 'professional'
              ? 'professional'
              : null,
      language: 'pt-BR',
      handoff_mode: collectedData.handoff_mode || 'conditional',
      business_config: businessConfig,
      when_client_asks_price_no_value: 'offer_handoff_or_booking',
    })

    if (settingsError) {
      console.error('Erro ao criar tenant_settings:', settingsError)
    }

    let blueprintData: any = null
    if (collectedData.business_type) {
      const { data: blueprint } = await supabaseAdmin
        .from('blueprint')
        .select('*')
        .eq('domain', collectedData.business_type.toLowerCase())
        .single()

      if (blueprint) blueprintData = blueprint
    }

    const flowDefinition = blueprintData?.default_flow_definition
      ? blueprintData.default_flow_definition
      : createDefaultFlowDefinition(collectedData)

    const flowLayout = {
      nodes: flowDefinition.nodes.map((node: any) => ({
        id: node.id,
        position: node.position,
      })),
    }

    const { error: flowError } = await supabaseAdmin.from('flow').insert({
      tenant_id: tenantId,
      name: 'Fluxo Principal',
      domain: collectedData.business_type?.toLowerCase(),
      version: 1,
      definition: flowDefinition,
      layout: flowLayout,
      is_active: true,
    })

    if (flowError) {
      console.error('Erro ao criar flow:', flowError)
    }

    if (collectedData.dynamic_variables && collectedData.dynamic_variables.length > 0) {
      const variables = collectedData.dynamic_variables.map((v) => ({
        tenant_id: tenantId,
        key: v.key,
        label: v.label,
        type: v.type === 'text' ? 'text' : v.type === 'number' ? 'number' : 'text',
        required: false,
        options: null,
        validation: null,
      }))

      const { error: variablesError } = await supabaseAdmin.from('variable').insert(variables)
      if (variablesError) {
        console.error('Erro ao criar variables:', variablesError)
      }
    }

    return { success: true, user_id: userId, tenant_id: tenantId }
  } catch (error: any) {
    return { success: false, error: error.message || 'Erro desconhecido na migração' }
  }
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50)
}

async function generateUniqueSlug(supabaseAdmin: any, baseName: string, attempt = 0): Promise<string> {
  const baseSlug = generateSlug(baseName)
  const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`

  const { error } = await supabaseAdmin.from('tenant').select('id').eq('slug', slug).single()

  if (error && error.code === 'PGRST116') return slug
  if (error) throw error

  return generateUniqueSlug(supabaseAdmin, baseName, attempt + 1)
}

function createDefaultFlowDefinition(data: CollectedDataForMigration): any {
  const flowDefinition = {
    nodes: [
      {
        id: 'start',
        type: 'trigger',
        position: { x: 100, y: 100 },
        data: {
          label: 'Início',
          trigger: 'message',
        },
      },
    ],
    edges: [],
  }

  flowDefinition.nodes.push({
    id: 'greeting',
    type: 'send',
    position: { x: 100, y: 200 },
    data: {
      label: 'Saudação',
      message: `Olá! 👋 Bem-vindo ao ${data.business_name || 'nosso serviço'}! Como posso ajudar?`,
    },
  })

  flowDefinition.edges.push({
    id: 'start-greeting',
    source: 'start',
    target: 'greeting',
  })

  if (data.context === 'booking' || data.context === 'both') {
    const collectNode = {
      id: 'collect',
      type: 'ask',
      position: { x: 100, y: 300 },
      data: {
        label: 'Coletar Informações',
        questions:
          data.services?.map((s) => ({
            key: `service_${s.name.toLowerCase().replace(/\s+/g, '_')}`,
            question: `Qual serviço você gostaria de agendar? ${data.services?.map((sv) => sv.name).join(', ')}`,
            type: 'enum',
            options: data.services?.map((sv) => sv.name) || [],
          })) || [],
      },
    }
    flowDefinition.nodes.push(collectNode)
    flowDefinition.edges.push({
      id: 'greeting-collect',
      source: 'greeting',
      target: 'collect',
    })
  }

  if (data.context === 'quote' || data.context === 'both') {
    const quoteNode = {
      id: 'quote',
      type: 'ask',
      position: { x: 100, y: 400 },
      data: {
        label: 'Coletar Dados para Orçamento',
        questions:
          data.dynamic_variables?.map((v) => ({
            key: v.key,
            question: `Qual é o ${v.label.toLowerCase()}?`,
            type: v.type,
          })) || [],
      },
    }
    flowDefinition.nodes.push(quoteNode)
    flowDefinition.edges.push({
      id: 'greeting-quote',
      source: 'greeting',
      target: 'quote',
    })
  }

  const handoffNode = {
    id: 'handoff',
    type: 'handoff',
    position: { x: 100, y: 500 },
    data: {
      label: 'Transferir para Humano',
      condition:
        data.handoff_mode === 'always'
          ? 'true'
          : data.handoff_mode === 'conditional'
            ? 'needs_human'
            : 'false',
    },
  }
  flowDefinition.nodes.push(handoffNode)
  flowDefinition.edges.push({
    id: 'collect-handoff',
    source: data.context === 'booking' || data.context === 'both' ? 'collect' : 'greeting',
    target: 'handoff',
  })

  return flowDefinition
}

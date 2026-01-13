// Funções de migração onboarding -> tenant

interface CollectedDataForMigration {
  email?: string
  password?: string
  business_name?: string
  business_type?: string
  services?: Array<{ name: string; duration_minutes?: number; base_price?: number }>
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
  }
  service_area?: { region?: string; coverage?: string }
  policies?: {
    cancellation_hours?: number
    deposit_percentage?: number
  }
  dynamic_variables?: Array<{ key: string; label: string; type: string }>
  faq?: Array<{ question: string; answer: string }>
  tone_of_voice?: 'formal' | 'friendly' | 'professional' | 'funny'
  handoff_mode?: 'always' | 'conditional' | 'never'
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

    const tone =
      collectedData.tone_of_voice === 'friendly'
        ? 'friendly'
        : collectedData.tone_of_voice === 'formal'
          ? 'formal'
          : 'professional'

    const { error: settingsError } = await supabaseAdmin.from('tenant_setting').insert({
      tenant_id: tenantId,
      tone,
      language: 'pt-BR',
      handoff_mode: collectedData.handoff_mode || 'conditional',
    })

    if (settingsError) {
      console.error('Erro ao criar tenant_settings:', settingsError)
    }

    let blueprintData = null
    if (collectedData.business_type) {
      const { data: blueprint } = await supabaseAdmin
        .from('blueprint')
        .select('*')
        .eq('domain', collectedData.business_type.toLowerCase())
        .single()

      if (blueprint) blueprintData = blueprint
    }

    const flowDefinition = blueprintData
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
// Função para migrar dados do onboarding_session para tenant após cadastro

interface CollectedData {
  email?: string
  password?: string
  business_name?: string
  business_type?: string
  services?: Array<{ name: string; duration_minutes?: number; base_price?: number }>
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
  }
  service_area?: { region?: string; coverage?: string }
  policies?: {
    cancellation_hours?: number
    deposit_percentage?: number
  }
  dynamic_variables?: Array<{ key: string; label: string; type: string }>
  faq?: Array<{ question: string; answer: string }>
  tone_of_voice?: 'formal' | 'friendly' | 'professional' | 'funny'
  handoff_mode?: 'always' | 'conditional' | 'never'
  context?: 'booking' | 'quote' | 'both'
}

interface MigrationResult {
  success: boolean
  user_id?: string
  tenant_id?: string
  error?: string
}

// Gerar slug único baseado no nome do negócio
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9]+/g, '-') // Substitui caracteres especiais por hífen
    .replace(/^-+|-+$/g, '') // Remove hífens do início e fim
    .substring(0, 50) // Limita tamanho
}

// Gerar slug único garantindo que não existe
async function generateUniqueSlug(
  supabaseAdmin: any,
  baseName: string,
  attempt: number = 0
): Promise<string> {
  const baseSlug = generateSlug(baseName)
  const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`

  // Verificar se slug já existe
  const { data, error } = await supabaseAdmin
    .from('tenant')
    .select('id')
    .eq('slug', slug)
    .single()

  if (error && error.code === 'PGRST116') {
    // Slug não existe, pode usar
    return slug
  }

  if (error) {
    throw error
  }

  // Slug existe, tentar com sufixo numérico
  return generateUniqueSlug(supabaseAdmin, baseName, attempt + 1)
}

// Criar flow padrão baseado nos dados coletados
function createDefaultFlowDefinition(data: CollectedData): any {
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

  // Adicionar nó de saudação
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

  // Se tem contexto de agendamento, adicionar nó de coleta de dados
  if (data.context === 'booking' || data.context === 'both') {
    const collectNode = {
      id: 'collect',
      type: 'ask',
      position: { x: 100, y: 300 },
      data: {
        label: 'Coletar Informações',
        questions: data.services?.map((s) => ({
          key: `service_${s.name.toLowerCase().replace(/\s+/g, '_')}`,
          question: `Qual serviço você gostaria de agendar? ${data.services?.map((s) => s.name).join(', ')}`,
          type: 'enum',
          options: data.services?.map((s) => s.name) || [],
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

  // Se tem contexto de orçamento, adicionar nó de coleta de variáveis
  if (data.context === 'quote' || data.context === 'both') {
    const quoteNode = {
      id: 'quote',
      type: 'ask',
      position: { x: 100, y: 400 },
      data: {
        label: 'Coletar Dados para Orçamento',
        questions: data.dynamic_variables?.map((v) => ({
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

  // Adicionar nó de handoff baseado no modo configurado
  const handoffNode = {
    id: 'handoff',
    type: 'handoff',
    position: { x: 100, y: 500 },
    data: {
      label: 'Transferir para Humano',
      condition: data.handoff_mode === 'always' ? 'true' : data.handoff_mode === 'conditional' ? 'needs_human' : 'false',
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

// Migrar dados do onboarding para tenant
export async function migrateOnboardingToTenant(
  supabaseAdmin: any,
  sessionId: string,
  collectedData: CollectedData
): Promise<MigrationResult> {
  try {
    // Validar dados obrigatórios
    if (!collectedData.email || !collectedData.password || !collectedData.business_name) {
      return {
        success: false,
        error: 'Email, senha e nome do negócio são obrigatórios',
      }
    }

    // 1. Criar usuário no Supabase Auth usando Admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: collectedData.email,
      password: collectedData.password,
      email_confirm: true, // Confirmar email automaticamente
    })

    if (authError) {
      return {
        success: false,
        error: `Erro ao criar usuário: ${authError.message}`,
      }
    }

    const userId = authData.user.id

    // 2. Gerar slug único para tenant
    const tenantSlug = await generateUniqueSlug(supabaseAdmin, collectedData.business_name)

    // 3. Criar tenant
    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenant')
      .insert({
        name: collectedData.business_name,
        slug: tenantSlug,
      })
      .select()
      .single()

    if (tenantError) {
      // Se falhar, tentar deletar o usuário criado
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return {
        success: false,
        error: `Erro ao criar tenant: ${tenantError.message}`,
      }
    }

    const tenantId = tenantData.id

    // 4. Criar tenant_user com role 'owner'
    const { error: tenantUserError } = await supabaseAdmin
      .from('tenant_user')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        role: 'owner',
      })

    if (tenantUserError) {
      // Rollback: deletar tenant e usuário
      await supabaseAdmin.from('tenant').delete().eq('id', tenantId)
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return {
        success: false,
        error: `Erro ao criar tenant_user: ${tenantUserError.message}`,
      }
    }

    // 5. Criar tenant_settings
    const { error: settingsError } = await supabaseAdmin
      .from('tenant_setting')
      .insert({
        tenant_id: tenantId,
        tone: collectedData.tone_of_voice || 'professional',
        language: 'pt-BR',
        handoff_mode: collectedData.handoff_mode || 'conditional',
      })

    if (settingsError) {
      console.error('Erro ao criar tenant_settings:', settingsError)
      // Não fazer rollback aqui, pois settings é opcional
    }

    // 6. Buscar blueprint baseado no business_type (se existir)
    let blueprintData = null
    if (collectedData.business_type) {
      const { data: blueprint } = await supabaseAdmin
        .from('blueprint')
        .select('*')
        .eq('domain', collectedData.business_type.toLowerCase())
        .single()

      if (blueprint) {
        blueprintData = blueprint
      }
    }

    // 7. Criar flow baseado em blueprint ou padrão
    const flowDefinition = blueprintData
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
      // Não fazer rollback, flow pode ser criado depois
    }

    // 8. Criar variables baseadas em dynamic_variables
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
        // Não fazer rollback, variables podem ser criadas depois
      }
    }

    // 9. Marcar sessão de onboarding como migrada (opcional - pode deletar depois)
    // Por enquanto, apenas retornar sucesso

    return {
      success: true,
      user_id: userId,
      tenant_id: tenantId,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Erro desconhecido na migração',
    }
  }
}

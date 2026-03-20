import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { buildCanonicalBusinessProfile, projectLegacyServiceViewsFromBusinessProfile } from '@/lib/business-profile'
import {
  buildEvolutionWebhookUrl,
  ensureEvolutionWebhookSecret,
  sanitizeEvolutionBaseUrl,
} from '@/lib/whatsapp/evolution'

const EMPTY_FLOW_DEFINITION = {
  nodes: [
    { id: 'start', type: 'trigger', position: { x: 100, y: 100 }, data: { label: 'Início', trigger: 'message' } },
    { id: 'greeting', type: 'send', position: { x: 100, y: 200 }, data: { label: 'Saudação', message: 'Olá! Como posso ajudar?' } },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'greeting' }],
} as const

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

function resolveAppOrigin(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  if (!baseUrl) return null
  return baseUrl.startsWith('http') ? baseUrl.replace(/\/$/, '') : `https://${baseUrl}`.replace(/\/$/, '')
}

function sanitizeInstanceName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function getEvolutionEnvConfig() {
  const configuredBaseUrl =
    process.env.EVOLUTION_AUTO_BASE_URL?.trim() ||
    process.env.EVOLUTION_BASE_URL?.trim() ||
    null
  const apiKey =
    process.env.EVOLUTION_AUTO_API_KEY?.trim() ||
    process.env.EVOLUTION_API_KEY?.trim() ||
    null
  const normalizedBaseUrl = configuredBaseUrl
    ? sanitizeEvolutionBaseUrl(configuredBaseUrl)
    : { value: null, error: null }
  return { baseUrl: normalizedBaseUrl.value, apiKey, baseUrlError: normalizedBaseUrl.error }
}

async function tryEvolutionCall(
  urls: string[],
  method: 'GET' | 'POST' | 'PUT',
  headers: Record<string, string>,
  bodyCandidates: Array<Record<string, unknown> | null>
): Promise<{ ok: boolean; status: number; body: string; url: string }> {
  let last = { ok: false, status: 0, body: '', url: urls[0] || '' }
  for (const url of urls) {
    for (const body of bodyCandidates) {
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        })
        const text = await res.text()
        last = { ok: res.ok, status: res.status, body: text, url }
        if (res.ok || res.status === 409) {
          return { ok: true, status: res.status, body: text, url }
        }
      } catch (error) {
        last = {
          ok: false,
          status: 0,
          body: error instanceof Error ? error.message : String(error),
          url,
        }
      }
    }
  }
  return last
}

async function autoProvisionEvolutionForAgent(params: {
  supabaseAdmin: any
  agentId: string
  tenantId: string
}) {
  const { supabaseAdmin, agentId, tenantId } = params
  const appOrigin = resolveAppOrigin()
  const { baseUrl, apiKey } = getEvolutionEnvConfig()
  const { baseUrlError } = getEvolutionEnvConfig()
  const instance = sanitizeInstanceName(
    `nevo-${tenantId.slice(0, 8)}-${agentId.slice(0, 8)}`
  )
  const webhookSecret = ensureEvolutionWebhookSecret(null)

  if (baseUrlError || !baseUrl || !apiKey || !appOrigin) {
    const missing = [
      baseUrlError ? 'EVOLUTION_BASE_URL inválida' : null,
      !baseUrl ? 'EVOLUTION_AUTO_BASE_URL/EVOLUTION_BASE_URL' : null,
      !apiKey ? 'EVOLUTION_AUTO_API_KEY/EVOLUTION_API_KEY' : null,
      !appOrigin ? 'NEXT_PUBLIC_APP_URL/VERCEL_URL' : null,
    ]
      .filter(Boolean)
      .join(', ')
    await supabaseAdmin.from('agent_channel_whatsapp').upsert(
      {
        agent_id: agentId,
        provider: 'evolution',
        status: 'disconnected',
        evolution_base_url: baseUrl,
        evolution_instance: instance,
        evolution_api_key_encrypted: null,
        webhook_url: null,
        webhook_secret: webhookSecret,
        last_error: `Provisionamento automático indisponível. Variáveis ausentes: ${missing}`,
      },
      { onConflict: 'agent_id' }
    )
    return { ok: false, error: `Missing env: ${missing}` }
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  }

  const createUrls = [
    `${baseUrl}/instance/create`,
    `${baseUrl}/v1/instance/create`,
    `${baseUrl}/v2/instance/create`,
    `${baseUrl}/instances/create`,
  ]
  const createBodies: Array<Record<string, unknown>> = [
    { instanceName: instance, qrcode: false, integration: 'WHATSAPP-BAILEYS' },
    { instanceName: instance, qrcode: false, integration: 'BAILEYS' },
    { instance: instance, qrcode: false, integration: 'WHATSAPP-BAILEYS' },
    { instanceName: instance, qrcode: false },
  ]
  const createRes = await tryEvolutionCall(createUrls, 'POST', headers, createBodies)

  const webhookUrl = buildEvolutionWebhookUrl({
    appOrigin,
    agentId,
    webhookSecret,
  })
  const webhookSetUrls = [
    `${baseUrl}/webhook/set/${encodeURIComponent(instance)}`,
    `${baseUrl}/v1/webhook/set/${encodeURIComponent(instance)}`,
    `${baseUrl}/v2/webhook/set/${encodeURIComponent(instance)}`,
    `${baseUrl}/webhook/instance/${encodeURIComponent(instance)}`,
  ]
  const webhookBodies: Array<Record<string, unknown>> = [
    {
      enabled: true,
      url: webhookUrl,
      events: ['MESSAGES_UPSERT'],
    },
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: true,
        events: ['MESSAGES_UPSERT'],
      },
    },
    {
      webhookUrl,
      webhook_by_events: true,
      events: ['MESSAGES_UPSERT'],
    },
  ]
  const webhookRes = await tryEvolutionCall(webhookSetUrls, 'POST', headers, webhookBodies)

  const ok = createRes.ok && webhookRes.ok
  const lastError = ok
    ? null
    : `create_instance=${createRes.status} (${createRes.url}); set_webhook=${webhookRes.status} (${webhookRes.url})`

  await supabaseAdmin.from('agent_channel_whatsapp').upsert(
    {
      agent_id: agentId,
      provider: 'evolution',
      status: ok ? 'connecting' : 'error',
      evolution_base_url: baseUrl,
      evolution_instance: instance,
      evolution_api_key_encrypted: null,
      webhook_url: webhookUrl,
      webhook_secret: webhookSecret,
      last_error: lastError,
    },
    { onConflict: 'agent_id' }
  )

  return { ok, webhook_url: webhookUrl, instance, last_error: lastError }
}

function buildBusinessConfigFromCollected(collected: Record<string, any>) {
  const businessProfile = buildCanonicalBusinessProfile({
    business_name: collected.business_name,
    business_type: collected.business_type,
    business_profile: collected.business_profile ?? null,
    services: collected.services,
    booking_services: collected.booking_services,
    catalog_services: collected.catalog_services,
    sequence_eligible_services: collected.sequence_eligible_services,
  })
  const projectedServices = projectLegacyServiceViewsFromBusinessProfile(businessProfile)

  const config: Record<string, any> = {
    business_name: collected.business_name,
    business_type: collected.business_type,
    business_profile: businessProfile,
    context_mode: collected.context ?? 'booking',
    establishment_address: collected.establishment_address,
    tone_of_voice: collected.tone_of_voice,
    business_config_version: 2,
    catalog_services: projectedServices.catalog_services,
    booking_services: projectedServices.booking_services,
    // Compat legado durante depreciacao: services espelha a projecao canonica.
    services: projectedServices.services,
    when_client_asks_price_no_value: collected.when_client_asks_price_no_value || 'offer_handoff_or_booking',
    schedule: collected.schedule,
    staff: Array.isArray(collected.staff) ? collected.staff : [],
    dynamic_variables: Array.isArray(collected.dynamic_variables) ? collected.dynamic_variables : [],
    lead_policy: collected.lead_policy,
    holidays_attend: Array.isArray(collected.holidays_attend) ? collected.holidays_attend : [],
    closure_periods: Array.isArray(collected.closure_periods) ? collected.closure_periods : [],
    allow_sequence_booking: Boolean(collected.allow_sequence_booking),
    sequence_eligible_services:
      projectedServices.sequence_eligible_services.length > 0
        ? projectedServices.sequence_eligible_services
        : Array.isArray(collected.sequence_eligible_services)
          ? collected.sequence_eligible_services
          : [],
  }
  if (collected.branding) {
    config.branding = {
      enabled: collected.branding.enabled ?? false,
      logo_url: collected.branding.logo_url ?? null,
      company_legal_name: collected.branding.company_legal_name ?? null,
      cnpj: collected.branding.cnpj ?? null,
      company_phone: collected.branding.company_phone ?? null,
      company_email: collected.branding.company_email ?? null,
    }
  }
  return config
}

export async function POST(req: NextRequest) {
  try {
    const { session_id, new_agent } = await req.json()
    if (!session_id) {
      return NextResponse.json({ error: 'session_id é obrigatório' }, { status: 400 })
    }

    const serverClient = await createServerClient()
    const { data: userData, error: userError } = await serverClient.auth.getUser()
    if (userError || !userData?.user) {
      return NextResponse.json({ error: 'Usuário não autenticado' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Configuração do servidor incompleta' }, { status: 500 })
    }

    const supabaseAdmin = createAdminClient(supabaseUrl, serviceRoleKey)

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('onboarding_sessions')
      .select('collected_data')
      .eq('session_id', session_id)
      .single()
    if (sessionError || !session) {
      return NextResponse.json({ error: 'Sessão de onboarding não encontrada' }, { status: 404 })
    }

    const collected = session.collected_data || {}
    if (!collected.business_name) {
      return NextResponse.json({ error: 'Nome do negócio não encontrado na sessão' }, { status: 400 })
    }

    const userId = userData.user.id

    if (new_agent === true) {
      const { data: tenantUser, error: tenantUserError } = await supabaseAdmin
        .from('tenant_user')
        .select('tenant_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()

      if (tenantUserError || !tenantUser?.tenant_id) {
        return NextResponse.json(
          { error: 'Conta sem tenant ativo para criar um novo agente' },
          { status: 400 }
        )
      }

      const tenantId = tenantUser.tenant_id
      const agentName =
        typeof collected.business_name === 'string' && collected.business_name.trim()
          ? collected.business_name.trim()
          : 'Novo agente'
      const businessType =
        typeof collected.business_type === 'string' && collected.business_type.trim()
          ? collected.business_type.trim()
          : null

      const { data: agent, error: agentError } = await supabaseAdmin
        .from('agent')
        .insert({
          tenant_id: tenantId,
          name: agentName,
          business_type: businessType,
          channel_primary: 'whatsapp',
          status: 'draft',
        })
        .select('id')
        .single()

      if (agentError || !agent?.id) {
        return NextResponse.json(
          { error: `Erro ao criar novo agente: ${agentError?.message ?? 'desconhecido'}` },
          { status: 500 }
        )
      }

      const tone =
        collected.tone_of_voice === 'friendly'
          ? 'friendly'
          : collected.tone_of_voice === 'formal'
            ? 'formal'
            : collected.tone_of_voice === 'professional'
              ? 'professional'
              : 'professional'

      const handoffMode =
        typeof collected.handoff_mode === 'string' && collected.handoff_mode.trim()
          ? collected.handoff_mode
          : 'conditional'

      const businessConfig = buildBusinessConfigFromCollected(collected)

      const { error: settingError } = await supabaseAdmin
        .from('agent_setting')
        .insert({
          agent_id: agent.id,
          tone,
          language: 'pt-BR',
          handoff_mode: handoffMode,
          business_config: businessConfig,
          when_client_asks_price_no_value:
            businessConfig.when_client_asks_price_no_value || 'offer_handoff_or_booking',
        })

      if (settingError) {
        return NextResponse.json(
          { error: `Agente criado, mas falhou ao salvar configuração: ${settingError.message}` },
          { status: 500 }
        )
      }

      const flowLayout = {
        nodes: EMPTY_FLOW_DEFINITION.nodes.map((n: { id: string; position: { x: number; y: number } }) => ({
          id: n.id,
          position: n.position,
        })),
      }

      const { error: flowError } = await supabaseAdmin
        .from('flow')
        .insert({
          tenant_id: tenantId,
          agent_id: agent.id,
          name: 'Fluxo Principal',
          domain: businessType?.toLowerCase() ?? null,
          version: 1,
          definition: EMPTY_FLOW_DEFINITION,
          layout: flowLayout,
          is_active: true,
        })

      if (flowError) {
        return NextResponse.json(
          { error: `Agente criado, mas falhou ao criar fluxo: ${flowError.message}` },
          { status: 500 }
        )
      }

      // Criar quote_service quando context inclui orçamento (doc simulação)
      const hasQuote = collected.context === 'quote' || collected.context === 'both'
      const quoteServices = Array.isArray(collected.quote_services) ? collected.quote_services : []
      if (hasQuote && quoteServices.length > 0) {
        const dynamicVars = Array.isArray(collected.dynamic_variables) ? collected.dynamic_variables : []
        const dynamicVarKeys = dynamicVars
          .map((v: any) => (typeof v?.key === 'string' ? v.key : ''))
          .filter((k: string) => k.length > 0)
        const externalKeys = Array.isArray(collected.quote_external_variable_keys)
          ? collected.quote_external_variable_keys.filter(
              (k: unknown): k is string => typeof k === 'string' && dynamicVarKeys.includes(k)
            )
          : dynamicVarKeys.slice(0, 2)
        for (const qs of quoteServices) {
          if (!qs?.name?.trim()) continue
          const variablesSchema = dynamicVars.map((v: any) => ({
            key: v.key,
            type: v.type === 'number' ? 'number' : 'text',
            label: v.label,
            required: false,
          }))
          const pricingType =
            /area|m²|m2/i.test(qs.pricing_type) ? 'area' :
            /linear/i.test(qs.pricing_type) ? 'linear' :
            /unit/i.test(qs.pricing_type) ? 'unit' : 'custom_manual'
          const keywords = (qs.name || '')
            .toLowerCase()
            .split(/\s+/)
            .filter((w: string) => w.length > 2)
            .slice(0, 10)
          await supabaseAdmin.from('quote_service').insert({
            agent_id: agent.id,
            name: qs.name.trim(),
            pricing_type: pricingType,
            variables_schema: variablesSchema,
            pricing_rules: {},
            external_variable_keys: externalKeys,
            keywords,
            active: true,
          })
        }
      }

      const evolutionProvision = await autoProvisionEvolutionForAgent({
        supabaseAdmin,
        agentId: agent.id,
        tenantId,
      })

      return NextResponse.json({
        success: true,
        agent_id: agent.id,
        redirect_to: `/app/agentes/${agent.id}?tab=canais&pending=whatsapp`,
        whatsapp_auto_provision: evolutionProvision,
      })
    }

    const tenantSlug = await generateUniqueSlug(supabaseAdmin, collected.business_name)

    const { data: tenantData, error: tenantError } = await supabaseAdmin
      .from('tenant')
      .insert({ name: collected.business_name, slug: tenantSlug })
      .select()
      .single()
    if (tenantError) {
      return NextResponse.json({ error: `Erro ao criar tenant: ${tenantError.message}` }, { status: 500 })
    }

    const tenantId = tenantData.id
    const { error: tenantUserError } = await supabaseAdmin.from('tenant_user').insert({
      tenant_id: tenantId,
      user_id: userId,
      role: 'owner',
    })
    if (tenantUserError) {
      await supabaseAdmin.from('tenant').delete().eq('id', tenantId)
      return NextResponse.json({ error: `Erro ao criar tenant_user: ${tenantUserError.message}` }, { status: 500 })
    }

    await supabaseAdmin.from('tenant_setting').insert({
      tenant_id: tenantId,
      tone:
        collected.tone_of_voice === 'friendly'
          ? 'friendly'
          : collected.tone_of_voice === 'formal'
            ? 'formal'
            : collected.tone_of_voice === 'professional'
              ? 'professional'
              : null,
      language: 'pt-BR',
      handoff_mode: collected.handoff_mode || 'conditional',
    })

    // Criar agent, agent_setting, flow e quote_service com os dados do onboarding (igual ao fluxo new_agent=true)
    const agentName =
      typeof collected.business_name === 'string' && collected.business_name.trim()
        ? collected.business_name.trim()
        : 'Novo agente'
    const businessType =
      typeof collected.business_type === 'string' && collected.business_type.trim()
        ? collected.business_type.trim()
        : null

    const { data: agent, error: agentError } = await supabaseAdmin
      .from('agent')
      .insert({
        tenant_id: tenantId,
        name: agentName,
        business_type: businessType,
        channel_primary: 'whatsapp',
        status: 'draft',
      })
      .select('id')
      .single()

    if (agentError || !agent?.id) {
      return NextResponse.json(
        { error: `Erro ao criar agente: ${agentError?.message ?? 'desconhecido'}` },
        { status: 500 }
      )
    }

    const tone =
      collected.tone_of_voice === 'friendly'
        ? 'friendly'
        : collected.tone_of_voice === 'formal'
          ? 'formal'
          : collected.tone_of_voice === 'professional'
            ? 'professional'
            : 'professional'

    const handoffMode =
      typeof collected.handoff_mode === 'string' && collected.handoff_mode.trim()
        ? collected.handoff_mode
        : 'conditional'

    const businessConfig = buildBusinessConfigFromCollected(collected)

    const { error: settingError } = await supabaseAdmin
      .from('agent_setting')
      .insert({
        agent_id: agent.id,
        tone,
        language: 'pt-BR',
        handoff_mode: handoffMode,
        business_config: businessConfig,
        when_client_asks_price_no_value:
          businessConfig.when_client_asks_price_no_value || 'offer_handoff_or_booking',
      })

    if (settingError) {
      return NextResponse.json(
        { error: `Agente criado, mas falhou ao salvar configuração: ${settingError.message}` },
        { status: 500 }
      )
    }

    const flowLayout = {
      nodes: EMPTY_FLOW_DEFINITION.nodes.map((n: { id: string; position: { x: number; y: number } }) => ({
        id: n.id,
        position: n.position,
      })),
    }

    const { error: flowError } = await supabaseAdmin
      .from('flow')
      .insert({
        tenant_id: tenantId,
        agent_id: agent.id,
        name: 'Fluxo Principal',
        domain: businessType?.toLowerCase() ?? null,
        version: 1,
        definition: EMPTY_FLOW_DEFINITION,
        layout: flowLayout,
        is_active: true,
      })

    if (flowError) {
      return NextResponse.json(
        { error: `Agente criado, mas falhou ao criar fluxo: ${flowError.message}` },
        { status: 500 }
      )
    }

    // Criar quote_service quando context inclui orçamento
    const hasQuote = collected.context === 'quote' || collected.context === 'both'
    const quoteServices = Array.isArray(collected.quote_services) ? collected.quote_services : []
    if (hasQuote && quoteServices.length > 0) {
      const dynamicVars = Array.isArray(collected.dynamic_variables) ? collected.dynamic_variables : []
      const dynamicVarKeys = dynamicVars
        .map((v: any) => (typeof v?.key === 'string' ? v.key : ''))
        .filter((k: string) => k.length > 0)
      const externalKeys = Array.isArray(collected.quote_external_variable_keys)
        ? collected.quote_external_variable_keys.filter(
            (k: unknown): k is string => typeof k === 'string' && dynamicVarKeys.includes(k)
          )
        : dynamicVarKeys.slice(0, 2)
      for (const qs of quoteServices) {
        if (!qs?.name?.trim()) continue
        const variablesSchema = dynamicVars.map((v: any) => ({
          key: v.key,
          type: v.type === 'number' ? 'number' : 'text',
          label: v.label,
          required: false,
        }))
        const pricingType =
          /area|m²|m2/i.test(qs.pricing_type) ? 'area' :
          /linear/i.test(qs.pricing_type) ? 'linear' :
          /unit/i.test(qs.pricing_type) ? 'unit' : 'custom_manual'
        const keywords = (qs.name || '')
          .toLowerCase()
          .split(/\s+/)
          .filter((w: string) => w.length > 2)
          .slice(0, 10)
        await supabaseAdmin.from('quote_service').insert({
          agent_id: agent.id,
          name: qs.name.trim(),
          pricing_type: pricingType,
          variables_schema: variablesSchema,
          pricing_rules: {},
          external_variable_keys: externalKeys,
          keywords,
          active: true,
        })
      }
    }

    const evolutionProvision = await autoProvisionEvolutionForAgent({
      supabaseAdmin,
      agentId: agent.id,
      tenantId,
    })

    return NextResponse.json({
      success: true,
      agent_id: agent.id,
      tenant_id: tenantId,
      redirect_to: `/app/agentes/${agent.id}?tab=canais&pending=whatsapp`,
      whatsapp_auto_provision: evolutionProvision,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro interno do servidor' }, { status: 500 })
  }
}

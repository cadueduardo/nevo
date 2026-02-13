import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

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
  const baseUrl =
    process.env.EVOLUTION_AUTO_BASE_URL?.trim() ||
    process.env.EVOLUTION_BASE_URL?.trim() ||
    null
  const apiKey =
    process.env.EVOLUTION_AUTO_API_KEY?.trim() ||
    process.env.EVOLUTION_API_KEY?.trim() ||
    null
  return { baseUrl: baseUrl ? baseUrl.replace(/\/$/, '') : null, apiKey }
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
  businessName?: string
}) {
  const { supabaseAdmin, agentId, tenantId, businessName } = params
  const appOrigin = resolveAppOrigin()
  const { baseUrl, apiKey } = getEvolutionEnvConfig()
  const instance = sanitizeInstanceName(
    `${businessName || 'agente'}-${tenantId.slice(0, 8)}-${agentId.slice(0, 8)}`
  )

  if (!baseUrl || !apiKey || !appOrigin) {
    const missing = [
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
        evolution_api_key_encrypted: apiKey,
        webhook_url: null,
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
    { instanceName: instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
    { instanceName: instance, qrcode: true, integration: 'BAILEYS' },
    { instance: instance, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
    { instanceName: instance, qrcode: true },
  ]
  const createRes = await tryEvolutionCall(createUrls, 'POST', headers, createBodies)

  const webhookUrl = `${appOrigin}/api/webhooks/evolution/${agentId}`
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
      evolution_api_key_encrypted: apiKey,
      webhook_url: webhookUrl,
      last_error: lastError,
    },
    { onConflict: 'agent_id' }
  )

  return { ok, webhook_url: webhookUrl, instance, last_error: lastError }
}

function buildBusinessConfigFromCollected(collected: Record<string, any>) {
  return {
    business_name: collected.business_name,
    business_type: collected.business_type,
    context_mode: collected.context ?? 'booking',
    establishment_address: collected.establishment_address,
    tone_of_voice: collected.tone_of_voice,
    services: Array.isArray(collected.services) ? collected.services : [],
    when_client_asks_price_no_value: collected.when_client_asks_price_no_value || 'offer_handoff_or_booking',
    schedule: collected.schedule,
    staff: Array.isArray(collected.staff) ? collected.staff : [],
    dynamic_variables: Array.isArray(collected.dynamic_variables) ? collected.dynamic_variables : [],
    lead_policy: collected.lead_policy,
    holidays_attend: Array.isArray(collected.holidays_attend) ? collected.holidays_attend : [],
    closure_periods: Array.isArray(collected.closure_periods) ? collected.closure_periods : [],
    allow_sequence_booking: Boolean(collected.allow_sequence_booking),
    sequence_eligible_services: Array.isArray(collected.sequence_eligible_services)
      ? collected.sequence_eligible_services
      : [],
  }
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

      const evolutionProvision = await autoProvisionEvolutionForAgent({
        supabaseAdmin,
        agentId: agent.id,
        tenantId,
        businessName: agentName,
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

    return NextResponse.json({ success: true, tenant_id: tenantId, redirect_to: '/app' })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erro interno do servidor' }, { status: 500 })
  }
}

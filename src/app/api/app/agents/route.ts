import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Agent, AgentWhatsAppSummary } from '@/types/agent'

/** Fluxo vazio mínimo para agente criado "em branco". */
const EMPTY_FLOW_DEFINITION = {
  nodes: [
    { id: 'start', type: 'trigger', position: { x: 100, y: 100 }, data: { label: 'Início', trigger: 'message' } },
    { id: 'greeting', type: 'send', position: { x: 100, y: 200 }, data: { label: 'Saudação', message: 'Olá! Como posso ajudar?' } },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'greeting' }],
} as const

/**
 * GET /api/app/agents
 * Lista agentes do tenant do usuário (id, name, business_type, status, channel_primary, updated_at, contagens, whatsapp).
 * 401 se não autenticado; 404 se sem tenant.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { data: tenantUser, error: tuError } = await supabase
    .from('tenant_user')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (tuError || !tenantUser?.tenant_id) {
    return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
  }
  const tenantId = tenantUser.tenant_id

  const { data: agents, error: agentsError } = await supabase
    .from('agent')
    .select('id, name, business_type, channel_primary, status, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (agentsError) {
    return NextResponse.json({ error: agentsError.message }, { status: 500 })
  }
  if (!agents?.length) {
    return NextResponse.json([])
  }

  const agentIds = agents.map((a) => a.id)

  const [settingsRes, whatsappRes, appointmentsRes] = await Promise.all([
    supabase
      .from('agent_setting')
      .select('agent_id, business_config')
      .in('agent_id', agentIds),
    supabase
      .from('agent_channel_whatsapp')
      .select('agent_id, status, provider')
      .in('agent_id', agentIds),
    supabase
      .from('appointment')
      .select('agent_id')
      .in('agent_id', agentIds)
      .gte('start_at', new Date().toISOString()),
  ])

  const settingsByAgent = new Map<string, { business_config: unknown }>()
  for (const row of settingsRes.data ?? []) {
    settingsByAgent.set(row.agent_id, { business_config: row.business_config })
  }
  const whatsappByAgent = new Map<string, { status: string; provider?: string }>()
  for (const row of whatsappRes.data ?? []) {
    whatsappByAgent.set(row.agent_id, {
      status: row.status,
      provider: row.provider ?? undefined,
    })
  }
  const upcomingByAgent = new Map<string, number>()
  for (const row of appointmentsRes.data ?? []) {
    upcomingByAgent.set(row.agent_id, (upcomingByAgent.get(row.agent_id) ?? 0) + 1)
  }

  const result: Agent[] = agents.map((a) => {
    const bc = settingsByAgent.get(a.id)?.business_config as { services?: unknown[] } | undefined
    const servicesCount = Array.isArray(bc?.services) ? bc.services.length : 0
    return {
      id: a.id,
      name: a.name,
      business_type: a.business_type ?? null,
      channel_primary: a.channel_primary as Agent['channel_primary'],
      status: a.status as Agent['status'],
      updated_at: a.updated_at,
      services_count: servicesCount,
      upcoming_bookings_count: upcomingByAgent.get(a.id) ?? 0,
      whatsapp: whatsappByAgent.get(a.id)
        ? {
            status: whatsappByAgent.get(a.id)!.status as AgentWhatsAppSummary['status'],
            provider: whatsappByAgent.get(a.id)!.provider as AgentWhatsAppSummary['provider'],
          }
        : undefined,
    }
  })

  return NextResponse.json(result)
}

/**
 * POST /api/app/agents
 * Cria agente (draft), agent_setting padrão e flow mínimo. Body opcional: name, business_type.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { data: tenantUser, error: tuError } = await supabase
    .from('tenant_user')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (tuError || !tenantUser?.tenant_id) {
    return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
  }
  const tenantId = tenantUser.tenant_id

  const body = await req.json().catch(() => ({}))
  const name = typeof body === 'object' && body !== null && typeof body.name === 'string'
    ? body.name.trim() || 'Novo agente'
    : 'Novo agente'
  const businessType = typeof body === 'object' && body !== null && typeof body.business_type === 'string'
    ? body.business_type.trim() || null
    : null

  const { data: agent, error: agentError } = await supabase
    .from('agent')
    .insert({
      tenant_id: tenantId,
      name,
      business_type: businessType,
      channel_primary: 'whatsapp',
      status: 'draft',
    })
    .select('id, name, business_type, status, updated_at')
    .single()

  if (agentError) {
    return NextResponse.json({ error: agentError.message }, { status: 500 })
  }

  await supabase.from('agent_setting').insert({
    agent_id: agent.id,
    tone: 'professional',
    language: 'pt-BR',
    handoff_mode: 'conditional',
    business_config: {},
    when_client_asks_price_no_value: 'offer_handoff_or_booking',
  })

  const flowLayout = {
    nodes: EMPTY_FLOW_DEFINITION.nodes.map((n: { id: string; position: { x: number; y: number } }) => ({
      id: n.id,
      position: n.position,
    })),
  }
  const { error: flowError } = await supabase.from('flow').insert({
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
    return NextResponse.json({ error: `Agente criado, mas fluxo falhou: ${flowError.message}` }, { status: 500 })
  }

  return NextResponse.json({
    id: agent.id,
    name: agent.name,
    business_type: agent.business_type,
    status: agent.status,
    updated_at: agent.updated_at,
  })
}

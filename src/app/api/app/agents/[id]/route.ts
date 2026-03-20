import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Agent, AgentWhatsAppSummary } from '@/types/agent'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'
import { getCanonicalServiceCountFromConfig } from '@/lib/business-profile'
import { z } from 'zod'

const agentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  business_type: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'draft']).optional(),
})

/**
 * GET /api/app/agents/[id]
 * Retorna um agente do tenant do usuário. 404 se não existir ou não pertencer ao tenant.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const tenantId = await resolvePrimaryTenantId(supabase, user.id)
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant n?o encontrado' }, { status: 404 })
  }

  const agentId = (await params).id
  const { data: agent, error: agentError } = await supabase
    .from('agent')
    .select('id, name, business_type, channel_primary, status, updated_at')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .single()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
  }

  const [settingRes, whatsappRes, appointmentsRes] = await Promise.all([
    supabase.from('agent_setting').select('business_config').eq('agent_id', agentId).single(),
    supabase.from('agent_channel_whatsapp').select('status, provider').eq('agent_id', agentId).maybeSingle(),
    supabase
      .from('appointment')
      .select('id')
      .eq('agent_id', agentId)
      .gte('start_at', new Date().toISOString()),
  ])
  const bc = settingRes.data?.business_config as Record<string, unknown> | undefined
  const servicesCount = getCanonicalServiceCountFromConfig(bc, {
    business_name: agent.name,
    business_type: agent.business_type ?? undefined,
  })
  const upcomingBookingsCount = appointmentsRes.data?.length ?? 0

  const result: Agent = {
    id: agent.id,
    name: agent.name,
    business_type: agent.business_type ?? null,
    channel_primary: agent.channel_primary as Agent['channel_primary'],
    status: agent.status as Agent['status'],
    updated_at: agent.updated_at,
    services_count: servicesCount,
    upcoming_bookings_count: upcomingBookingsCount,
    whatsapp: whatsappRes.data
      ? { status: whatsappRes.data.status as AgentWhatsAppSummary['status'], provider: whatsappRes.data.provider as AgentWhatsAppSummary['provider'] }
      : undefined,
  }
  return NextResponse.json(result)
}

/**
 * PATCH /api/app/agents/[id]
 * Atualiza nome e/ou status do agente. Apenas campos enviados são atualizados.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }
  const tenantId = await resolvePrimaryTenantId(supabase, user.id)
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant n?o encontrado' }, { status: 404 })
  }

  const agentId = (await params).id
  const { data: agent, error: agentError } = await supabase
    .from('agent')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .single()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
  }

  const rawBody = await req.json().catch(() => null)
  const parsedBody = agentUpdateSchema.safeParse(rawBody)
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Body invalido' }, { status: 400 })
  }

  const updates: { name?: string; business_type?: string | null; status?: string } = {}
  if (parsedBody.data.name !== undefined) {
    updates.name = parsedBody.data.name
  }
  if (parsedBody.data.business_type !== undefined) {
    updates.business_type = parsedBody.data.business_type || null
  }
  if (parsedBody.data.status !== undefined) {
    updates.status = parsedBody.data.status
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo válido para atualizar' }, { status: 400 })
  }

  const { data: updated, error: updateError } = await supabase
    .from('agent')
    .update(updates)
    .eq('id', agentId)
    .select('id, name, business_type, status, updated_at')
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }
  return NextResponse.json(updated)
}



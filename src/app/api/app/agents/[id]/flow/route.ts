import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'

/**
 * GET /api/app/agents/[id]/flow
 * Retorna o flow do agente (definition + layout). 404 se agente ou flow não existir.
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
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .single()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
  }

  const { data: flow, error: flowError } = await supabase
    .from('flow')
    .select('id, definition, layout, name, version')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (flowError) {
    return NextResponse.json({ error: flowError.message }, { status: 500 })
  }

  if (!flow) {
    return NextResponse.json(
      { error: 'Nenhum fluxo ativo para este agente' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    id: flow.id,
    name: flow.name,
    version: flow.version ?? 1,
    definition: flow.definition ?? {},
    layout: flow.layout ?? {},
  })
}

/**
 * PATCH /api/app/agents/[id]/flow
 * Atualiza definition e/ou layout do flow do agente.
 * Body: { definition?: object, layout?: object }
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

  const body = await req.json().catch(() => ({}))
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const updates: { definition?: unknown; layout?: unknown } = {}
  if (body.definition !== undefined) {
    updates.definition = body.definition
  }
  if (body.layout !== undefined) {
    updates.layout = body.layout
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Envie definition e/ou layout para atualizar' },
      { status: 400 }
    )
  }

  const { data: flow, error: flowSelectError } = await supabase
    .from('flow')
    .select('id')
    .eq('agent_id', agentId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (flowSelectError || !flow) {
    return NextResponse.json(
      { error: 'Nenhum fluxo ativo para este agente' },
      { status: 404 }
    )
  }

  const { data: updated, error: updateError } = await supabase
    .from('flow')
    .update(updates)
    .eq('id', flow.id)
    .select('id, definition, layout')
    .maybeSingle()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json(
      { error: 'Fluxo não encontrado ou sem permissão para atualizar' },
      { status: 404 }
    )
  }
  return NextResponse.json(updated)
}

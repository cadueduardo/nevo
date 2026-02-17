import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'

/**
 * GET /api/app/agents/[id]/channel/whatsapp
 * Retorna status do canal WhatsApp do agente (sem credenciais).
 * 404 se agente inválido ou não pertencer ao tenant.
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

  const { data: row, error: chError } = await supabase
    .from('agent_channel_whatsapp')
    .select(
      'status, provider, phone_number, webhook_url, last_healthcheck_at, last_error, evolution_base_url, evolution_instance'
    )
    .eq('agent_id', agentId)
    .maybeSingle()

  if (chError) {
    return NextResponse.json({ error: chError.message }, { status: 500 })
  }

  if (!row) {
    return NextResponse.json({
      status: 'disconnected',
      provider: null,
      phone_number: null,
      webhook_url: null,
      last_healthcheck_at: null,
      last_error: null,
      evolution_base_url: null,
      evolution_instance: null,
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  const origin = baseUrl?.startsWith('http') ? baseUrl : baseUrl ? `https://${baseUrl}` : null
  const evolutionWebhookUrl =
    row.provider === 'evolution' && origin
      ? `${origin}/api/webhooks/evolution/${agentId}`
      : null

  return NextResponse.json({
    status: row.status,
    provider: row.provider,
    phone_number: row.phone_number ?? null,
    webhook_url: (row.provider === 'evolution' ? evolutionWebhookUrl : row.webhook_url) ?? null,
    last_healthcheck_at: row.last_healthcheck_at ?? null,
    last_error: row.last_error ?? null,
    evolution_base_url: row.evolution_base_url ?? null,
    evolution_instance: row.evolution_instance ?? null,
  })
}

/**
 * PATCH /api/app/agents/[id]/channel/whatsapp
 * Atualiza configuração WhatsApp.
 * Body: provider ('twilio'|'evolution'), twilio_*, evolution_* conforme provider.
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
  const { data: tenantUserRole } = await supabase
    .from('tenant_user')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const isAdmin = tenantUserRole?.role === 'owner' || tenantUserRole?.role === 'admin'
  if (!isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores do tenant (owner/admin) podem salvar credenciais do canal.' },
      { status: 403 }
    )
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

  const provider =
    body.provider === 'evolution'
      ? 'evolution'
      : body.provider === 'twilio' || body.provider === 'custom'
        ? body.provider
        : 'twilio'

  const twilioAccountSid =
    typeof body.twilio_account_sid === 'string' ? body.twilio_account_sid.trim() || null : null
  const twilioAuthToken =
    typeof body.twilio_auth_token === 'string' ? body.twilio_auth_token.trim() || null : null
  const messagingServiceSid =
    typeof body.messaging_service_sid === 'string'
      ? body.messaging_service_sid.trim() || null
      : null
  const phoneNumber =
    typeof body.phone_number === 'string' ? body.phone_number.trim() || null : null

  const evolutionBaseUrl =
    typeof body.evolution_base_url === 'string' ? body.evolution_base_url.trim() || null : null
  const evolutionInstance =
    typeof body.evolution_instance === 'string' ? body.evolution_instance.trim() || null : null
  const evolutionApiKey =
    typeof body.evolution_api_key === 'string' ? body.evolution_api_key.trim() || null : null

  const { data: existing } = await supabase
    .from('agent_channel_whatsapp')
    .select('agent_id')
    .eq('agent_id', agentId)
    .maybeSingle()

  const row: Record<string, unknown> = {
    provider,
    status: 'disconnected',
    updated_at: new Date().toISOString(),
  }

  if (provider === 'twilio' || provider === 'custom') {
    if (twilioAccountSid != null) row.twilio_account_sid_encrypted = twilioAccountSid
    if (twilioAuthToken != null) row.twilio_auth_token_encrypted = twilioAuthToken
    if (messagingServiceSid != null) row.messaging_service_sid = messagingServiceSid
    if (phoneNumber != null) row.phone_number = phoneNumber
    row.evolution_base_url = null
    row.evolution_instance = null
    row.evolution_api_key_encrypted = null
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    if (baseUrl) {
      const origin = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
      row.webhook_url = `${origin}/api/webhooks/twilio/${agentId}`
    }
  } else {
    if (evolutionBaseUrl != null) row.evolution_base_url = evolutionBaseUrl
    if (evolutionInstance != null) row.evolution_instance = evolutionInstance
    if (evolutionApiKey != null) row.evolution_api_key_encrypted = evolutionApiKey
    row.twilio_account_sid_encrypted = null
    row.twilio_auth_token_encrypted = null
    row.messaging_service_sid = null
    row.webhook_url = null
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('agent_channel_whatsapp')
      .update(row)
      .eq('agent_id', agentId)
    if (updateError) {
      console.error('[channel/whatsapp] UPDATE error:', updateError.message, updateError.code)
      return NextResponse.json(
        { error: `Erro ao atualizar: ${updateError.message}` },
        { status: 500 }
      )
    }
  } else {
    const insertPayload: Record<string, unknown> = {
      agent_id: agentId,
      provider: row.provider,
      status: row.status,
      twilio_account_sid_encrypted: row.twilio_account_sid_encrypted ?? null,
      twilio_auth_token_encrypted: row.twilio_auth_token_encrypted ?? null,
      messaging_service_sid: row.messaging_service_sid ?? null,
      phone_number: row.phone_number ?? null,
      evolution_base_url: row.evolution_base_url ?? null,
      evolution_instance: row.evolution_instance ?? null,
      evolution_api_key_encrypted: row.evolution_api_key_encrypted ?? null,
    }
    if (row.webhook_url != null) insertPayload.webhook_url = row.webhook_url

    const { error: insertError } = await supabase
      .from('agent_channel_whatsapp')
      .insert(insertPayload)
    if (insertError) {
      console.error('[channel/whatsapp] INSERT error:', insertError.message, insertError.code)
      return NextResponse.json(
        { error: `Erro ao salvar: ${insertError.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ ok: true })
}

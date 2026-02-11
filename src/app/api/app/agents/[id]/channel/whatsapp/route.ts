import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  const { data: tenantUser, error: tuError } = await supabase
    .from('tenant_user')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (tuError || !tenantUser?.tenant_id) {
    return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
  }

  const agentId = (await params).id
  const { data: agent, error: agentError } = await supabase
    .from('agent')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantUser.tenant_id)
    .single()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
  }

  const { data: row, error: chError } = await supabase
    .from('agent_channel_whatsapp')
    .select('status, provider, phone_number, webhook_url, last_healthcheck_at, last_error')
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
    })
  }

  return NextResponse.json({
    status: row.status,
    provider: row.provider,
    phone_number: row.phone_number ?? null,
    webhook_url: row.webhook_url ?? null,
    last_healthcheck_at: row.last_healthcheck_at ?? null,
    last_error: row.last_error ?? null,
  })
}

/**
 * PATCH /api/app/agents/[id]/channel/whatsapp
 * Atualiza configuração WhatsApp (Twilio). Credenciais são persistidas e nunca retornadas.
 * Body: provider ('twilio'|'custom'), twilio_account_sid?, twilio_auth_token?, messaging_service_sid?, phone_number?
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

  const { data: tenantUser, error: tuError } = await supabase
    .from('tenant_user')
    .select('tenant_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (tuError || !tenantUser?.tenant_id) {
    return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
  }

  const agentId = (await params).id
  const { data: agent, error: agentError } = await supabase
    .from('agent')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantUser.tenant_id)
    .single()

  if (agentError || !agent) {
    return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const provider = body.provider === 'twilio' || body.provider === 'custom' ? body.provider : 'twilio'
  const twilioAccountSid = typeof body.twilio_account_sid === 'string' ? body.twilio_account_sid.trim() || null : null
  const twilioAuthToken = typeof body.twilio_auth_token === 'string' ? body.twilio_auth_token.trim() || null : null
  const messagingServiceSid = typeof body.messaging_service_sid === 'string' ? body.messaging_service_sid.trim() || null : null
  const phoneNumber = typeof body.phone_number === 'string' ? body.phone_number.trim() || null : null

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
  if (twilioAccountSid != null) row.twilio_account_sid_encrypted = twilioAccountSid
  if (twilioAuthToken != null) row.twilio_auth_token_encrypted = twilioAuthToken
  if (messagingServiceSid != null) row.messaging_service_sid = messagingServiceSid
  if (phoneNumber != null) row.phone_number = phoneNumber
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  if (baseUrl) {
    const origin = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`
    row.webhook_url = `${origin}/api/webhooks/twilio/${agentId}`
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('agent_channel_whatsapp')
      .update(row)
      .eq('agent_id', agentId)
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }
  } else {
    const { error: insertError } = await supabase
      .from('agent_channel_whatsapp')
      .insert({
        agent_id: agentId,
        provider: row.provider,
        status: row.status,
        twilio_account_sid_encrypted: row.twilio_account_sid_encrypted ?? null,
        twilio_auth_token_encrypted: row.twilio_auth_token_encrypted ?? null,
        messaging_service_sid: row.messaging_service_sid ?? null,
        phone_number: row.phone_number ?? null,
      })
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

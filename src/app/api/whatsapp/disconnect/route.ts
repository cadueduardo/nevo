import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'

export const dynamic = 'force-dynamic'

function buildEvolutionBaseCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/$/, '')
  const candidates = [normalized]
  if (normalized.endsWith('/api')) candidates.push(normalized.replace(/\/api$/, ''))
  else candidates.push(`${normalized}/api`)
  return Array.from(new Set(candidates))
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const tenantId = await resolvePrimaryTenantId(supabase, user.id)
    if (!tenantId) return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })

    const { data: tenantUser } = await supabase
      .from('tenant_user')
      .select('role')
      .eq('user_id', user.id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const isAdmin = tenantUser?.role === 'owner' || tenantUser?.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: 'Essa opção só está disponível para o administrador.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : null
    if (!agentId) return NextResponse.json({ error: 'agent_id é obrigatório' }, { status: 400 })

    const { data: agent } = await supabase
      .from('agent')
      .select('id')
      .eq('id', agentId)
      .eq('tenant_id', tenantId)
      .single()
    if (!agent) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: channel } = await supabaseAdmin
      .from('agent_channel_whatsapp')
      .select('evolution_base_url, evolution_instance, evolution_api_key_encrypted')
      .eq('agent_id', agentId)
      .eq('provider', 'evolution')
      .maybeSingle()

    if (!channel?.evolution_base_url || !channel?.evolution_instance || !channel?.evolution_api_key_encrypted) {
      return NextResponse.json({ error: 'Canal Evolution não configurado para este agente.' }, { status: 400 })
    }

    const baseCandidates = buildEvolutionBaseCandidates(channel.evolution_base_url as string)
    const instance = channel.evolution_instance as string
    const apiKey = channel.evolution_api_key_encrypted as string
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    }

    const attempts = baseCandidates.flatMap((b) => ([
      { url: `${b}/instance/logout/${encodeURIComponent(instance)}`, method: 'DELETE' as const },
      { url: `${b}/instance/logout/${encodeURIComponent(instance)}`, method: 'POST' as const },
      { url: `${b}/v1/instance/logout/${encodeURIComponent(instance)}`, method: 'DELETE' as const },
      { url: `${b}/v2/instance/logout/${encodeURIComponent(instance)}`, method: 'DELETE' as const },
      { url: `${b}/instance/disconnect/${encodeURIComponent(instance)}`, method: 'POST' as const },
      { url: `${b}/v1/instance/disconnect/${encodeURIComponent(instance)}`, method: 'POST' as const },
      { url: `${b}/v2/instance/disconnect/${encodeURIComponent(instance)}`, method: 'POST' as const },
    ]))

    let remoteOk = false
    let remoteError = ''
    for (const attempt of attempts) {
      try {
        const res = await fetch(attempt.url, { method: attempt.method, headers })
        if (res.ok || res.status === 404) {
          remoteOk = true
          break
        }
        const text = await res.text().catch(() => '')
        remoteError = `${attempt.method} ${attempt.url}: ${res.status} ${text.slice(0, 180)}`
      } catch (e) {
        remoteError = `${attempt.method} ${attempt.url}: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    if (!remoteOk) {
      return NextResponse.json(
        { error: remoteError || 'Não foi possível desconectar na Evolution.' },
        { status: 502 }
      )
    }

    await supabaseAdmin
      .from('agent_channel_whatsapp')
      .update({
        status: 'disconnected',
        phone_number: null,
        last_error: null,
        last_healthcheck_at: new Date().toISOString(),
      })
      .eq('agent_id', agentId)

    return NextResponse.json({ ok: true, status: 'disconnected' })
  } catch (error: unknown) {
    console.error('[whatsapp/disconnect]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

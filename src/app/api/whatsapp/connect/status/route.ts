/**
 * GET /api/whatsapp/connect/status?agent_id=...
 * Consulta status da conexão Evolution (connecting | connected | error).
 * FASE 6.5 — Conectar WhatsApp.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'

function buildEvolutionBaseCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/$/, '')
  const candidates = [normalized]
  if (normalized.endsWith('/api')) candidates.push(normalized.replace(/\/api$/, ''))
  else candidates.push(`${normalized}/api`)
  return Array.from(new Set(candidates))
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const tenantId = await resolvePrimaryTenantId(supabase, user.id)
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const agentId = searchParams.get('agent_id')
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id é obrigatório' }, { status: 400 })
    }

    const { data: agent } = await supabase
      .from('agent')
      .select('id')
      .eq('id', agentId)
      .eq('tenant_id', tenantId)
      .single()

    if (!agent) {
      return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: channel } = await supabaseAdmin
      .from('agent_channel_whatsapp')
      .select('status, evolution_base_url, evolution_instance, evolution_api_key_encrypted, phone_number, last_error')
      .eq('agent_id', agentId)
      .eq('provider', 'evolution')
      .maybeSingle()

    if (!channel?.evolution_base_url || !channel?.evolution_instance || !channel?.evolution_api_key_encrypted) {
      return NextResponse.json({
        status: 'disconnected',
        message: 'Canal Evolution não configurado.',
      })
    }

    const baseUrl = (channel.evolution_base_url as string).replace(/\/$/, '')
    const instance = channel.evolution_instance as string
    const apiKey = channel.evolution_api_key_encrypted as string

    const headers: Record<string, string> = {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    }

    const baseCandidates = buildEvolutionBaseCandidates(baseUrl)
    // Evolution: GET /instance/connectionState/{instance} ou /instance/fetchInstances
    const fetchUrls = baseCandidates.flatMap((b) => ([
      { type: 'state' as const, url: `${b}/instance/connectionState/${encodeURIComponent(instance)}` },
      { type: 'state' as const, url: `${b}/v1/instance/connectionState/${encodeURIComponent(instance)}` },
      { type: 'state' as const, url: `${b}/v2/instance/connectionState/${encodeURIComponent(instance)}` },
      { type: 'list' as const, url: `${b}/instance/fetchInstances` },
      { type: 'list' as const, url: `${b}/v1/instance/fetchInstances` },
      { type: 'list' as const, url: `${b}/v2/instance/fetchInstances` },
    ]))
    let evolutionStatus: string | null = null
    let instanceExists: boolean | null = null

    for (const attempt of fetchUrls) {
      try {
        const res = await fetch(attempt.url, { method: 'GET', headers })
        if (res.ok) {
          const data = (await res.json()) as {
            state?: string
            instance?: { instanceName?: string; state?: string }
            instances?: Array<{ instance?: { instanceName?: string }; state?: string }>
            data?: Array<{ instance?: { instanceName?: string }; state?: string }>
          }
          if (attempt.type === 'state') {
            evolutionStatus = data.instance?.state ?? data.state ?? null
            instanceExists = true
            if (evolutionStatus) break
          } else {
            const rows = Array.isArray(data.instances)
              ? data.instances
              : Array.isArray(data.data)
                ? data.data
                : []
            const found = rows.find((row) => row?.instance?.instanceName === instance)
            if (found) {
              instanceExists = true
              evolutionStatus = found.state ?? evolutionStatus
              if (evolutionStatus) break
            } else if (rows.length > 0) {
              instanceExists = false
            }
          }
        } else if (res.status === 404 && attempt.type === 'state') {
          instanceExists = false
        }
      } catch {
        /* continua */
      }
    }

    if (instanceExists === false) {
      await supabaseAdmin
        .from('agent_channel_whatsapp')
        .update({
          status: 'disconnected',
          evolution_instance: null,
          phone_number: null,
          last_error: null,
          last_healthcheck_at: new Date().toISOString(),
        })
        .eq('agent_id', agentId)
      return NextResponse.json({
        status: 'disconnected',
        phone_number: null,
        last_error: null,
        evolution_state: null,
      })
    }

    const isConnected = evolutionStatus === 'open' || evolutionStatus === 'connected'
    if (isConnected && channel.status !== 'connected') {
      await supabaseAdmin
        .from('agent_channel_whatsapp')
        .update({
          status: 'connected',
          last_error: null,
          last_healthcheck_at: new Date().toISOString(),
        })
        .eq('agent_id', agentId)
    }

    return NextResponse.json({
      status: isConnected ? 'connected' : (channel.status as string),
      phone_number: channel.phone_number ?? null,
      last_error: channel.last_error ?? null,
      evolution_state: evolutionStatus,
    })
  } catch (error: unknown) {
    console.error('[whatsapp/connect/status]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

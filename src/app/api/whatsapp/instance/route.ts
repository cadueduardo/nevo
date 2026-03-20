import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'
import { z } from 'zod'
import {
  buildEvolutionBaseCandidates,
  resolveEvolutionApiKey,
  sanitizeEvolutionBaseUrl,
} from '@/lib/whatsapp/evolution'

export const dynamic = 'force-dynamic'

const whatsappAgentIdSchema = z.object({
  agent_id: z.string().trim().min(1),
})

function getEvolutionEnvApiKey(): string | null {
  return (
    process.env.EVOLUTION_AUTO_API_KEY?.trim() ||
    process.env.EVOLUTION_API_KEY?.trim() ||
    null
  )
}

export async function DELETE(req: NextRequest) {
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
      return NextResponse.json(
        { error: 'Essa opção só está disponível para o administrador.' },
        { status: 403 }
      )
    }

    const fromQuery = new URL(req.url).searchParams.get('agent_id')
    const body = await req.json().catch(() => ({}))
    const fromBody = typeof body.agent_id === 'string' ? body.agent_id.trim() : null
    const agentId = (fromBody || fromQuery || '').trim()
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

    if (
      !channel?.evolution_base_url ||
      !channel?.evolution_instance ||
      (!channel?.evolution_api_key_encrypted && !getEvolutionEnvApiKey())
    ) {
      return NextResponse.json(
        { error: 'Canal Evolution não configurado para este agente.' },
        { status: 400 }
      )
    }

    const baseUrl = sanitizeEvolutionBaseUrl(channel.evolution_base_url as string).value
    const instance = channel.evolution_instance as string
    const apiKey = resolveEvolutionApiKey({
      storedValue: channel.evolution_api_key_encrypted as string,
      envValue: getEvolutionEnvApiKey(),
    })
    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: 'Configuração Evolution inválida.' }, { status: 400 })
    }

    const baseCandidates = buildEvolutionBaseCandidates(baseUrl)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    }

    const attempts = baseCandidates.flatMap((b) => [
      { url: `${b}/instance/delete/${encodeURIComponent(instance)}`, method: 'DELETE' as const },
      { url: `${b}/instance/delete/${encodeURIComponent(instance)}`, method: 'POST' as const },
      { url: `${b}/v1/instance/delete/${encodeURIComponent(instance)}`, method: 'DELETE' as const },
      { url: `${b}/v2/instance/delete/${encodeURIComponent(instance)}`, method: 'DELETE' as const },
      { url: `${b}/instance/delete`, method: 'DELETE' as const, body: { instanceName: instance } },
      { url: `${b}/instance/delete`, method: 'POST' as const, body: { instanceName: instance } },
    ])

    let remoteOk = false
    let remoteError = ''
    for (const attempt of attempts) {
      try {
        const res = await fetch(attempt.url, {
          method: attempt.method,
          headers,
          body: 'body' in attempt ? JSON.stringify(attempt.body) : undefined,
        })
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
        { error: remoteError || 'Não foi possível remover a instância na Evolution.' },
        { status: 502 }
      )
    }

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

    return NextResponse.json({ ok: true, status: 'disconnected' })
  } catch (error: unknown) {
    console.error('[whatsapp/instance] delete', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}


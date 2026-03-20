import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'
import { resolveEvolutionApiKey } from '@/lib/whatsapp/evolution'
import { z } from 'zod'
import {
  buildEvolutionBaseCandidates,
  buildEvolutionWebhookUrl,
  encryptEvolutionApiKey,
  ensureEvolutionWebhookSecret,
  sanitizeEvolutionBaseUrl,
} from '@/lib/whatsapp/evolution'

const whatsappChannelPatchSchema = z.object({
  evolution_base_url: z.string().trim().min(1).nullable().optional(),
  evolution_instance: z.string().trim().min(1).nullable().optional(),
  evolution_api_key: z.string().trim().min(1).nullable().optional(),
})

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

async function resolveEvolutionLiveStatus(input: {
  baseUrl: string | null
  instance: string | null
  storedApiKey: string | null
  envApiKey: string | null
  persistedStatus: string | null
  phoneNumber: string | null
  lastError: string | null
}) {
  if (!input.baseUrl || !input.instance || (!input.storedApiKey && !input.envApiKey)) {
    return {
      status: input.persistedStatus ?? 'disconnected',
      phone_number: input.phoneNumber,
      last_error: input.lastError,
      evolution_state: null as string | null,
    }
  }

  const apiKey = resolveEvolutionApiKey({
    storedValue: input.storedApiKey,
    envValue: input.envApiKey,
  })
  const instance = input.instance
  if (!apiKey) {
    return {
      status: input.persistedStatus ?? 'disconnected',
      phone_number: input.phoneNumber,
      last_error: input.lastError,
      evolution_state: null as string | null,
    }
  }

  const headers: Record<string, string> = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  }

  const baseCandidates = buildEvolutionBaseCandidates(input.baseUrl)
  const fetchUrls = baseCandidates.flatMap((b) => [
    { type: 'state' as const, url: `${b}/instance/connectionState/${encodeURIComponent(instance)}` },
    { type: 'state' as const, url: `${b}/v1/instance/connectionState/${encodeURIComponent(instance)}` },
    { type: 'state' as const, url: `${b}/v2/instance/connectionState/${encodeURIComponent(instance)}` },
    { type: 'list' as const, url: `${b}/instance/fetchInstances` },
    { type: 'list' as const, url: `${b}/v1/instance/fetchInstances` },
    { type: 'list' as const, url: `${b}/v2/instance/fetchInstances` },
  ])

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
      // ignore and continue
    }
  }

  if (instanceExists === false) {
    return {
      status: 'disconnected',
      phone_number: null,
      last_error: null,
      evolution_state: null as string | null,
    }
  }

  const isConnected = evolutionStatus === 'open' || evolutionStatus === 'connected'
  return {
    status: isConnected ? 'connected' : input.persistedStatus ?? 'disconnected',
    phone_number: input.phoneNumber,
    last_error: input.lastError,
    evolution_state: evolutionStatus,
  }
}

/**
 * GET /api/app/agents/[id]/channel/whatsapp
 * Retorna status do canal WhatsApp do agente (sem credenciais).
 * 404 se agente inválido ou não pertencer ao tenant.
 */
export async function GET(
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

  const { data: row, error: chError } = await supabase
    .from('agent_channel_whatsapp')
    .select(
      'status, provider, phone_number, webhook_url, last_healthcheck_at, last_error, evolution_base_url, evolution_instance, evolution_api_key_encrypted, webhook_secret'
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
  const includeLive = req.nextUrl.searchParams.get('include_live') === '1'
  const evolutionWebhookUrl =
    row.provider === 'evolution' && origin
      ? (row.webhook_url as string | null) ||
        buildEvolutionWebhookUrl({
          appOrigin: origin,
          agentId,
          webhookSecret: row.webhook_secret as string | null,
        })
      : null

  const liveState =
    includeLive && row.provider === 'evolution'
      ? await resolveEvolutionLiveStatus({
          baseUrl: row.evolution_base_url as string | null,
          instance: row.evolution_instance as string | null,
          storedApiKey: row.evolution_api_key_encrypted as string | null,
          envApiKey: getEvolutionEnvConfig().apiKey,
          persistedStatus: row.status as string | null,
          phoneNumber: row.phone_number as string | null,
          lastError: row.last_error as string | null,
        })
      : null

  return NextResponse.json({
    status: liveState?.status ?? row.status,
    provider: row.provider,
    phone_number: liveState?.phone_number ?? row.phone_number ?? null,
    webhook_url: (row.provider === 'evolution' ? evolutionWebhookUrl : row.webhook_url) ?? null,
    last_healthcheck_at: row.last_healthcheck_at ?? null,
    last_error: liveState?.last_error ?? row.last_error ?? null,
    evolution_base_url: row.evolution_base_url ?? null,
    evolution_instance: row.evolution_instance ?? null,
    ...(includeLive ? { evolution_state: liveState?.evolution_state ?? null } : {}),
  })
}

/**
 * PATCH /api/app/agents/[id]/channel/whatsapp
 * Atualiza configuração WhatsApp (Evolution-only).
 * Body: provider='evolution' (opcional), evolution_*.
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

  const provider = 'evolution'

  const rawEvolutionBaseUrl =
    typeof body.evolution_base_url === 'string' ? body.evolution_base_url.trim() || null : null
  const evolutionInstance =
    typeof body.evolution_instance === 'string' ? body.evolution_instance.trim() || null : null
  const evolutionApiKey =
    typeof body.evolution_api_key === 'string' ? body.evolution_api_key.trim() || null : null

  const { data: existing } = await supabase
    .from('agent_channel_whatsapp')
    .select('agent_id, evolution_base_url, evolution_instance, evolution_api_key_encrypted, webhook_secret')
    .eq('agent_id', agentId)
    .maybeSingle()

  const row: Record<string, unknown> = {
    provider,
    status: 'disconnected',
    last_error: null,
    updated_at: new Date().toISOString(),
  }

  const envEvolution = getEvolutionEnvConfig()
  if (envEvolution.baseUrlError) {
    return NextResponse.json({ error: envEvolution.baseUrlError }, { status: 400 })
  }
  const validatedBaseUrl = rawEvolutionBaseUrl
    ? sanitizeEvolutionBaseUrl(rawEvolutionBaseUrl)
    : { value: null, error: null }
  if (validatedBaseUrl.error) {
    return NextResponse.json({ error: validatedBaseUrl.error }, { status: 400 })
  }
  const resolvedBaseUrl =
    validatedBaseUrl.value ||
    (existing?.evolution_base_url as string | null) ||
    envEvolution.baseUrl
  const resolvedInstance =
    evolutionInstance ||
    (existing?.evolution_instance as string | null) ||
    sanitizeInstanceName(`nevo-${tenantId.slice(0, 8)}-${agentId.slice(0, 8)}`)
  const resolvedStoredApiKey =
    evolutionApiKey && evolutionApiKey.length > 0
      ? encryptEvolutionApiKey(evolutionApiKey)
      : (existing?.evolution_api_key_encrypted as string | null) || null

  if (!resolvedBaseUrl || !resolvedInstance || (!resolvedStoredApiKey && !envEvolution.apiKey)) {
    return NextResponse.json(
      {
        error:
          'Configuração Evolution incompleta. Preencha URL/instância/API Key ou defina EVOLUTION_AUTO_BASE_URL e EVOLUTION_AUTO_API_KEY no ambiente.',
      },
      { status: 400 }
    )
  }

  const webhookSecret = ensureEvolutionWebhookSecret(existing?.webhook_secret as string | null)
  row.evolution_base_url = resolvedBaseUrl
  row.evolution_instance = resolvedInstance
  row.evolution_api_key_encrypted = resolvedStoredApiKey
  row.webhook_url = null
  row.webhook_secret = webhookSecret

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
      phone_number: row.phone_number ?? null,
      evolution_base_url: row.evolution_base_url ?? null,
      evolution_instance: row.evolution_instance ?? null,
      evolution_api_key_encrypted: row.evolution_api_key_encrypted ?? null,
      webhook_secret: row.webhook_secret ?? null,
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


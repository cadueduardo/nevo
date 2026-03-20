/**
 * POST /api/whatsapp/connect/retry
 * Reexecuta connect e gera novo pairing code.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'
import { normalizePhoneNumber } from '@/lib/actor'
import { z } from 'zod'
import {
  buildEvolutionBaseCandidates,
  resolveEvolutionApiKey,
  sanitizeEvolutionBaseUrl,
} from '@/lib/whatsapp/evolution'

export const dynamic = 'force-dynamic'

const whatsappConnectRetrySchema = z.object({
  agent_id: z.string().trim().min(1),
  phone: z.string().trim().min(1),
})

function getEvolutionEnvApiKey(): string | null {
  return (
    process.env.EVOLUTION_AUTO_API_KEY?.trim() ||
    process.env.EVOLUTION_API_KEY?.trim() ||
    null
  )
}

function isLikelyValidPairingCode(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const code = value.trim()
  if (!code) return false
  if (code.includes(',') || code.includes('@') || code.includes('/') || code.includes('=')) return false
  return /^[A-Za-z0-9-]{4,20}$/.test(code)
}

function extractPairingCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const candidates = [
    root.pairingCode,
    root.pairing_code,
    root.code,
    (root.data as Record<string, unknown> | undefined)?.pairingCode,
    (root.data as Record<string, unknown> | undefined)?.pairing_code,
    (root.data as Record<string, unknown> | undefined)?.code,
  ]
  for (const candidate of candidates) {
    if (isLikelyValidPairingCode(candidate)) return candidate.trim()
  }
  return null
}

function hasQrPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const root = payload as Record<string, unknown>
  const base64 =
    typeof root.base64 === 'string'
      ? root.base64
      : typeof (root.data as Record<string, unknown> | undefined)?.base64 === 'string'
        ? ((root.data as Record<string, unknown>).base64 as string)
        : null
  return Boolean(base64 && base64.length > 40)
}

export async function POST(req: NextRequest) {
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

    const body = await req.json().catch(() => ({}))
    const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : null
    const phone = normalizePhoneNumber(typeof body.phone === 'string' ? body.phone : '')

    if (!agentId || phone.length < 12) {
      return NextResponse.json(
        { error: 'agent_id e phone (DDI+DDD+número) são obrigatórios' },
        { status: 400 }
      )
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
        { error: 'Canal Evolution não configurado. Use "Conectar WhatsApp" para iniciar.' },
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    }

    const encodedInstance = encodeURIComponent(instance)
    const encodedPhone = encodeURIComponent(phone)
    const connectAttempts = buildEvolutionBaseCandidates(baseUrl).flatMap((b) => [
      { method: 'GET' as const, url: `${b}/instance/connect/${encodedInstance}?number=${encodedPhone}` },
      { method: 'GET' as const, url: `${b}/v1/instance/connect/${encodedInstance}?number=${encodedPhone}` },
      { method: 'GET' as const, url: `${b}/v2/instance/connect/${encodedInstance}?number=${encodedPhone}` },
      { method: 'POST' as const, url: `${b}/instance/connect/${encodedInstance}`, body: { number: phone } },
      { method: 'POST' as const, url: `${b}/v1/instance/connect/${encodedInstance}`, body: { number: phone } },
      { method: 'POST' as const, url: `${b}/v2/instance/connect/${encodedInstance}`, body: { number: phone } },
    ])

    let pairingCode: string | null = null
    let connectError = ''
    let qrOnlyModeDetected = false
    for (const attempt of connectAttempts) {
      try {
        const res = await fetch(attempt.url, {
          method: attempt.method,
          headers,
          body: 'body' in attempt ? JSON.stringify(attempt.body) : undefined,
        })
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as unknown
          pairingCode = extractPairingCode(data)
          if (pairingCode) break
          if (hasQrPayload(data)) {
            qrOnlyModeDetected = true
            connectError =
              'Este ambiente da Evolution não suporta conexão sem QR Code. Ajuste a configuração/versão da Evolution para retornar pairing code por número.'
            break
          }
          connectError = `${attempt.method} ${attempt.url}: Evolution não retornou um pairing code válido.`
        } else {
          const errText = await res.text().catch(() => '')
          connectError = `${attempt.method} ${attempt.url}: ${errText.slice(0, 180)}`
        }
      } catch (e) {
        connectError = `${attempt.method} ${attempt.url}: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    if (!pairingCode) {
      if (qrOnlyModeDetected) {
        return NextResponse.json(
          {
            error:
              'Este ambiente da Evolution não suporta conexão sem QR Code. Ajuste a configuração/versão da Evolution para retornar pairing code por número.',
            requires_qr: true,
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: connectError || 'Não foi possível obter novo código. Tente novamente.' },
        { status: 502 }
      )
    }

    await supabaseAdmin
      .from('agent_channel_whatsapp')
      .update({ status: 'connecting', phone_number: phone, last_error: null })
      .eq('agent_id', agentId)

    return NextResponse.json({
      pairingCode,
      instance_key: instance,
      status: 'connecting',
    })
  } catch (error: unknown) {
    console.error('[whatsapp/connect/retry]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}


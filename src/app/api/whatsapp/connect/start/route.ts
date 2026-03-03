/**
 * POST /api/whatsapp/connect/start
 * Inicia conexão WhatsApp via Evolution API (pairing code).
 * FASE 6.5 — Conectar WhatsApp no chat via Evolution API.
 *
 * Body: { agent_id: string, phone: string }
 * - phone: número com DDI (ex: 5511999999999), normalizado.
 *
 * Ações:
 * 1) Criar/garantir instância Evolution (qrcode: false para pairing)
 * 2) Chamar Instance Connect com number → retorna pairingCode
 * 3) Salvar status=connecting no agent_channel_whatsapp
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'
import { normalizePhoneNumber } from '@/lib/actor'

export const dynamic = 'force-dynamic'

function resolveAppOrigin(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
  if (!baseUrl) return null
  return baseUrl.startsWith('http') ? baseUrl.replace(/\/$/, '') : `https://${baseUrl}`.replace(/\/$/, '')
}

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
  const baseUrl =
    process.env.EVOLUTION_AUTO_BASE_URL?.trim() ||
    process.env.EVOLUTION_BASE_URL?.trim() ||
    null
  const apiKey =
    process.env.EVOLUTION_AUTO_API_KEY?.trim() ||
    process.env.EVOLUTION_API_KEY?.trim() ||
    null
  return { baseUrl: baseUrl ? baseUrl.replace(/\/$/, '') : null, apiKey }
}

function buildEvolutionBaseCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/$/, '')
  const candidates = [normalized]
  if (normalized.endsWith('/api')) {
    candidates.push(normalized.replace(/\/api$/, ''))
  } else {
    candidates.push(`${normalized}/api`)
  }
  return Array.from(new Set(candidates))
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isLikelyValidPairingCode(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const code = value.trim()
  if (!code) return false
  // Bloqueia payloads técnicos (base64/chaves) que não são códigos digitáveis no WhatsApp.
  if (code.includes(',') || code.includes('@') || code.includes('/') || code.includes('=')) return false
  // Código de pareamento costuma ser curto e alfanumérico (com ou sem hífen).
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
    const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : ''

    if (!agentId) {
      return NextResponse.json({ error: 'agent_id é obrigatório' }, { status: 400 })
    }

    const phone = normalizePhoneNumber(phoneRaw)
    if (phone.length < 12) {
      return NextResponse.json(
        { error: 'Número inválido. Use DDI+DDD+número (ex: 5511999999999).' },
        { status: 400 }
      )
    }

    const { data: agent } = await supabase
      .from('agent')
      .select('id, tenant_id, name')
      .eq('id', agentId)
      .eq('tenant_id', tenantId)
      .single()

    if (!agent) {
      return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
    }

    const appOrigin = resolveAppOrigin()
    const envConfig = getEvolutionEnvConfig()
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: existingChannel } = await supabaseAdmin
      .from('agent_channel_whatsapp')
      .select('evolution_base_url, evolution_instance, evolution_api_key_encrypted')
      .eq('agent_id', agentId)
      .eq('provider', 'evolution')
      .maybeSingle()

    const configuredBaseUrl =
      (typeof existingChannel?.evolution_base_url === 'string'
        ? existingChannel.evolution_base_url.trim()
        : null) ||
      envConfig.baseUrl
    const resolvedApiKey =
      (typeof existingChannel?.evolution_api_key_encrypted === 'string'
        ? existingChannel.evolution_api_key_encrypted.trim()
        : null) ||
      envConfig.apiKey

    if (!configuredBaseUrl || !resolvedApiKey || !appOrigin) {
      const missing = [
        !configuredBaseUrl ? 'EVOLUTION_AUTO_BASE_URL/EVOLUTION_BASE_URL' : null,
        !resolvedApiKey ? 'EVOLUTION_AUTO_API_KEY/EVOLUTION_API_KEY' : null,
        !appOrigin ? 'NEXT_PUBLIC_APP_URL/VERCEL_URL' : null,
      ]
        .filter(Boolean)
        .join(', ')
      return NextResponse.json(
        { error: `Configuração incompleta: ${missing}` },
        { status: 503 }
      )
    }

    const instance =
      (typeof existingChannel?.evolution_instance === 'string'
        ? existingChannel.evolution_instance.trim()
        : null) ||
      sanitizeInstanceName(`nevo-${tenantId.slice(0, 8)}-${agentId.slice(0, 8)}`)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: resolvedApiKey,
      Authorization: `Bearer ${resolvedApiKey}`,
    }

    // 1) Criar instância (qrcode: false para pairing code)
    const evolutionBases = buildEvolutionBaseCandidates(configuredBaseUrl)
    let discoveredBaseUrl: string | null = null
    const createAttempts = evolutionBases.flatMap((b) => ([
      { base: b, url: `${b}/instance/create` },
      { base: b, url: `${b}/v1/instance/create` },
      { base: b, url: `${b}/v2/instance/create` },
      { base: b, url: `${b}/instances/create` },
    ]))
    const createBodies = [
      { instanceName: instance, qrcode: false, integration: 'WHATSAPP-BAILEYS' },
      { instanceName: instance, qrcode: false, integration: 'BAILEYS' },
      { instance: instance, qrcode: false, integration: 'WHATSAPP-BAILEYS' },
      { instanceName: instance, qrcode: false },
    ]

    let createOk = false
    let createLastError = ''
    for (const attempt of createAttempts) {
      for (const body of createBodies) {
        try {
          const res = await fetchWithTimeout(attempt.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          })
          if (res.ok || res.status === 409) {
            createOk = true
            discoveredBaseUrl = attempt.base
            break
          }
          const errText = await res.text().catch(() => '')
          createLastError = errText || `HTTP ${res.status}`
        } catch {
          createLastError = 'Falha de rede ao criar instância na Evolution.'
        }
      }
      if (createOk) break
    }

    // Alguns provedores/proxies retornam 404 para rotas de create, mesmo com instância já existente.
    // Nesses casos, seguimos para o "connect" e deixamos a validação final depender do pairingCode.

    // 2) Configurar webhook
    const webhookUrl = `${appOrigin}/api/webhooks/evolution/${agentId}`
    const webhookUrls = evolutionBases.flatMap((b) => ([
      { base: b, url: `${b}/webhook/set/${encodeURIComponent(instance)}` },
      { base: b, url: `${b}/v1/webhook/set/${encodeURIComponent(instance)}` },
      { base: b, url: `${b}/v2/webhook/set/${encodeURIComponent(instance)}` },
    ]))
    const webhookBodies = [
      { enabled: true, url: webhookUrl, events: ['MESSAGES_UPSERT'] },
      { webhook: { enabled: true, url: webhookUrl, byEvents: true, events: ['MESSAGES_UPSERT'] } },
    ]
    for (const attempt of webhookUrls) {
      for (const wb of webhookBodies) {
        try {
          const res = await fetchWithTimeout(attempt.url, { method: 'POST', headers, body: JSON.stringify(wb) })
          if (res.ok) {
            discoveredBaseUrl = attempt.base
            break
          }
        } catch {
          /* continua */
        }
      }
    }

    // 3) Instance Connect com number → pairingCode
    const encodedInstance = encodeURIComponent(instance)
    const encodedPhone = encodeURIComponent(phone)
    const connectAttempts: Array<{ base: string; url: string; method: 'GET' | 'POST'; body?: Record<string, string> }> =
      evolutionBases.flatMap((b) => ([
        { base: b, url: `${b}/instance/connect/${encodedInstance}?number=${encodedPhone}`, method: 'GET' as const },
        { base: b, url: `${b}/v1/instance/connect/${encodedInstance}?number=${encodedPhone}`, method: 'GET' as const },
        { base: b, url: `${b}/v2/instance/connect/${encodedInstance}?number=${encodedPhone}`, method: 'GET' as const },
        { base: b, url: `${b}/instance/connect/${encodedInstance}`, method: 'POST' as const, body: { number: phone } },
        { base: b, url: `${b}/v1/instance/connect/${encodedInstance}`, method: 'POST' as const, body: { number: phone } },
        { base: b, url: `${b}/v2/instance/connect/${encodedInstance}`, method: 'POST' as const, body: { number: phone } },
      ]))

    let pairingCode: string | null = null
    let connectError = ''
    let qrOnlyModeDetected = false

    for (const attempt of connectAttempts) {
      try {
        const res = await fetchWithTimeout(attempt.url, {
          method: attempt.method,
          headers,
          ...(attempt.body ? { body: JSON.stringify(attempt.body) } : {}),
        })
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as unknown
          pairingCode = extractPairingCode(data)
          if (pairingCode) {
            discoveredBaseUrl = attempt.base
            break
          }
          if (hasQrPayload(data)) {
            qrOnlyModeDetected = true
            connectError =
              'Este ambiente da Evolution não suporta conexão sem QR Code. Ajuste a configuração/versão da Evolution para retornar pairing code por número.'
            break
          }
          connectError = `${attempt.method} ${attempt.url}: Evolution não retornou um pairing code válido.`
        } else {
          const errText = await res.text()
          let errJson: { message?: string; error?: string } | null = null
          try {
            errJson = JSON.parse(errText) as { message?: string; error?: string }
          } catch {
            /* ignora */
          }
          connectError = `${attempt.method} ${attempt.url}: ${errJson?.message ?? errJson?.error ?? errText.slice(0, 180)}`
        }
      } catch (e) {
        connectError = `${attempt.method} ${attempt.url}: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    const workingBaseUrl = (discoveredBaseUrl ?? configuredBaseUrl).replace(/\/$/, '')

    if (!pairingCode) {
      const createContext =
        createOk
          ? ''
          : `Create instance não confirmado (${createLastError || 'sem detalhe'}). `
      await supabaseAdmin.from('agent_channel_whatsapp').upsert(
        {
          agent_id: agentId,
          provider: 'evolution',
          status: 'error',
          evolution_base_url: workingBaseUrl,
          evolution_instance: instance,
          evolution_api_key_encrypted: resolvedApiKey,
          webhook_url: webhookUrl,
          last_error: `${createContext}${connectError || 'Evolution não retornou pairing code'}`.trim(),
        },
        { onConflict: 'agent_id' }
      )
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
        {
          error:
            `${createContext}${connectError}`.trim() ||
            'Não foi possível obter o código de pareamento. Verifique o número e tente novamente.',
        },
        { status: 502 }
      )
    }

    // 4) Salvar status no DB
    await supabaseAdmin.from('agent_channel_whatsapp').upsert(
      {
        agent_id: agentId,
        provider: 'evolution',
        status: 'connecting',
        evolution_base_url: workingBaseUrl,
        evolution_instance: instance,
        evolution_api_key_encrypted: resolvedApiKey,
        webhook_url: webhookUrl,
        phone_number: phone,
        last_error: null,
      },
      { onConflict: 'agent_id' }
    )

    return NextResponse.json({
      pairingCode,
      instance_key: instance,
      status: 'connecting',
      message:
        'Use este código no WhatsApp: Configurações → Aparelhos conectados → Vincular dispositivo → Vincular com código.',
    })
  } catch (error: unknown) {
    console.error('[whatsapp/connect/start]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

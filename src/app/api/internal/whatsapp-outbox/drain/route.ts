import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildEvolutionBaseCandidates, resolveEvolutionApiKey, sanitizeEvolutionBaseUrl } from '@/lib/whatsapp/evolution'

const DRAIN_BATCH_SIZE = 20
const SEND_TIMEOUT_MS = 10000

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.WHATSAPP_OUTBOX_SECRET?.trim()
  if (!secret) return false

  const bearer = req.headers.get('authorization')
  if (bearer === `Bearer ${secret}`) return true

  const header = req.headers.get('x-outbox-secret')
  return header === secret
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = SEND_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    return NextResponse.json({ error: 'Configuracao do servidor incompleta' }, { status: 500 })
  }

  const supabaseAdmin = createClient(url, serviceRoleKey)
  const { data: rows, error } = await supabaseAdmin
    .from('whatsapp_outbox')
    .select('id, tenant_id, agent_id, provider, target_phone, content, attempts')
    .in('status', ['pending', 'failed'])
    .lt('attempts', 5)
    .order('created_at', { ascending: true })
    .limit(DRAIN_BATCH_SIZE)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const items = Array.isArray(rows) ? rows : []
  if (items.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0 })
  }

  let sent = 0
  let failed = 0

  for (const item of items) {
    await supabaseAdmin
      .from('whatsapp_outbox')
      .update({ status: 'processing', attempts: (item.attempts ?? 0) + 1, last_error: null })
      .eq('id', item.id)

    const { data: channelRow, error: channelError } = await supabaseAdmin
      .from('agent_channel_whatsapp')
      .select('evolution_base_url, evolution_instance, evolution_api_key_encrypted')
      .eq('agent_id', item.agent_id)
      .eq('provider', 'evolution')
      .maybeSingle()

    const baseUrl = sanitizeEvolutionBaseUrl(String(channelRow?.evolution_base_url || '')).value
    const instance = typeof channelRow?.evolution_instance === 'string' ? channelRow.evolution_instance : null
    const apiKey = resolveEvolutionApiKey({
      storedValue: channelRow?.evolution_api_key_encrypted as string | null,
      envValue:
        process.env.EVOLUTION_AUTO_API_KEY?.trim() ||
        process.env.EVOLUTION_API_KEY?.trim() ||
        null,
    })

    if (channelError || !baseUrl || !instance || !apiKey) {
      failed += 1
      await supabaseAdmin
        .from('whatsapp_outbox')
        .update({
          status: 'failed',
          last_error: channelError?.message || 'Canal Evolution invalido para envio do outbox',
        })
        .eq('id', item.id)
      continue
    }

    const sendUrls = buildEvolutionBaseCandidates(baseUrl).map((base) => `${base}/message/sendText/${instance}`)
    let lastError = ''
    let wasSent = false

    for (const sendUrl of sendUrls) {
      try {
        const response = await fetchWithTimeout(sendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            number: item.target_phone,
            text: item.content,
          }),
        })
        if (response.ok) {
          wasSent = true
          break
        }
        lastError = `${response.status} ${await response.text()}`
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }

    if (wasSent) {
      sent += 1
      await supabaseAdmin
        .from('whatsapp_outbox')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', item.id)
      continue
    }

    failed += 1
    await supabaseAdmin
      .from('whatsapp_outbox')
      .update({
        status: 'failed',
        last_error: lastError || 'Falha desconhecida ao enviar item do outbox',
      })
      .eq('id', item.id)
  }

  return NextResponse.json({
    processed: items.length,
    sent,
    failed,
  })
}

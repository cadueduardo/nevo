import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveActorByPhone } from '@/lib/actor'
import { buildSimulatorContextFromBusinessConfig } from '@/lib/simulator/context'
import {
  buildEvolutionBaseCandidates,
  isValidEvolutionWebhookToken,
  resolveEvolutionApiKey,
  sanitizeEvolutionBaseUrl,
} from '@/lib/whatsapp/evolution'
import { maskPhone, maskUrl, previewText, summarizeError } from '@/lib/security/log-sanitizer'

const WEBHOOK_UPSTREAM_TIMEOUT_MS = 15000
const MAX_OUTBOUND_NOTIFICATIONS = 3

function computeTypingDelay(replyTexts: string[]): number {
  const joined = replyTexts.join('\n\n').trim()
  const chars = joined.length
  const estimated = Math.round(chars * 22)
  return Math.max(2200, Math.min(4200, estimated))
}

function isTypingSimulationEnabled(): boolean {
  return process.env.EVOLUTION_ENABLE_TYPING_SIMULATION === 'true'
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = WEBHOOK_UPSTREAM_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function toLoggedWhatsappFrom(from: string): string {
  return from.startsWith('whatsapp:') ? from : `whatsapp:${from}`
}

function normalizeEvolutionNumber(phone: string): string {
  return phone
    .replace(/^whatsapp:/, '')
    .replace(/@s\.whatsapp\.net$/, '')
    .replace(/\D+/g, '')
}

/**
 * POST /api/webhooks/evolution/[agentId]
 * Webhook chamado pela Evolution API quando chega uma mensagem (evento MESSAGES_UPSERT).
 * Body: application/json (estrutura Evolution API).
 * Responde via Evolution API (sendText) e retorna 200.
 *
 * Configure na Evolution API a URL deste webhook para o evento MESSAGES_UPSERT.
 * Ex.: https://seu-dominio.com/api/webhooks/evolution/{agentId}
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const agentId = (await params).agentId
  if (!agentId) {
    return NextResponse.json({ error: 'agentId obrigatório' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    console.error('[webhooks/evolution] SUPABASE_URL ou SERVICE_ROLE_KEY ausentes')
    return new NextResponse('Configuração do servidor incompleta', { status: 500 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Body JSON inválido', { status: 400 })
  }

  const { from, text, pushName, messageId } = extractMessageFromEvolutionPayload(body)
  if (!from || !text || !text.trim()) {
    return new NextResponse(null, { status: 200 })
  }

  const supabaseAdmin = createClient(url, serviceRoleKey)

  const { data: agent, error: agentError } = await supabaseAdmin
    .from('agent')
    .select('id, name, tenant_id')
    .eq('id', agentId)
    .single()

  if (agentError || !agent) {
    console.error('[webhooks/evolution] Agente não encontrado:', agentId, agentError?.message)
    return new NextResponse('Agente não encontrado', { status: 404 })
  }

  if (messageId) {
    const { error: receiptError } = await supabaseAdmin.from('whatsapp_webhook_receipt').insert({
      tenant_id: agent.tenant_id,
      agent_id: agentId,
      provider: 'evolution',
      external_message_id: messageId,
      payload_preview: previewText(text, 120),
    })
    if (receiptError) {
      const duplicateReceipt =
        receiptError.code === '23505' ||
        /duplicate key|unique constraint/i.test(receiptError.message || '')
      if (duplicateReceipt) {
        console.warn('[webhooks/evolution] duplicate inbound event ignored:', {
          agentId,
          messageId,
          from: maskPhone(toLoggedWhatsappFrom(from)),
        })
        return new NextResponse(null, { status: 200 })
      }
      console.error('[webhooks/evolution] erro ao registrar receipt:', receiptError.message)
      return new NextResponse('Erro ao registrar webhook', { status: 503 })
    }
  }
  const { data: channelRow, error: channelError } = await supabaseAdmin
    .from('agent_channel_whatsapp')
    .select(
      'evolution_base_url, evolution_instance, evolution_api_key_encrypted, webhook_secret'
    )
    .eq('agent_id', agentId)
    .eq('provider', 'evolution')
    .maybeSingle()

  if (
    channelError ||
    !channelRow?.evolution_base_url ||
    !channelRow?.evolution_instance ||
    (!channelRow?.evolution_api_key_encrypted &&
      !process.env.EVOLUTION_AUTO_API_KEY?.trim() &&
      !process.env.EVOLUTION_API_KEY?.trim())
  ) {
    console.error('[webhooks/evolution] Canal Evolution não configurado para o agente:', agentId)
    return new NextResponse('Canal WhatsApp (Evolution) não configurado', { status: 500 })
  }

  const receivedToken = req.nextUrl.searchParams.get('token')
  if (!isValidEvolutionWebhookToken(channelRow.webhook_secret as string | null, receivedToken)) {
    return new NextResponse('Webhook token inválido', { status: 401 })
  }

  const { data: setting, error: settingError } = await supabaseAdmin
    .from('agent_setting')
    .select('tone, handoff_mode, when_client_asks_price_no_value, business_config')
    .eq('agent_id', agentId)
    .single()

  if (settingError || !setting) {
    console.error('[webhooks/evolution] agent_setting não encontrado:', settingError?.message)
    return new NextResponse('Configuração do agente não encontrada', { status: 500 })
  }

  const bc = (setting.business_config as Record<string, unknown>) ?? {}
  const businessNameFromConfig = (bc.business_name as string)?.trim()
  const context = buildSimulatorContextFromBusinessConfig({
    businessName: businessNameFromConfig || (agent.name ?? '') || '',
    businessConfig: {
      ...bc,
      when_client_asks_price_no_value:
        setting.when_client_asks_price_no_value ?? 'offer_handoff_or_booking',
    },
    tone: setting.tone ?? undefined,
  })

  const fromNormalized = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`

  const featureAssistenteOrcamento = process.env.FEATURE_ASSISTENTE_ORCAMENTO === 'true'
  let mode: 'internal' | 'external' | undefined
  let actor_type: string | undefined
  if (featureAssistenteOrcamento) {
    const resolved = await resolveActorByPhone(supabaseAdmin, agent.tenant_id, fromNormalized)
    mode = resolved.mode
    actor_type = resolved.actor_type
  }

  const turnPayload = {
    session_id: fromNormalized,
    message: text.trim(),
    context,
    tenant_id: agent.tenant_id,
    agent_id: agentId,
    channel: 'whatsapp' as const,
    from: fromNormalized,
    sender_display_name: pushName?.trim() || undefined,
    ...(mode != null && { mode }),
    ...(actor_type != null && { actor_type }),
  }

  const baseUrl = sanitizeEvolutionBaseUrl(channelRow.evolution_base_url as string).value
  const instance = channelRow.evolution_instance as string
  const apiKey = resolveEvolutionApiKey({
    storedValue: channelRow.evolution_api_key_encrypted as string,
    envValue:
      process.env.EVOLUTION_AUTO_API_KEY?.trim() ||
      process.env.EVOLUTION_API_KEY?.trim() ||
      null,
  })
  if (!baseUrl || !apiKey) {
    return new NextResponse('Configuração Evolution inválida', { status: 400 })
  }
  const numberForEvolution = from.replace(/^whatsapp:/, '').replace(/@s\.whatsapp\.net$/, '')
  const baseCandidates = buildEvolutionBaseCandidates(baseUrl)

  // Indicador de digitação (3 pontinhos) enquanto processa
  // Evolution API: POST /chat/sendPresence/{instance} | doc: https://doc.evolution-api.com/v2/api-reference/chat-controller/send-presence
  const presenceNumber = numberForEvolution
  const typingStartedAt = Date.now()
  if (isTypingSimulationEnabled()) {
    const initialPresenceDelay = 4200
    for (const presenceUrl of baseCandidates.map((b) => `${b}/chat/sendPresence/${instance}`)) {
      try {
        const presenceRes = await fetchWithTimeout(
          presenceUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: apiKey,
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              number: presenceNumber,
              presence: 'composing',
              delay: initialPresenceDelay,
            }),
          },
          6000
        )
        if (presenceRes.ok) break
        const errText = await presenceRes.text()
        console.warn('[webhooks/evolution] sendPresence falhou:', {
          status: presenceRes.status,
          url: maskUrl(presenceUrl),
          response: previewText(errText, 120),
        })
      } catch (e) {
        console.warn('[webhooks/evolution] sendPresence erro:', {
          url: maskUrl(presenceUrl),
          error: summarizeError(e),
        })
      }
    }
  }

  const functionsUrl = `${url}/functions/v1/conversations-turn`
  let turnResponse: Response
  try {
    console.log('[webhooks/evolution] chamando conversations-turn:', {
      agentId,
      from: maskPhone(fromNormalized),
      session_id: maskPhone(fromNormalized),
      functionsUrl: maskUrl(functionsUrl),
    })
    turnResponse = await fetchWithTimeout(functionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      body: JSON.stringify(turnPayload),
    })
  } catch (e) {
    console.error('[webhooks/evolution] Erro ao chamar conversations-turn:', summarizeError(e))
    return new NextResponse('Erro ao processar mensagem', { status: 503 })
  }

  let replyTexts: string[] = ['Desculpe, tive um problema ao processar. Pode repetir?']
  let outboundNotifications: Array<{ phone: string; content: string }> = []
  if (turnResponse.ok) {
    try {
      const data = (await turnResponse.json()) as {
        messages?: Array<{ content?: string; action_options?: string[]; service_multi_select?: boolean }>
        outbound_notifications?: Array<{ phone?: string; content?: string }>
      }
      const list = Array.isArray(data.messages) ? data.messages : []
      const normalized = list
        .map((msg) => {
          const content = typeof msg?.content === 'string' ? msg.content : ''
          if (!content.trim()) return null
          const opts = msg.action_options
          let final = content
          if (Array.isArray(opts) && opts.length > 0) {
            const hasNumbering = opts.some((opt) => /^\d+\s*-\s+/.test(opt))
            const isMulti = Boolean(msg.service_multi_select)
            const optsLabel = isMulti
              ? '\n\n_Opções múltiplas (responda com números separados por vírgula, ex.: 1,2):_\n'
              : opts.length === 1
                ? '\n\n_Opção:_\n'
                : hasNumbering
                  ? '\n\n_Opções (responda com número ou texto):_\n'
                  : '\n\n_Opções (responda com texto):_\n'
            const optsText = opts.join('\n')
            const withOpts = content + optsLabel + optsText
            if (withOpts.length <= 4096) final = withOpts
          }
          return final
        })
        .filter((v): v is string => Boolean(v))
      if (normalized.length > 0) replyTexts = normalized
      outboundNotifications = Array.isArray(data.outbound_notifications)
        ? data.outbound_notifications
            .filter((n) => typeof n?.phone === 'string' && typeof n?.content === 'string')
            .map((n) => ({ phone: String(n.phone || '').trim(), content: String(n.content || '').trim() }))
            .filter((n) => n.phone.length > 0 && n.content.length > 0)
        : []
      console.log('[webhooks/evolution] conversations-turn OK:', {
        agentId,
        replyCount: replyTexts.length,
        outboundCount: outboundNotifications.length,
      })
    } catch {
      console.warn('[webhooks/evolution] conversations-turn OK, mas JSON de resposta nao pode ser interpretado')
    }
  } else {
    const errorText = await turnResponse.text()
    console.error('[webhooks/evolution] conversations-turn non-ok:', {
      status: turnResponse.status,
      response: previewText(errorText, 160),
    })
  }

  if (isTypingSimulationEnabled()) {
    const desiredTypingDelay = computeTypingDelay(replyTexts)
    const elapsedSinceTyping = Date.now() - typingStartedAt
    if (elapsedSinceTyping < desiredTypingDelay) {
      await new Promise((resolve) => setTimeout(resolve, desiredTypingDelay - elapsedSinceTyping))
    }
  }

  const evolutionSendUrls = baseCandidates.map((b) => `${b}/message/sendText/${instance}`)
  for (const replyText of replyTexts) {
    let sent = false
    let sendError = ''
    for (const evolutionSendUrl of evolutionSendUrls) {
      try {
        const evoRes = await fetchWithTimeout(
          evolutionSendUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: apiKey,
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              number: numberForEvolution,
              text: replyText,
            }),
          },
          10000
        )
        if (evoRes.ok) {
          console.log('[webhooks/evolution] sendText OK:', {
            evolutionSendUrl: maskUrl(evolutionSendUrl),
            number: maskPhone(numberForEvolution),
            chars: replyText.length,
          })
          sent = true
          break
        }
        const errText = await evoRes.text()
        sendError = `${evoRes.status} ${evolutionSendUrl} ${errText}`
      } catch (e) {
        sendError = `${evolutionSendUrl} ${e instanceof Error ? e.message : String(e)}`
      }
    }
    if (!sent) {
      console.error('[webhooks/evolution] Erro ao enviar via Evolution:', previewText(sendError, 160))
      return new NextResponse('Erro ao enviar resposta', { status: 502 })
    }
  }

  const sentKeys = new Set<string>()
  const queuedNotifications: Array<{ phone: string; content: string }> = []
  let outboundSentCount = 0
  for (const notification of outboundNotifications) {
    if (outboundSentCount >= MAX_OUTBOUND_NOTIFICATIONS) {
      console.warn('[webhooks/evolution] outbound notifications limit reached', {
        agentId,
        limit: MAX_OUTBOUND_NOTIFICATIONS,
      })
      break
    }
    const targetNumber = normalizeEvolutionNumber(notification.phone)
    const content = notification.content.trim()
    if (!targetNumber || !content) continue
    if (targetNumber === normalizeEvolutionNumber(numberForEvolution)) continue
    const dedupeKey = `${targetNumber}::${content}`
    if (sentKeys.has(dedupeKey)) continue
    sentKeys.add(dedupeKey)
    queuedNotifications.push({ phone: targetNumber, content })
    outboundSentCount += 1
  }

  if (queuedNotifications.length > 0) {
    const { error: outboxError } = await supabaseAdmin.from('whatsapp_outbox').insert(
      queuedNotifications.map((notification) => ({
        tenant_id: agent.tenant_id,
        agent_id: agentId,
        provider: 'evolution',
        target_phone: notification.phone,
        content: notification.content,
      }))
    )
    if (outboxError) {
      console.error('[webhooks/evolution] erro ao enfileirar outbound:', outboxError.message)
    } else {
      console.log('[webhooks/evolution] outbound notifications queued:', {
        agentId,
        count: queuedNotifications.length,
      })
    }
  }

  return new NextResponse(null, { status: 200 })
}

/**
 * Extrai remetente, texto e nome de exibição do payload Evolution API (MESSAGES_UPSERT).
 * Suporta estruturas com data.key.remoteJid, data.message.conversation, pushName, etc.
 */
function extractMessageFromEvolutionPayload(body: unknown): {
  from: string | null
  text: string | null
  pushName: string | null
  messageId: string | null
} {
  if (!body || typeof body !== 'object') return { from: null, text: null, pushName: null, messageId: null }

  const obj = body as Record<string, unknown>
  const data = obj.data as Record<string, unknown> | undefined

  const extractPushName = (o: Record<string, unknown>): string | null => {
    const p = o.pushName ?? o.notifyName
    return typeof p === 'string' && p.trim() ? p.trim() : null
  }

  if (!data) {
    const key = obj.key as Record<string, unknown> | undefined
    const msg = obj.message as Record<string, unknown> | undefined
    if (key && msg) {
      return {
        from: extractRemoteJid(key),
        text: extractText(msg),
        pushName: extractPushName(obj),
        messageId: extractMessageId(key),
      }
    }
    return { from: null, text: null, pushName: null, messageId: null }
  }

  const key = data.key as Record<string, unknown> | undefined
  const fromMe = key?.fromMe
  if (fromMe === true) return { from: null, text: null, pushName: null, messageId: null }

  const message = data.message as Record<string, unknown> | undefined
  const messages = data.messages as Array<Record<string, unknown>> | undefined
  const firstMsg = Array.isArray(messages) && messages.length > 0
    ? messages[0]
    : message
  if (!firstMsg && !message) return { from: null, text: null, pushName: null, messageId: null }
  const firstKey = (firstMsg as Record<string, unknown>)?.key as Record<string, unknown> | undefined
  const keyToUse = firstKey ?? key
  const msgToUse = (firstMsg as Record<string, unknown>)?.message ?? firstMsg ?? message

  return {
    from: extractRemoteJid(keyToUse ?? data),
    text: extractText((msgToUse as Record<string, unknown>) ?? message),
    pushName: extractPushName(data) ?? extractPushName(obj),
    messageId: extractMessageId(keyToUse ?? data),
  }
}

function extractMessageId(key: Record<string, unknown>): string | null {
  const id = key.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function extractRemoteJid(key: Record<string, unknown>): string | null {
  const remoteJid = key.remoteJid
  if (typeof remoteJid !== 'string') return null
  if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@broadcast')) return null
  if (remoteJid.endsWith('@g.us')) return null
  const num = remoteJid.replace(/@s\.whatsapp\.net$/, '').replace(/@g\.us$/, '')
  if (!num) return null
  return num.includes('@') ? remoteJid : `whatsapp:${num}`
}

function extractText(msg: Record<string, unknown>): string | null {
  if (typeof msg.conversation === 'string') return msg.conversation
  const extended = msg.extendedTextMessage as Record<string, unknown> | undefined
  if (extended && typeof extended.text === 'string') return extended.text
  return null
}




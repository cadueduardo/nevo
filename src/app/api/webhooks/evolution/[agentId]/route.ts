import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveActorByPhone } from '@/lib/actor'

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

  const { from, text, pushName } = extractMessageFromEvolutionPayload(body)
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

  const { data: channelRow, error: channelError } = await supabaseAdmin
    .from('agent_channel_whatsapp')
    .select(
      'evolution_base_url, evolution_instance, evolution_api_key_encrypted'
    )
    .eq('agent_id', agentId)
    .eq('provider', 'evolution')
    .maybeSingle()

  if (
    channelError ||
    !channelRow?.evolution_base_url ||
    !channelRow?.evolution_instance ||
    !channelRow?.evolution_api_key_encrypted
  ) {
    console.error('[webhooks/evolution] Canal Evolution não configurado para o agente:', agentId)
    return new NextResponse('Canal WhatsApp (Evolution) não configurado', { status: 500 })
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
  const bookingServices = Array.isArray(bc.booking_services)
    ? bc.booking_services
    : Array.isArray(bc.services)
      ? bc.services
      : []
  const catalogServices = Array.isArray(bc.catalog_services)
    ? bc.catalog_services
    : bookingServices
  const context = {
    business_name: businessNameFromConfig || (agent.name ?? '') || '',
    business_type: bc.business_type ?? undefined,
    context_mode: bc.context_mode ?? 'booking',
    establishment_address: bc.establishment_address ?? undefined,
    tone: setting.tone ?? undefined,
    catalog_services: catalogServices,
    booking_services: bookingServices,
    services: bookingServices,
    when_client_asks_price_no_value: setting.when_client_asks_price_no_value ?? 'offer_handoff_or_booking',
    schedule: bc.schedule ?? undefined,
    staff: Array.isArray(bc.staff) ? bc.staff : [],
    dynamic_variables: Array.isArray(bc.dynamic_variables) ? bc.dynamic_variables : [],
    lead_policy: {
      reject_unlisted_services: true,
      use_ai_matching: true,
      ...(typeof bc.lead_policy === 'object' && bc.lead_policy !== null
        ? (bc.lead_policy as Record<string, unknown>)
        : {}),
    },
    holidays_attend: Array.isArray(bc.holidays_attend) ? bc.holidays_attend : [],
    closure_periods: Array.isArray(bc.closure_periods) ? bc.closure_periods : [],
    allow_sequence_booking: Boolean(bc.allow_sequence_booking),
    sequence_eligible_services: Array.isArray(bc.sequence_eligible_services) ? bc.sequence_eligible_services : [],
    target_audience:
      typeof bc.target_audience === 'object' && bc.target_audience !== null
        ? bc.target_audience
        : undefined,
    interaction_style:
      bc.interaction_style === 'numbered_options' ||
      bc.interaction_style === 'conversational' ||
      bc.interaction_style === 'hybrid'
        ? bc.interaction_style
        : 'hybrid',
    branding:
      typeof bc.branding === 'object' && bc.branding !== null ? bc.branding : undefined,
  }

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

  const baseUrl = (channelRow.evolution_base_url as string).replace(/\/$/, '')
  const instance = channelRow.evolution_instance as string
  const apiKey = channelRow.evolution_api_key_encrypted as string
  const numberForEvolution = from.replace(/^whatsapp:/, '').replace(/@s\.whatsapp\.net$/, '')
  const baseCandidates = baseUrl.endsWith('/api')
    ? [baseUrl, baseUrl.replace(/\/api$/, '')]
    : [baseUrl, `${baseUrl}/api`]

  // Indicador de digitação (3 pontinhos) enquanto processa
  // Evolution API: POST /chat/sendPresence/{instance} | doc: https://doc.evolution-api.com/v2/api-reference/chat-controller/send-presence
  const presenceNumber = numberForEvolution
  for (const presenceUrl of baseCandidates.map((b) => `${b}/chat/sendPresence/${instance}`)) {
    try {
      const presenceRes = await fetch(presenceUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          number: presenceNumber,
          options: {
            presence: 'composing',
            delay: 15000,
            number: presenceNumber,
          },
        }),
      })
      if (presenceRes.ok) break
      const errText = await presenceRes.text()
      console.warn('[webhooks/evolution] sendPresence falhou:', presenceRes.status, presenceUrl, errText)
    } catch (e) {
      console.warn('[webhooks/evolution] sendPresence erro:', presenceUrl, e)
    }
  }

  const functionsUrl = `${url}/functions/v1/conversations-turn`
  let turnResponse: Response
  try {
    turnResponse = await fetch(functionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      body: JSON.stringify(turnPayload),
    })
  } catch (e) {
    console.error('[webhooks/evolution] Erro ao chamar conversations-turn:', e)
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
    } catch {
      // keep default replyTexts
    }
  } else {
    console.error('[webhooks/evolution] conversations-turn não OK:', turnResponse.status, await turnResponse.text())
  }

  const evolutionSendUrls = baseCandidates.map((b) => `${b}/message/sendText/${instance}`)
  for (const replyText of replyTexts) {
    let sent = false
    let sendError = ''
    for (const evolutionSendUrl of evolutionSendUrls) {
      try {
        const evoRes = await fetch(evolutionSendUrl, {
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
        })
        if (evoRes.ok) {
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
      console.error('[webhooks/evolution] Erro ao enviar via Evolution:', sendError)
      return new NextResponse('Erro ao enviar resposta', { status: 502 })
    }
  }

  const normalizeEvolutionNumber = (phone: string): string =>
    phone
      .replace(/^whatsapp:/, '')
      .replace(/@s\.whatsapp\.net$/, '')
      .replace(/\D+/g, '')
  const sentKeys = new Set<string>()
  for (const notification of outboundNotifications) {
    const targetNumber = normalizeEvolutionNumber(notification.phone)
    const content = notification.content.trim()
    if (!targetNumber || !content) continue
    const dedupeKey = `${targetNumber}::${content}`
    if (sentKeys.has(dedupeKey)) continue
    sentKeys.add(dedupeKey)

    let sent = false
    let sendError = ''
    for (const evolutionSendUrl of evolutionSendUrls) {
      try {
        const evoRes = await fetch(evolutionSendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            number: targetNumber,
            text: content,
          }),
        })
        if (evoRes.ok) {
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
      console.error('[webhooks/evolution] Erro ao enviar notificacao outbound:', sendError)
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
} {
  if (!body || typeof body !== 'object') return { from: null, text: null, pushName: null }

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
      }
    }
    return { from: null, text: null, pushName: null }
  }

  const key = data.key as Record<string, unknown> | undefined
  const fromMe = key?.fromMe
  if (fromMe === true) return { from: null, text: null, pushName: null }

  const message = data.message as Record<string, unknown> | undefined
  const messages = data.messages as Array<Record<string, unknown>> | undefined
  const firstMsg = Array.isArray(messages) && messages.length > 0
    ? messages[0]
    : message
  if (!firstMsg && !message) return { from: null, text: null, pushName: null }
  const firstKey = (firstMsg as Record<string, unknown>)?.key as Record<string, unknown> | undefined
  const keyToUse = firstKey ?? key
  const msgToUse = (firstMsg as Record<string, unknown>)?.message ?? firstMsg ?? message

  return {
    from: extractRemoteJid(keyToUse ?? data),
    text: extractText((msgToUse as Record<string, unknown>) ?? message),
    pushName: extractPushName(data) ?? extractPushName(obj),
  }
}

function extractRemoteJid(key: Record<string, unknown>): string | null {
  const remoteJid = key.remoteJid
  if (typeof remoteJid !== 'string') return null
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

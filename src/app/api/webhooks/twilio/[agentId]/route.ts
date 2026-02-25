import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveActorByPhone } from '@/lib/actor'

/**
 * POST /api/webhooks/twilio/[agentId]
 * Webhook chamado pela Twilio quando chega uma mensagem WhatsApp no sandbox/número.
 * Body: application/x-www-form-urlencoded (From, To, Body, MessageSid, ...).
 * Responde à mensagem via API Twilio e retorna 200.
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
    console.error('[webhooks/twilio] SUPABASE_URL ou SERVICE_ROLE_KEY ausentes')
    return new NextResponse('Configuração do servidor incompleta', { status: 500 })
  }

  let formData: Record<string, string>
  try {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text()
      formData = Object.fromEntries(new URLSearchParams(text)) as Record<string, string>
    } else {
      return new NextResponse('Content-Type deve ser application/x-www-form-urlencoded', { status: 400 })
    }
  } catch {
    return new NextResponse('Body inválido', { status: 400 })
  }

  const from = (formData.From ?? '').trim() // número do remetente (ex: whatsapp:+5511999999999)
  const to = (formData.To ?? '').trim() // nosso número Twilio
  const bodyText = (formData.Body ?? formData.body ?? '').trim()
  if (!from || !bodyText) {
    return new NextResponse('From e Body obrigatórios', { status: 400 })
  }

  const supabaseAdmin = createClient(url, serviceRoleKey)

  const { data: agent, error: agentError } = await supabaseAdmin
    .from('agent')
    .select('id, name, tenant_id')
    .eq('id', agentId)
    .single()

  if (agentError || !agent) {
    console.error('[webhooks/twilio] Agente não encontrado:', agentId, agentError?.message)
    return new NextResponse('Agente não encontrado', { status: 404 })
  }

  const { data: setting, error: settingError } = await supabaseAdmin
    .from('agent_setting')
    .select('tone, handoff_mode, when_client_asks_price_no_value, business_config')
    .eq('agent_id', agentId)
    .single()

  if (settingError || !setting) {
    console.error('[webhooks/twilio] agent_setting não encontrado:', settingError?.message)
    return new NextResponse('Configuração do agente não encontrada', { status: 500 })
  }

  const { data: channelRow, error: channelError } = await supabaseAdmin
    .from('agent_channel_whatsapp')
    .select('twilio_account_sid_encrypted, twilio_auth_token_encrypted')
    .eq('agent_id', agentId)
    .maybeSingle()

  if (channelError || !channelRow?.twilio_account_sid_encrypted || !channelRow?.twilio_auth_token_encrypted) {
    console.error('[webhooks/twilio] Credenciais Twilio não configuradas para o agente')
    return new NextResponse('Canal WhatsApp não configurado', { status: 500 })
  }

  const bc = (setting.business_config as Record<string, unknown>) ?? {}
  const businessNameFromConfig = (bc.business_name as string)?.trim()
  const context = {
    business_name: businessNameFromConfig || (agent.name ?? '') || '',
    business_type: bc.business_type ?? undefined,
    context_mode: bc.context_mode ?? 'booking',
    establishment_address: bc.establishment_address ?? undefined,
    tone: setting.tone ?? undefined,
    services: Array.isArray(bc.services) ? bc.services : [],
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
  }

  const featureAssistenteOrcamento = process.env.FEATURE_ASSISTENTE_ORCAMENTO === 'true'

  let mode: 'internal' | 'external' | undefined
  let actor_type: string | undefined
  if (featureAssistenteOrcamento) {
    const resolved = await resolveActorByPhone(supabaseAdmin, agent.tenant_id, from)
    mode = resolved.mode
    actor_type = resolved.actor_type
  }

  const turnPayload = {
    session_id: from,
    message: bodyText,
    context,
    tenant_id: agent.tenant_id,
    agent_id: agentId,
    channel: 'whatsapp' as const,
    from,
    ...(mode != null && { mode }),
    ...(actor_type != null && { actor_type }),
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
    console.error('[webhooks/twilio] Erro ao chamar conversations-turn:', e)
    return new NextResponse('Erro ao processar mensagem', { status: 503 })
  }

  let replyText = 'Desculpe, tive um problema ao processar. Pode repetir?'
  if (turnResponse.ok) {
    try {
      const data = (await turnResponse.json()) as {
        messages?: Array<{ content?: string; action_options?: string[] }>
      }
      const lastMsg = Array.isArray(data.messages) ? data.messages[data.messages.length - 1] : null
      if (lastMsg?.content) {
        replyText = lastMsg.content
        // Incluir opções como lista no texto (usuário pode responder com o texto da opção)
        const opts = lastMsg.action_options
        if (Array.isArray(opts) && opts.length > 0) {
          const hasNumbering = opts.some((opt) => /^\d+\s*-\s+/.test(opt))
          const optsLabel = opts.length === 1
            ? '\n\n_Opção:_\n'
            : hasNumbering
              ? '\n\n_Opções (responda com número ou texto):_\n'
              : '\n\n_Opções (responda com texto):_\n'
          const optsText = opts.join('\n')
          const withOpts = replyText + optsLabel + optsText
          if (withOpts.length <= 4096) replyText = withOpts
        }
      }
    } catch {
      // keep default replyText
    }
  } else {
    console.error('[webhooks/twilio] conversations-turn não OK:', turnResponse.status, await turnResponse.text())
  }

  const accountSid = channelRow.twilio_account_sid_encrypted
  const authToken = channelRow.twilio_auth_token_encrypted
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const twilioBody = new URLSearchParams({
    To: from,
    From: to,
    Body: replyText,
  })

  try {
    const twilioRes = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      body: twilioBody.toString(),
    })
    if (!twilioRes.ok) {
      const errText = await twilioRes.text()
      console.error('[webhooks/twilio] Twilio API error:', twilioRes.status, errText)
      return new NextResponse('Erro ao enviar resposta', { status: 502 })
    }
  } catch (e) {
    console.error('[webhooks/twilio] Erro ao enviar via Twilio:', e)
    return new NextResponse('Erro ao enviar resposta', { status: 502 })
  }

  return new NextResponse(null, { status: 200 })
}

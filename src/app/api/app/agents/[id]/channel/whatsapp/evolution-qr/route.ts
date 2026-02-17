import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'

/**
 * GET /api/app/agents/[id]/channel/whatsapp/evolution-qr
 * Busca o QR Code da instância Evolution para exibir no Nevo.
 * Requer canal Evolution configurado (base_url, instance, api_key).
 */
export async function GET(
  _req: NextRequest,
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
  const { data: agent } = await supabase
    .from('agent')
    .select('id')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .single()

  if (!agent) {
    return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
  }

  const { data: channel } = await supabase
    .from('agent_channel_whatsapp')
    .select('evolution_base_url, evolution_instance, evolution_api_key_encrypted')
    .eq('agent_id', agentId)
    .eq('provider', 'evolution')
    .maybeSingle()

  if (
    !channel?.evolution_base_url ||
    !channel?.evolution_instance ||
    !channel?.evolution_api_key_encrypted
  ) {
    return NextResponse.json(
      { error: 'Canal Evolution não configurado. Salve URL, instância e API Key primeiro.' },
      { status: 400 }
    )
  }

  const baseUrl = (channel.evolution_base_url as string).replace(/\/$/, '')
  const instance = channel.evolution_instance as string
  const apiKey = channel.evolution_api_key_encrypted as string

  // Evolution API: GET /instance/connect/{instance}
  // v1/v2 usam o mesmo path. Fallback para /v1/ e /v2/ se a raiz falhar.
  const pathsToTry = [
    `${baseUrl}/instance/connect/${encodeURIComponent(instance)}`,
    `${baseUrl}/v1/instance/connect/${encodeURIComponent(instance)}`,
    `${baseUrl}/v2/instance/connect/${encodeURIComponent(instance)}`,
  ]

  const isDev = process.env.NODE_ENV === 'development'
  const debug: Record<string, unknown> = {}

  let res: Response | null = null
  let lastError = ''
  let lastUrlTried = ''

  // Evolution API pode aceitar: apikey (AUTHENTICATION_API_KEY) ou Authorization Bearer (token global/instância)
  const headers: Record<string, string> = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
  }

  for (const connectUrl of pathsToTry) {
    try {
      res = await fetch(connectUrl, {
        method: 'GET',
        headers,
      })
      if (res.ok) break
      const errText = await res.text()
      lastError = errText
      let errJson: { message?: string; error?: string } | null = null
      try {
        errJson = JSON.parse(errText) as { message?: string; error?: string }
      } catch {
        /* ignora parse */
      }
      const msg =
        errJson?.message ?? errJson?.error ?? (errText.length > 200 ? errText.slice(0, 200) + '…' : errText)
      console.error('[evolution-qr] Evolution API error:', res.status, connectUrl, msg)
      if (isDev) {
        debug.urlTried = connectUrl
        debug.evolutionStatus = res.status
        debug.evolutionBodyPreview = errText.slice(0, 200)
      }
      if (res.status === 401) {
        return NextResponse.json(
          { error: 'API Key inválida. Verifique a chave configurada na Evolution.', _debug: isDev ? debug : undefined },
          { status: 502 }
        )
      }
      if (res.status === 404) {
        return NextResponse.json(
          {
            error:
              'Instância não encontrada na Evolution. Crie a instância no Manager (http://URL/manager) ou via API antes de conectar.',
            _debug: isDev ? debug : undefined,
          },
          { status: 502 }
        )
      }
      if (res.status >= 500) {
        return NextResponse.json(
          {
            error: `Evolution API erro interno (${res.status}). Tente novamente ou verifique os logs da Evolution.`,
            _debug: isDev ? debug : undefined,
          },
          { status: 502 }
        )
      }
      return NextResponse.json(
        {
          error: `Evolution API: ${res.status}. ${msg || 'Verifique URL, instância e API Key.'}`,
          _debug: isDev ? debug : undefined,
        },
        { status: 502 }
      )
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      console.error('[evolution-qr] Fetch error:', connectUrl, errMsg)
      lastError = errMsg
      lastUrlTried = connectUrl
      if (isDev) {
        debug.urlTried = connectUrl
        debug.fetchError = errMsg
      }
      if (fetchErr instanceof TypeError && errMsg.includes('fetch')) {
        return NextResponse.json(
          {
            error:
              'Não foi possível conectar à Evolution API. Verifique se está rodando e se a URL base está correta (ex: http://localhost:8080).',
            _debug: isDev ? debug : undefined,
          },
          { status: 503 }
        )
      }
    }
  }

  if (!res || !res.ok) {
    if (isDev) debug.lastUrlTried = lastUrlTried
    return NextResponse.json(
      {
        error:
          lastError || 'Evolution API não respondeu. Verifique URL, instância, API Key e se a Evolution está rodando.',
        _debug: isDev ? debug : undefined,
      },
      { status: 502 }
    )
  }

  try {

    let data = (await res.json()) as { code?: string; base64?: string; pairingCode?: string; count?: number }

    let base64: string | null = null

    const extractBase64 = async (d: typeof data): Promise<void> => {
      if (typeof d.base64 === 'string' && d.base64.length > 0) {
        base64 = d.base64.startsWith('data:') ? d.base64 : `data:image/png;base64,${d.base64}`
      } else if (typeof d.code === 'string' && d.code.length > 0) {
        const code = d.code
        if (code.startsWith('data:image') || code.length > 200) {
          base64 = code
        } else {
          const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(code)}`
          const qrRes = await fetch(qrImageUrl)
          if (qrRes.ok) {
            const buf = await qrRes.arrayBuffer()
            base64 = `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
          }
        }
      }
    }

    await extractBase64(data)

    // Evolution v2 às vezes retorna {"count":0} sem QR. Tentar RESTART e reconectar.
    let restartAttempted = false
    let restartStatus: number | null = null
    if (!base64 && (data.count === 0 || (!data.code && !data.base64))) {
      const restartUrls = [
        `${baseUrl}/instance/restart/${encodeURIComponent(instance)}`,
        `${baseUrl}/v1/instance/restart/${encodeURIComponent(instance)}`,
        `${baseUrl}/v2/instance/restart/${encodeURIComponent(instance)}`,
        `${baseUrl}/instances/restart/${encodeURIComponent(instance)}`,
      ]
      for (const restartUrl of restartUrls) {
        try {
          const restartRes = await fetch(restartUrl, { method: 'PUT', headers })
          restartAttempted = true
          restartStatus = restartRes.status
          if (restartRes.ok) {
            await new Promise((r) => setTimeout(r, 5000))
            const connectUrl = `${baseUrl}/instance/connect/${encodeURIComponent(instance)}`
            const retryRes = await fetch(connectUrl, { method: 'GET', headers })
            if (retryRes.ok) {
              data = (await retryRes.json()) as typeof data
              await extractBase64(data)
              if (base64) break
            }
          }
        } catch {
          /* ignora */
        }
      }
    }

    if (!base64) {
      const debugPayload: Record<string, unknown> = { evolutionResponse: data }
      if (isDev && restartAttempted) {
        debugPayload.restartAttempted = true
        debugPayload.restartStatus = restartStatus
      }
      const isRestart404 = restartStatus === 404
      const errorMsg = isRestart404
        ? 'Evolution retorna count:0 e RESTART retorna 404. Use evoapicloud/evolution-api:latest no docker-compose.evolution.yaml, recrie os containers e exclua/recrie a instância no Manager.'
        : 'Evolution não retornou QR Code. Tente: 1) RESTART no Manager; 2) Excluir e criar a instância de novo (Baileys); 3) Usar evoapicloud/evolution-api:latest; 4) Se persistir, configurar proxy (PROXY_HOST/ etc) no docker-compose.'
      return NextResponse.json(
        {
          error: errorMsg,
          _debug: isDev ? debugPayload : undefined,
        },
        { status: 502 }
      )
    }

    return NextResponse.json({ qrcode: base64, pairingCode: data.pairingCode ?? null })
  } catch (e) {
    console.error('[evolution-qr] Erro ao buscar QR:', e)
    return NextResponse.json(
      { error: 'Não foi possível conectar à Evolution API. Verifique a URL base.' },
      { status: 503 }
    )
  }
}

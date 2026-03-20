import { NextRequest, NextResponse } from 'next/server'
import { consumeRateLimit, getRequestRateLimitKey } from '@/lib/security/rate-limit'
import { previewText, summarizeError } from '@/lib/security/log-sanitizer'

export async function POST(req: NextRequest) {
  try {
    const rateLimit = consumeRateLimit({
      key: getRequestRateLimitKey(req, 'public-conversations-turn'),
      limit: 30,
      windowMs: 60_000,
    })
    if (!rateLimit.ok) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde antes de enviar outra mensagem.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        }
      )
    }

    const body = await req.json()

    if (body?.channel === 'web_simulator' && body?.context) {
      const preview = (
        Array.isArray(body.context.business_profile?.services)
          ? body.context.business_profile.services
          : Array.isArray(body.context.booking_services)
            ? body.context.booking_services
            : Array.isArray(body.context.services)
              ? body.context.services
              : []
      )
        .slice(0, 5)
        .map((service: any) => ({ name: service?.name, base_price: service?.base_price, duration_minutes: service?.duration_minutes }))
      console.log('[conversations-turn] simulator context preview:', previewText(JSON.stringify(preview), 120))
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Configuracao do Supabase nao encontrada')
      return NextResponse.json({ error: 'Configuracao do Supabase nao encontrada' }, { status: 500 })
    }

    const controller = new AbortController()
    const timeoutMs = 55000
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/conversations-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      let data: any
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const text = await response.text()
        return NextResponse.json({ error: text || 'Resposta invalida' }, { status: 500 })
      }

      if (!response.ok) {
        const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || 'Erro ao processar mensagem'
        console.error('[conversations-turn] Edge Function erro:', {
          status: response.status,
          error: errMsg,
          details: previewText(JSON.stringify(data), 120),
        })
        return NextResponse.json({ error: errMsg }, { status: response.status })
      }

      return NextResponse.json(data)
    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      if (fetchError.name === 'AbortError') {
        return NextResponse.json({ error: 'Tempo de espera esgotado. Tente novamente.' }, { status: 504 })
      }
      console.error('[conversations-turn] Fetch error:', summarizeError(fetchError))
      return NextResponse.json({ error: `Erro ao conectar com o servidor: ${fetchError.message}` }, { status: 503 })
    }
  } catch (error: any) {
    console.error('[conversations-turn] Error:', summarizeError(error))
    return NextResponse.json(
      { error: error?.message || error?.toString?.() || 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

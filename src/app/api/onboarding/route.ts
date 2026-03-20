import { NextRequest, NextResponse } from 'next/server'
import { consumeRateLimit, getRequestRateLimitKey } from '@/lib/security/rate-limit'
import { previewText, summarizeError } from '@/lib/security/log-sanitizer'

export async function POST(req: NextRequest) {
  try {
    const rateLimit = consumeRateLimit({
      key: getRequestRateLimitKey(req, 'public-onboarding'),
      limit: 20,
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
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Configuração do Supabase não encontrada')
      return NextResponse.json(
        { error: 'Configuração do Supabase não encontrada' },
        { status: 500 }
      )
    }

    console.log('Fazendo requisição para Edge Function:', `${supabaseUrl}/functions/v1/onboarding-chat`, {
      current_step: body?.current_step ?? null,
      message_preview:
        typeof body?.message === 'string' ? previewText(body.message, 80) : null,
    })

    // Fazer proxy para a Edge Function com timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 75000) // 75 segundos de timeout

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/onboarding-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      console.log('Resposta da Edge Function:', response.status, response.statusText)

      // Tentar fazer parse do JSON, mas tratar erros
      let data: any
      const contentType = response.headers.get('content-type')
      
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await response.json()
        } catch (parseError) {
          console.error('Erro ao fazer parse do JSON:', summarizeError(parseError))
          const text = await response.text()
          console.error('Resposta como texto:', previewText(text, 120))
          return NextResponse.json(
            { error: 'Resposta inválida da Edge Function' },
            { status: 500 }
          )
        }
      } else {
        const text = await response.text()
        console.error('Resposta não é JSON:', text)
        return NextResponse.json(
          { error: 'Resposta inválida da Edge Function' },
          { status: 500 }
        )
      }

      if (!response.ok) {
        console.error('Erro na resposta:', previewText(JSON.stringify(data), 160))
        return NextResponse.json(
          { error: data.error || 'Erro ao processar mensagem' },
          { status: response.status }
        )
      }

      return NextResponse.json(data)
    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      
      if (fetchError.name === 'AbortError') {
        console.error('Timeout na requisição para Edge Function')
        return NextResponse.json(
          { error: 'Tempo de espera esgotado. Tente novamente.' },
          { status: 504 }
        )
      }

      console.error('Erro ao fazer requisição para Edge Function:', summarizeError(fetchError))
      return NextResponse.json(
        { error: `Erro ao conectar com o servidor: ${fetchError.message}` },
        { status: 503 }
      )
    }
  } catch (error: any) {
    console.error('Error in onboarding API route:', summarizeError(error))
    return NextResponse.json(
      { error: error.message || 'Erro interno do servidor' },
      { status: 500 }
    )
  }
}

// Handle OPTIONS for CORS
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


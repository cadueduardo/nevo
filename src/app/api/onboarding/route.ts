import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Configuração do Supabase não encontrada' },
        { status: 500 }
      )
    }

    // Fazer proxy para a Edge Function
    const response = await fetch(`${supabaseUrl}/functions/v1/onboarding-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || 'Erro ao processar mensagem' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Error in onboarding API route:', error)
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

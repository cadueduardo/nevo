import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getAppBootstrap,
  getAppBootstrapByAgent,
  type AppBootstrapByAgentResult,
} from '@/lib/app/bootstrap'

/**
 * POST /api/app/simulator
 * Body: { message: string, conversation_id?: string, agent_id?: string }
 * Quando agent_id presente, monta context a partir de agent_setting; senão usa tenant (compat).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
    }
    const { message, conversation_id, agent_id: bodyAgentId } = body as {
      message?: unknown
      conversation_id?: unknown
      agent_id?: string
    }
    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'message é obrigatório' }, { status: 400 })
    }

    let agentId = typeof bodyAgentId === 'string' ? bodyAgentId.trim() || undefined : undefined
    let bootstrap = agentId
      ? await getAppBootstrapByAgent(agentId)
      : await getAppBootstrap()
    if (!bootstrap) {
      return NextResponse.json(
        { error: agentId ? 'Agente não encontrado' : 'Tenant não encontrado' },
        { status: 404 }
      )
    }

    const tenant = bootstrap.tenant
    // Garantir agent_id para conversation/channel (NOT NULL no banco). Se não veio no body, usar agente do bootstrap ou primeiro do tenant.
    const bootstrapWithAgent = 'agent' in bootstrap ? (bootstrap as AppBootstrapByAgentResult) : null
    let effectiveAgentId = agentId ?? bootstrapWithAgent?.agent?.id
    if (!effectiveAgentId) {
      const { data: firstAgent } = await supabase
        .from('agent')
        .select('id')
        .eq('tenant_id', tenant.id)
        .limit(1)
        .maybeSingle()
      effectiveAgentId = firstAgent?.id ?? undefined
    }
    if (!effectiveAgentId) {
      return NextResponse.json(
        { error: 'Nenhum agente disponível para o simulador. Crie ou selecione um agente.' },
        { status: 400 }
      )
    }
    const tenant_setting = 'agent_setting' in bootstrap ? bootstrap.agent_setting : bootstrap.tenant_setting
    const businessName = 'agent' in bootstrap ? bootstrap.agent.name : tenant.name
    const bc = tenant_setting.business_config as Record<string, unknown>
    const context = {
      business_name: businessName,
      business_type: bc.business_type ?? undefined,
      context_mode: bc.context_mode ?? 'booking',
      establishment_address: bc.establishment_address ?? undefined,
      tone: tenant_setting.tone ?? undefined,
      services: Array.isArray(bc.services) ? bc.services : [],
      when_client_asks_price_no_value: tenant_setting.when_client_asks_price_no_value ?? 'offer_handoff_or_booking',
      schedule: bc.schedule ?? undefined,
      staff: Array.isArray(bc.staff) ? bc.staff : [],
      dynamic_variables: Array.isArray(bc.dynamic_variables) ? bc.dynamic_variables : [],
      holidays_attend: Array.isArray(bc.holidays_attend) ? bc.holidays_attend : [],
      closure_periods: Array.isArray(bc.closure_periods) ? bc.closure_periods : [],
      allow_sequence_booking: Boolean(bc.allow_sequence_booking),
      sequence_eligible_services: Array.isArray(bc.sequence_eligible_services) ? bc.sequence_eligible_services : [],
    }

    const sessionId = `app-${user.id}-${tenant.id}`
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      const missing = [
        !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
        !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
      ].filter(Boolean) as string[]
      console.error('[api/app/simulator] Variáveis de ambiente ausentes:', missing.join(', '))
      return NextResponse.json(
        {
          error: `Configuração do servidor incompleta: defina ${missing.join(' e ')} em .env.local (na raiz do projeto) e reinicie o servidor (npm run dev).`,
        },
        { status: 500 }
      )
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/conversations-turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: message.trim(),
          conversation_id: conversation_id ?? undefined,
          context,
          tenant_id: tenant.id,
          agent_id: effectiveAgentId,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const contentType = response.headers.get('content-type')
      const data = contentType?.includes('application/json')
        ? await response.json()
        : { error: await response.text() }

      if (!response.ok) {
        return NextResponse.json(
          { error: data.error || 'Erro ao processar mensagem' },
          { status: response.status }
        )
      }
      return NextResponse.json(data)
    } catch (e: unknown) {
      clearTimeout(timeoutId)
      if (e instanceof Error && e.name === 'AbortError') {
        return NextResponse.json({ error: 'Tempo de espera esgotado.' }, { status: 504 })
      }
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Erro ao conectar' },
        { status: 503 }
      )
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getAppBootstrap, getAppBootstrapByAgent } from '@/lib/app/bootstrap'

/**
 * GET /api/app/bootstrap
 * Query: agent_id (opcional). Quando presente, retorna dados do agente (tenant + agent + agent_setting + flow).
 * Sem agent_id: retorna tenant + tenant_setting + flow (compatibilidade).
 */
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agent_id')?.trim() || undefined
  if (agentId) {
    const data = await getAppBootstrapByAgent(agentId)
    if (!data) {
      return NextResponse.json(
        { error: 'Não autenticado, sem tenant ou agente inválido' },
        { status: agentId ? 404 : 401 }
      )
    }
    return NextResponse.json(data)
  }
  const data = await getAppBootstrap()
  if (!data) {
    return NextResponse.json({ error: 'Não autenticado ou sem tenant' }, { status: 401 })
  }
  return NextResponse.json(data)
}

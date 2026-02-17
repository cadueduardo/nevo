import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'

/**
 * GET /api/app/appointments
 * Lista agendamentos do tenant: query from/to (YYYY-MM-DD) ou padrão hoje até +30 dias.
 * Retorno: array de Appointment.
 */
export async function GET(req: NextRequest) {
  try {
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

    const { searchParams } = new URL(req.url)
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    const agentId = searchParams.get('agent_id')?.trim() || undefined

    let start: Date
    let end: Date
    if (fromParam && toParam) {
      start = new Date(fromParam)
      end = new Date(toParam)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return NextResponse.json({ error: 'from/to inválidos (use YYYY-MM-DD)' }, { status: 400 })
      }
      start.setHours(0, 0, 0, 0)
      end.setHours(23, 59, 59, 999)
    } else {
      start = new Date()
      start.setHours(0, 0, 0, 0)
      end = new Date(start)
      end.setDate(end.getDate() + 30)
      end.setHours(23, 59, 59, 999)
    }

    let query = supabase
      .from('appointment')
      .select('id, attendee_name, staff_name, service_names, start_at, end_at, status, created_at')
      .gte('start_at', start.toISOString())
      .lte('start_at', end.toISOString())
      .order('start_at', { ascending: true })
      .limit(50)
    if (agentId) {
      const { data: agentRow } = await supabase
        .from('agent')
        .select('id')
        .eq('id', agentId)
        .eq('tenant_id', tenantId)
        .single()
      if (!agentRow) {
        return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
      }
      query = query.eq('agent_id', agentId)
    } else {
      query = query.eq('tenant_id', tenantId)
    }
    const { data: rows, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(rows ?? [])
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

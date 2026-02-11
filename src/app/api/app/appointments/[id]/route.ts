import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/app/appointments/[id]
 * Atualiza status do agendamento (ex.: cancelar = status cancelled).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const { data: tenantUser, error: tuError } = await supabase
      .from('tenant_user')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (tuError || !tenantUser?.tenant_id) {
      return NextResponse.json({ error: 'Tenant não encontrado' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const { status } = body as { status?: string }
    if (status !== 'cancelled' && status !== 'rescheduled' && status !== 'confirmed') {
      return NextResponse.json({ error: 'status inválido' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('appointment')
      .update({ status })
      .eq('id', id)
      .eq('tenant_id', tenantUser.tenant_id)
      .select('id, status')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: error.code === 'PGRST116' ? 404 : 500 })
    }
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

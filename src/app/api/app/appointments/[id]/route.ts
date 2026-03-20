import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'
import { z } from 'zod'

const appointmentStatusPatchSchema = z.object({
  status: z.enum(['cancelled', 'rescheduled', 'confirmed']),
})

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
    const tenantId = await resolvePrimaryTenantId(supabase, user.id)
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant n?o encontrado' }, { status: 404 })
    }

    const rawBody = await req.json().catch(() => null)
    const parsedBody = appointmentStatusPatchSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'status invalido' }, { status: 400 })
    }
    const { status } = parsedBody.data

    const { data, error } = await supabase
      .from('appointment')
      .update({ status })
      .eq('id', id)
      .eq('tenant_id', tenantId)
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


import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'
import { z } from 'zod'

const settingsPatchSchema = z.object({
  business_config: z.record(z.unknown()).optional(),
  tone: z.enum(['friendly', 'formal', 'professional']).optional(),
  handoff_mode: z.enum(['always', 'conditional', 'never']).optional(),
  agent_id: z.string().trim().min(1).optional(),
})

/**
 * PATCH /api/app/settings
 * Atualização parcial de business_config e tenant_setting (tone, handoff_mode).
 * Requer sessão e role owner/admin no tenant.
 */
export async function PATCH(req: NextRequest) {
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
    const rawBody = await req.json().catch(() => null)
    const parsedBody = settingsPatchSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
    }

    const {
      business_config: incomingBusinessConfig,
      tone,
      handoff_mode,
      agent_id: bodyAgentId,
    } = parsedBody.data
    const agentId = bodyAgentId || undefined

    const updates: Record<string, unknown> = {}

    if (tone !== undefined) updates.tone = tone
    if (handoff_mode !== undefined) updates.handoff_mode = handoff_mode

    if (incomingBusinessConfig !== undefined) {
      if (typeof incomingBusinessConfig !== 'object' || incomingBusinessConfig === null) {
        return NextResponse.json({ error: 'business_config deve ser um objeto' }, { status: 400 })
      }
      let currentConfig: Record<string, unknown> = {}
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
        const { data: cur } = await supabase
          .from('agent_setting')
          .select('business_config')
          .eq('agent_id', agentId)
          .single()
        currentConfig = (cur?.business_config as Record<string, unknown>) ?? {}
      } else {
        const { data: cur } = await supabase
          .from('tenant_setting')
          .select('business_config')
          .eq('tenant_id', tenantId)
          .single()
        currentConfig = (cur?.business_config as Record<string, unknown>) ?? {}
      }
      const merged = deepMergePreserveCritical(currentConfig, incomingBusinessConfig)
      updates.business_config = merged
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo válido para atualizar' }, { status: 400 })
    }

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
      const { data: updated, error: updateError } = await supabase
        .from('agent_setting')
        .update(updates)
        .eq('agent_id', agentId)
        .select('tone, handoff_mode, when_client_asks_price_no_value, business_config')
        .single()
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
      return NextResponse.json(updated)
    }

    const { data: updated, error: updateError } = await supabase
      .from('tenant_setting')
      .update(updates)
      .eq('tenant_id', tenantId)
      .select('tone, handoff_mode, when_client_asks_price_no_value, business_config')
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

/**
 * Faz merge do partial no existing sem apagar campos críticos não enviados.
 * Apenas chaves presentes em partial são atualizadas; o resto permanece.
 */
function deepMergePreserveCritical(
  existing: Record<string, unknown>,
  partial: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...existing }
  for (const key of Object.keys(partial)) {
    const partialVal = partial[key]
    const existingVal = result[key]
    if (partialVal !== null && typeof partialVal === 'object' && !Array.isArray(partialVal)) {
      result[key] = deepMergePreserveCritical(
        (existingVal as Record<string, unknown>) ?? {},
        partialVal as Record<string, unknown>
      )
    } else {
      result[key] = partialVal
    }
  }
  return result
}


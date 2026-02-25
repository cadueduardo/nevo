/**
 * Resolução de actor (owner/admin/agent/client/unknown) por telefone.
 * Usado pelo webhook WhatsApp para definir mode (internal/external) sem comando textual.
 * Feature: assistente-pessoal-orcamento.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ActorType = 'owner' | 'admin' | 'agent' | 'client' | 'unknown'
export type ActorMode = 'internal' | 'external'

export interface ResolvedActor {
  actor_type: ActorType
  mode: ActorMode
}

/**
 * Normaliza número de telefone para comparação e persistência.
 * Formato final: só dígitos com DDI (ex.: 5511999999999).
 * Remove prefixo whatsapp:, +, espaços, hífens, parênteses.
 */
export function normalizePhoneNumber(input: string): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/^whatsapp:/i, '')
    .replace(/^wa:/i, '')
    .replace(/[\s\-+()]/g, '')
    .replace(/\D/g, '')
}

/**
 * Resolve actor e mode por tenant_id e número do remetente.
 * - tenant_user.phone_number (normalizado) + role → owner/admin/agent; owner/admin → internal.
 * - Se não achar tenant_user: verifica contact (phone/external_id) → client; senão → unknown.
 * - Sempre external para agent/client/unknown (MVP: agent fica external por segurança).
 */
export async function resolveActorByPhone(
  supabase: SupabaseClient,
  tenantId: string,
  fromNumber: string
): Promise<ResolvedActor> {
  const normalized = normalizePhoneNumber(fromNumber)
  if (!normalized) {
    return { actor_type: 'unknown', mode: 'external' }
  }

  const { data: tenantUser, error: tuError } = await supabase
    .from('tenant_user')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('phone_number', normalized)
    .maybeSingle()

  if (!tuError && tenantUser) {
    const role = (tenantUser.role as string) || ''
    if (role === 'owner') {
      return { actor_type: 'owner', mode: 'internal' }
    }
    if (role === 'admin') {
      return { actor_type: 'admin', mode: 'internal' }
    }
    if (role === 'agent' || role === 'viewer') {
      return { actor_type: 'agent', mode: 'external' }
    }
    return { actor_type: 'agent', mode: 'external' }
  }

  const { data: contactByPhone } = await supabase
    .from('contact')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', normalized)
    .limit(1)
    .maybeSingle()

  if (contactByPhone) {
    return { actor_type: 'client', mode: 'external' }
  }

  const { data: contactByExternalId } = await supabase
    .from('contact')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('external_id', `whatsapp:${normalized}`)
    .limit(1)
    .maybeSingle()

  if (contactByExternalId) {
    return { actor_type: 'client', mode: 'external' }
  }

  return { actor_type: 'unknown', mode: 'external' }
}

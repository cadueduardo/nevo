import type { SupabaseClient } from '@supabase/supabase-js'

type TenantLink = { tenant_id: string; created_at?: string | null }
type TenantAgent = { tenant_id: string; updated_at?: string | null }

/**
 * Resolve de forma deterministica o tenant "principal" do usuario.
 * Prioriza tenant com mais agentes; empate por agente mais recente.
 */
export async function resolvePrimaryTenantId(
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<string | null> {
  const { data: tenantLinks, error } = await supabase
    .from('tenant_user')
    .select('tenant_id, created_at')
    .eq('user_id', userId)

  if (error || !tenantLinks?.length) return null

  const links = tenantLinks as TenantLink[]
  const tenantIds = Array.from(new Set(links.map((l) => l.tenant_id).filter(Boolean)))
  if (tenantIds.length === 0) return null
  if (tenantIds.length === 1) return tenantIds[0]

  const { data: tenantAgents } = await supabase
    .from('agent')
    .select('tenant_id, updated_at')
    .in('tenant_id', tenantIds)

  const agents = (tenantAgents || []) as TenantAgent[]
  const scoreByTenant = new Map<string, { count: number; latest: number; linkCreated: number }>()

  for (const tenantId of tenantIds) {
    const linkCreated = links
      .filter((l) => l.tenant_id === tenantId)
      .map((l) => (l.created_at ? Date.parse(l.created_at) : 0))
      .reduce((max, ts) => (ts > max ? ts : max), 0)
    scoreByTenant.set(tenantId, { count: 0, latest: 0, linkCreated })
  }

  for (const a of agents) {
    const item = scoreByTenant.get(a.tenant_id)
    if (!item) continue
    item.count += 1
    const ts = a.updated_at ? Date.parse(a.updated_at) : 0
    if (ts > item.latest) item.latest = ts
  }

  tenantIds.sort((a, b) => {
    const sa = scoreByTenant.get(a)!
    const sb = scoreByTenant.get(b)!
    if (sb.count !== sa.count) return sb.count - sa.count
    if (sb.latest !== sa.latest) return sb.latest - sa.latest
    return sb.linkCreated - sa.linkCreated
  })

  return tenantIds[0] || null
}

import { createClient } from '@/lib/supabase/server'
import { resolvePrimaryTenantId } from '@/lib/app/tenant'

export interface AppBootstrapSetting {
  tone: string | null
  handoff_mode: string | null
  when_client_asks_price_no_value: string | null
  business_config: Record<string, unknown>
}

export interface AppBootstrapResult {
  tenant: { id: string; name: string; slug: string }
  tenant_setting: AppBootstrapSetting
  flow: {
    id: string
    name: string
    domain: string | null
    version: number | null
    definition: unknown
    layout: unknown
    is_active: boolean
  } | null
}

export interface AppBootstrapByAgentResult {
  tenant: { id: string; name: string; slug: string }
  agent: { id: string; name: string; business_type: string | null; status: string }
  agent_setting: AppBootstrapSetting
  /** Para compatibilidade com consumidores que leem tenant_setting. */
  tenant_setting: AppBootstrapSetting
  flow: {
    id: string
    name: string
    domain: string | null
    version: number | null
    definition: unknown
    layout: unknown
    is_active: boolean
  } | null
}

/**
 * Resolve tenant via tenant_user (JWT) e retorna tenant, tenant_setting e flow.
 * Retorna null se usuário não autenticado ou sem tenant.
 */
export async function getAppBootstrap(): Promise<AppBootstrapResult | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const tenantId = await resolvePrimaryTenantId(supabase, user.id)
  if (!tenantId) return null

  const [tenantResult, settingResult, flowResult] = await Promise.all([
    supabase.from('tenant').select('id, name, slug').eq('id', tenantId).single(),
    supabase
      .from('tenant_setting')
      .select('tone, handoff_mode, when_client_asks_price_no_value, business_config')
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('flow')
      .select('id, name, domain, version, definition, layout, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  if (tenantResult.error || !tenantResult.data) return null
  if (settingResult.error || !settingResult.data) return null

  return {
    tenant: tenantResult.data as AppBootstrapResult['tenant'],
    tenant_setting: {
      tone: settingResult.data.tone ?? null,
      handoff_mode: settingResult.data.handoff_mode ?? null,
      when_client_asks_price_no_value: settingResult.data.when_client_asks_price_no_value ?? null,
      business_config: (settingResult.data.business_config as Record<string, unknown>) ?? {},
    },
    flow: flowResult.data
      ? (flowResult.data as AppBootstrapResult['flow'])
      : null,
  }
}

/**
 * Resolve tenant via tenant_user, valida que agent_id pertence ao tenant,
 * retorna tenant + agent + agent_setting + flow do agente.
 * Retorna null se não autenticado, sem tenant ou agent inválido.
 */
export async function getAppBootstrapByAgent(
  agentId: string
): Promise<AppBootstrapByAgentResult | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const tenantId = await resolvePrimaryTenantId(supabase, user.id)
  if (!tenantId) return null

  const { data: agent, error: agentError } = await supabase
    .from('agent')
    .select('id, name, business_type, status')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .single()

  if (agentError || !agent) return null

  const [tenantResult, settingResult, flowResult] = await Promise.all([
    supabase.from('tenant').select('id, name, slug').eq('id', tenantId).single(),
    supabase
      .from('agent_setting')
      .select('tone, handoff_mode, when_client_asks_price_no_value, business_config')
      .eq('agent_id', agentId)
      .single(),
    supabase
      .from('flow')
      .select('id, name, domain, version, definition, layout, is_active')
      .eq('agent_id', agentId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
  ])

  if (tenantResult.error || !tenantResult.data) return null
  const setting = settingResult.data ?? {
    tone: 'professional' as const,
    handoff_mode: 'conditional' as const,
    when_client_asks_price_no_value: 'offer_handoff_or_booking' as const,
    business_config: {} as Record<string, unknown>,
  }
  const agentSetting: AppBootstrapSetting = {
    tone: setting.tone ?? null,
    handoff_mode: setting.handoff_mode ?? null,
    when_client_asks_price_no_value: setting.when_client_asks_price_no_value ?? null,
    business_config: (setting.business_config as Record<string, unknown>) ?? {},
  }

  return {
    tenant: tenantResult.data as AppBootstrapByAgentResult['tenant'],
    agent: {
      id: agent.id,
      name: agent.name,
      business_type: agent.business_type ?? null,
      status: agent.status,
    },
    agent_setting: agentSetting,
    tenant_setting: agentSetting,
    flow: flowResult.data
      ? (flowResult.data as AppBootstrapByAgentResult['flow'])
      : null,
  }
}

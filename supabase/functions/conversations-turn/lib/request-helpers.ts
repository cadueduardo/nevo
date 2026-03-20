// @ts-nocheck
/** Parsing de request, normalização de serviços e carregamento de config (tenant/agent). */
import {
  mergeCanonicalServices,
  normalizeCanonicalServices,
  parseServiceNumber,
  resolveConfiguredServicesFromConfig,
} from "./canonical-services.ts"
import type { SimulatorConfig } from "./types.ts"

export type ServiceItem = {
  name: string
  duration_minutes?: number
  base_price?: number
  description?: string
}

export function parseOptionalNumber(value: unknown): number | undefined {
  return parseServiceNumber(value)
}

export function normalizeIncomingServices(raw: unknown): ServiceItem[] {
  return normalizeCanonicalServices(raw)
}

export function hasAnyConfiguredPrice(services: ServiceItem[] | undefined): boolean {
  return Boolean(services?.some((s) => typeof s.base_price === "number" && !Number.isNaN(s.base_price)))
}

export async function loadServicesFromSettings(
  supabaseAdmin: any,
  tenantId: string,
  agentId?: string
): Promise<ServiceItem[]> {
  if (agentId) {
    const { data: agentSetting } = await supabaseAdmin
      .from("agent_setting")
      .select("business_config")
      .eq("agent_id", agentId)
      .maybeSingle()
    const agentServices = resolveConfiguredServicesFromConfig((agentSetting as any)?.business_config)
    if (agentServices.length > 0) return agentServices
  }
  const { data: tenantSetting } = await supabaseAdmin
    .from("tenant_setting")
    .select("business_config")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  return resolveConfiguredServicesFromConfig((tenantSetting as any)?.business_config)
}

export async function loadServicesFromOnboardingSession(
  supabaseAdmin: any,
  sessionId?: string
): Promise<ServiceItem[]> {
  if (!sessionId) return []
  const { data: onboardingSession } = await supabaseAdmin
    .from("onboarding_sessions")
    .select("collected_data")
    .eq("session_id", sessionId)
    .maybeSingle()
  return resolveConfiguredServicesFromConfig((onboardingSession as any)?.collected_data)
}

export function mergeServicesPreferIncoming(incoming: ServiceItem[], fallback: ServiceItem[]): ServiceItem[] {
  return mergeCanonicalServices(incoming, fallback)
}

export function getEntryActionOptions(config: SimulatorConfig): string[] {
  if (config.context_mode === "quote") return ["Quero orçamento"]
  if (config.context_mode === "both") return ["Quero agendar", "Quero orçamento"]
  return ["Quero agendar"]
}

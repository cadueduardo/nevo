// @ts-nocheck
/** Parsing de request, normalização de serviços e carregamento de config (tenant/agent). */
import { normalizeText } from "./utils.ts"
import type { SimulatorConfig } from "./types.ts"

export type ServiceItem = {
  name: string
  duration_minutes?: number
  base_price?: number
  description?: string
}

export function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) return value
  if (typeof value !== "string") return undefined
  const normalized = (value as string).replace(/[^\d,.-]/g, "").replace(",", ".").trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? undefined : parsed
}

export function normalizeIncomingServices(raw: unknown): ServiceItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((svc) => {
      const item = (svc || {}) as Record<string, unknown>
      const name = String(item.name || item.service_name || "").trim()
      if (!name) return null
      const duration = parseOptionalNumber(item.duration_minutes ?? item.duration ?? item.estimated_duration_minutes)
      const price = parseOptionalNumber(item.base_price ?? item.price ?? item.value)
      const description = typeof item.description === "string" ? item.description : undefined
      return {
        name,
        ...(duration != null ? { duration_minutes: duration } : {}),
        ...(price != null ? { base_price: price } : {}),
        ...(description ? { description } : {}),
      }
    })
    .filter(Boolean) as ServiceItem[]
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
    const agentServices = normalizeIncomingServices(
      (agentSetting as any)?.business_config?.booking_services ?? (agentSetting as any)?.business_config?.services
    )
    if (agentServices.length > 0) return agentServices
  }
  const { data: tenantSetting } = await supabaseAdmin
    .from("tenant_setting")
    .select("business_config")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  return normalizeIncomingServices(
    (tenantSetting as any)?.business_config?.booking_services ?? (tenantSetting as any)?.business_config?.services
  )
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
  return normalizeIncomingServices(
    (onboardingSession as any)?.collected_data?.booking_services ?? (onboardingSession as any)?.collected_data?.services
  )
}

export function mergeServicesPreferIncoming(incoming: ServiceItem[], fallback: ServiceItem[]): ServiceItem[] {
  const byName = new Map<string, ServiceItem>()
  for (const svc of fallback) {
    const key = normalizeText(svc.name || "")
    if (!key) continue
    byName.set(key, { ...svc })
  }
  for (const svc of incoming) {
    const key = normalizeText(svc.name || "")
    if (!key) continue
    const base = byName.get(key) || { name: svc.name }
    byName.set(key, {
      ...base,
      ...svc,
      name: svc.name || base.name,
      duration_minutes: svc.duration_minutes ?? base.duration_minutes,
      base_price: svc.base_price ?? base.base_price,
      description: svc.description ?? base.description,
    })
  }
  return Array.from(byName.values()).filter((s) => Boolean((s.name || "").trim()))
}

export function getEntryActionOptions(config: SimulatorConfig): string[] {
  if (config.context_mode === "quote") return ["Quero orçamento"]
  if (config.context_mode === "both") return ["Quero agendar", "Quero orçamento"]
  return ["Quero agendar"]
}

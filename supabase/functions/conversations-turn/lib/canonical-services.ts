// @ts-nocheck
import { normalizeText } from "./utils.ts"

export type CanonicalServiceItem = {
  name: string
  duration_minutes?: number
  base_price?: number
  description?: string
  bookable?: boolean
  catalog_visible?: boolean
  sequence_eligible?: boolean
}

export function parseServiceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) return value
  if (typeof value !== "string") return undefined
  const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".").trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? undefined : parsed
}

export function normalizeCanonicalServices(raw: unknown): CanonicalServiceItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((svc) => {
      const item = (svc || {}) as Record<string, unknown>
      const name = String(item.name || item.service_name || "").trim()
      if (!name) return null
      const duration = parseServiceNumber(
        item.duration_minutes ?? item.duration ?? item.estimated_duration_minutes
      )
      const price = parseServiceNumber(item.base_price ?? item.price ?? item.value)
      const description = typeof item.description === "string" ? item.description.trim() : undefined
      return {
        name,
        ...(duration != null ? { duration_minutes: duration } : {}),
        ...(price != null ? { base_price: price } : {}),
        ...(description ? { description } : {}),
        ...(typeof item.bookable === "boolean" ? { bookable: item.bookable } : {}),
        ...(typeof item.catalog_visible === "boolean" ? { catalog_visible: item.catalog_visible } : {}),
        ...(typeof item.sequence_eligible === "boolean" ? { sequence_eligible: item.sequence_eligible } : {}),
      } as CanonicalServiceItem
    })
    .filter(Boolean) as CanonicalServiceItem[]
}

export function mergeCanonicalServices(
  primary: CanonicalServiceItem[],
  fallback: CanonicalServiceItem[]
): CanonicalServiceItem[] {
  const byName = new Map<string, CanonicalServiceItem>()

  const upsert = (svc: CanonicalServiceItem) => {
    const key = normalizeText(svc.name || "")
    if (!key) return
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

  fallback.forEach(upsert)
  primary.forEach(upsert)

  return Array.from(byName.values()).filter((s) => Boolean((s.name || "").trim()))
}

export function reconcileCanonicalServiceViews(input: {
  catalog?: unknown
  booking?: unknown
  legacy?: unknown
}) {
  const legacy = normalizeCanonicalServices(input.legacy)
  const booking = mergeCanonicalServices(normalizeCanonicalServices(input.booking), legacy)
  const catalogRaw = normalizeCanonicalServices(input.catalog)
  const catalog = catalogRaw.length > 0 ? mergeCanonicalServices(catalogRaw, booking) : booking
  const services = mergeCanonicalServices(legacy, booking)

  return {
    catalog_services: catalog,
    booking_services: booking,
    services,
  }
}

export function buildBusinessProfileFromServiceViews(input: {
  business_name?: string
  business_type?: string
  catalog?: unknown
  booking?: unknown
  legacy?: unknown
  sequenceEligible?: unknown
}) {
  const reconciled = reconcileCanonicalServiceViews(input)
  const bookableNames = new Set(reconciled.booking_services.map((service) => normalizeText(service.name)))
  const catalogNames = new Set(reconciled.catalog_services.map((service) => normalizeText(service.name)))
  const sequenceNames = new Set(
    (Array.isArray(input.sequenceEligible) ? input.sequenceEligible : [])
      .map((item) => normalizeText(String(item || "")))
      .filter(Boolean)
  )

  return {
    business_name: input.business_name,
    business_type: input.business_type,
    services: reconciled.services.map((service) => {
      const key = normalizeText(service.name)
      return {
        ...service,
        bookable: bookableNames.has(key),
        catalog_visible: catalogNames.has(key),
        sequence_eligible: sequenceNames.size > 0 ? sequenceNames.has(key) : undefined,
      }
    }),
  }
}

export function projectLegacyServiceViewsFromBusinessProfile(profile: unknown) {
  const services = normalizeCanonicalServices((profile as { services?: unknown } | null)?.services)
  return {
    services,
    booking_services: services.filter((service) => service.bookable !== false),
    catalog_services: services.filter((service) => service.catalog_visible !== false),
    sequence_eligible_services: services
      .filter((service) => service.sequence_eligible === true)
      .map((service) => service.name),
  }
}

export function resolveConfiguredServicesFromConfig(config: unknown): CanonicalServiceItem[] {
  if (!config || typeof config !== "object") return []
  const rawConfig = config as Record<string, unknown>
  const profileServices = normalizeCanonicalServices((rawConfig.business_profile as Record<string, unknown> | undefined)?.services)
  if (profileServices.length > 0) return profileServices

  return mergeCanonicalServices(
    normalizeCanonicalServices(rawConfig.booking_services),
    normalizeCanonicalServices(rawConfig.services)
  )
}


export function resolveSequenceEligibleServicesFromConfig(config: unknown): string[] {
  const services = resolveConfiguredServicesFromConfig(config)
  const explicit = services
    .filter((service) => service.sequence_eligible === true)
    .map((service) => service.name)
    .filter(Boolean)
  if (explicit.length > 0) return explicit

  if (!config || typeof config !== "object") return []
  const rawConfig = config as Record<string, unknown>
  return Array.isArray(rawConfig.sequence_eligible_services)
    ? rawConfig.sequence_eligible_services
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : []
}

type CanonicalService = {
  name: string
  description?: string
  duration_minutes?: number
  base_price?: number
  bookable?: boolean
  catalog_visible?: boolean
  sequence_eligible?: boolean
}

type BusinessConfigLike = Record<string, unknown> | null | undefined

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function normalizeBusinessProfileServices(value: unknown): CanonicalService[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const v = item as Record<string, unknown>
      if (typeof v.name !== 'string' || !v.name.trim()) return null
      return {
        name: v.name.trim(),
        description: typeof v.description === 'string' ? v.description : undefined,
        duration_minutes: parseOptionalNumber(v.duration_minutes),
        base_price: parseOptionalNumber(v.base_price),
        bookable: typeof v.bookable === 'boolean' ? v.bookable : undefined,
        catalog_visible: typeof v.catalog_visible === 'boolean' ? v.catalog_visible : undefined,
        sequence_eligible: typeof v.sequence_eligible === 'boolean' ? v.sequence_eligible : undefined,
      } as CanonicalService
    })
    .filter((item): item is CanonicalService => Boolean(item))
}

export function mergeBusinessProfileServices(primary: CanonicalService[], secondary: CanonicalService[]): CanonicalService[] {
  const merged = new Map<string, CanonicalService>()

  const upsert = (service: CanonicalService) => {
    const key = service.name.trim().toLowerCase()
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, service)
      return
    }

    merged.set(key, {
      ...previous,
      ...service,
      description: service.description ?? previous.description,
      duration_minutes: service.duration_minutes ?? previous.duration_minutes,
      base_price: service.base_price ?? previous.base_price,
      bookable: service.bookable ?? previous.bookable,
      catalog_visible: service.catalog_visible ?? previous.catalog_visible,
      sequence_eligible: service.sequence_eligible ?? previous.sequence_eligible,
    })
  }

  secondary.forEach(upsert)
  primary.forEach(upsert)

  return Array.from(merged.values())
}

export function buildCanonicalBusinessProfile(input: {
  business_name?: string
  business_type?: string
  business_profile?: { services?: unknown } | null
  services?: unknown
  booking_services?: unknown
  catalog_services?: unknown
  sequence_eligible_services?: unknown
}) {
  const profileServices = normalizeBusinessProfileServices(input.business_profile?.services)
  const legacyServices = normalizeBusinessProfileServices(input.services)
  const bookingServices = normalizeBusinessProfileServices(input.booking_services)
  const catalogServices = normalizeBusinessProfileServices(input.catalog_services)

  const mergedBooking = mergeBusinessProfileServices(bookingServices, legacyServices)
  const mergedCatalog = catalogServices.length > 0
    ? mergeBusinessProfileServices(catalogServices, mergedBooking)
    : mergedBooking
  const canonicalServices = profileServices.length > 0
    ? profileServices
    : mergeBusinessProfileServices(legacyServices, mergedBooking)

  const sequenceEligibleNames = new Set(
    (Array.isArray(input.sequence_eligible_services) ? input.sequence_eligible_services : [])
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim().toLowerCase())
  )

  const services = canonicalServices.map((service) => {
    const key = service.name.trim().toLowerCase()
    return {
      ...service,
      bookable:
        typeof service.bookable === 'boolean'
          ? service.bookable
          : mergedBooking.some((item) => item.name.trim().toLowerCase() === key),
      catalog_visible:
        typeof service.catalog_visible === 'boolean'
          ? service.catalog_visible
          : mergedCatalog.some((item) => item.name.trim().toLowerCase() === key),
      sequence_eligible:
        typeof service.sequence_eligible === 'boolean'
          ? service.sequence_eligible
          : sequenceEligibleNames.size > 0
            ? sequenceEligibleNames.has(key)
            : undefined,
    }
  })

  return {
    business_name: input.business_name,
    business_type: input.business_type,
    services,
  }
}

export function buildCanonicalBusinessProfileFromConfig(
  config: BusinessConfigLike,
  defaults?: {
    business_name?: string
    business_type?: string
  }
) {
  const value = config ?? {}
  return buildCanonicalBusinessProfile({
    business_name: (value.business_name as string | undefined) ?? defaults?.business_name,
    business_type: (value.business_type as string | undefined) ?? defaults?.business_type,
    business_profile: (value.business_profile as { services?: unknown } | null | undefined) ?? null,
    services: value.services,
    booking_services: value.booking_services,
    catalog_services: value.catalog_services,
    sequence_eligible_services: value.sequence_eligible_services,
  })
}

export function getCanonicalServiceCountFromConfig(
  config: BusinessConfigLike,
  defaults?: {
    business_name?: string
    business_type?: string
  }
) {
  return buildCanonicalBusinessProfileFromConfig(config, defaults).services.length
}

export function projectLegacyServiceViewsFromBusinessProfile(profile: { services?: unknown } | null | undefined) {
  const services = normalizeBusinessProfileServices(profile?.services)
  return {
    services,
    booking_services: services.filter((service) => service.bookable !== false),
    catalog_services: services.filter((service) => service.catalog_visible !== false),
    sequence_eligible_services: services
      .filter((service) => service.sequence_eligible === true)
      .map((service) => service.name),
  }
}

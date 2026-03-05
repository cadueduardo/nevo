type ToneValue = 'formal' | 'amigavel' | 'profissional' | 'engracado'
type InteractionStyle = 'numbered_options' | 'conversational' | 'hybrid'
type ContextMode = 'booking' | 'quote' | 'both'
type EstablishmentAddress = {
  cep?: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  localidade: string
  uf: string
}
type ServiceItem = { name: string; description?: string; duration_minutes?: number; base_price?: number }
type PriceNoValueMode = 'handoff' | 'offer_handoff_or_booking'
type StaffItem = {
  name: string
  use_business_schedule?: boolean
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
  }
}
type DynamicVariable = { key: string; label: string; type: string; context?: string }
type ClosurePeriod = { start: string; end: string; reason?: string }

function normalizeToneFromOnboarding(value: unknown): ToneValue | undefined {
  if (value === 'formal' || value === 'amigavel' || value === 'profissional' || value === 'engracado') {
    return value
  }
  if (value === 'friendly') return 'amigavel'
  if (value === 'professional') return 'profissional'
  if (value === 'funny') return 'engracado'
  return undefined
}

function normalizeInteractionStyle(value: unknown): InteractionStyle {
  if (value === 'numbered_options' || value === 'conversational' || value === 'hybrid') return value
  return 'hybrid'
}

function normalizeContextMode(value: unknown): ContextMode {
  if (value === 'booking' || value === 'quote' || value === 'both') return value
  return 'booking'
}

function ensureArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function normalizeAddress(value: unknown): EstablishmentAddress | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const required = ['logradouro', 'numero', 'bairro', 'localidade', 'uf'] as const
  if (!required.every((k) => typeof v[k] === 'string' && String(v[k]).trim().length > 0)) return undefined
  return {
    cep: typeof v.cep === 'string' ? v.cep : undefined,
    logradouro: String(v.logradouro),
    numero: String(v.numero),
    complemento: typeof v.complemento === 'string' ? v.complemento : undefined,
    bairro: String(v.bairro),
    localidade: String(v.localidade),
    uf: String(v.uf),
  }
}

function normalizeServices(value: unknown): ServiceItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const v = item as Record<string, unknown>
      if (typeof v.name !== 'string' || !v.name.trim()) return null
      return {
        name: v.name.trim(),
        description: typeof v.description === 'string' ? v.description : undefined,
        duration_minutes: typeof v.duration_minutes === 'number' ? v.duration_minutes : undefined,
        base_price: typeof v.base_price === 'number' ? v.base_price : undefined,
      } as ServiceItem
    })
    .filter((item): item is ServiceItem => Boolean(item))
}

function normalizePriceNoValueMode(value: unknown): PriceNoValueMode {
  return value === 'handoff' ? 'handoff' : 'offer_handoff_or_booking'
}

function normalizeStaff(value: unknown): StaffItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const v = item as Record<string, unknown>
      if (typeof v.name !== 'string' || !v.name.trim()) return null
      const scheduleRaw = v.schedule
      let schedule: StaffItem['schedule'] | undefined
      if (scheduleRaw && typeof scheduleRaw === 'object') {
        const s = scheduleRaw as Record<string, unknown>
        schedule = {
          days_of_week: Array.isArray(s.days_of_week) ? s.days_of_week.filter((d) => typeof d === 'string') as string[] : undefined,
          start_time: typeof s.start_time === 'string' ? s.start_time : undefined,
          end_time: typeof s.end_time === 'string' ? s.end_time : undefined,
          breaks: Array.isArray(s.breaks)
            ? s.breaks
                .map((b) => {
                  if (!b || typeof b !== 'object') return null
                  const br = b as Record<string, unknown>
                  if (typeof br.start !== 'string' || typeof br.end !== 'string') return null
                  return { start: br.start, end: br.end }
                })
                .filter((b): b is { start: string; end: string } => Boolean(b))
            : undefined,
          interval_minutes: typeof s.interval_minutes === 'number' ? s.interval_minutes : undefined,
        }
      }
      return {
        name: v.name.trim(),
        use_business_schedule: typeof v.use_business_schedule === 'boolean' ? v.use_business_schedule : undefined,
        schedule,
      } as StaffItem
    })
    .filter((item): item is StaffItem => Boolean(item))
}

function normalizeDynamicVariables(value: unknown): DynamicVariable[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const v = item as Record<string, unknown>
      if (typeof v.key !== 'string' || typeof v.label !== 'string' || typeof v.type !== 'string') return null
      return {
        key: v.key,
        label: v.label,
        type: v.type,
        context: typeof v.context === 'string' ? v.context : undefined,
      } as DynamicVariable
    })
    .filter((item): item is DynamicVariable => Boolean(item))
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function normalizeClosurePeriods(value: unknown): ClosurePeriod[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const v = item as Record<string, unknown>
      if (typeof v.start !== 'string' || typeof v.end !== 'string') return null
      return {
        start: v.start,
        end: v.end,
        reason: typeof v.reason === 'string' ? v.reason : undefined,
      } as ClosurePeriod
    })
    .filter((item): item is ClosurePeriod => Boolean(item))
}

export function buildSimulatorContextFromBusinessConfig(input: {
  businessName?: string
  businessConfig?: Record<string, unknown> | null
  tone?: unknown
}) {
  const bc = (input.businessConfig ?? {}) as Record<string, unknown>
  const bookingServices = normalizeServices(bc.booking_services).length > 0
    ? normalizeServices(bc.booking_services)
    : normalizeServices(bc.services)
  const catalogServices = normalizeServices(bc.catalog_services).length > 0
    ? normalizeServices(bc.catalog_services)
    : bookingServices

  return {
    business_name: input.businessName,
    business_type: (bc.business_type as string | undefined) ?? undefined,
    context_mode: normalizeContextMode(bc.context_mode),
    establishment_address: normalizeAddress(bc.establishment_address),
    tone: normalizeToneFromOnboarding(input.tone),
    catalog_services: catalogServices,
    booking_services: bookingServices,
    services: bookingServices,
    when_client_asks_price_no_value: normalizePriceNoValueMode(bc.when_client_asks_price_no_value),
    schedule: (bc.schedule as Record<string, unknown> | undefined) ?? undefined,
    staff: normalizeStaff(bc.staff),
    dynamic_variables: normalizeDynamicVariables(bc.dynamic_variables),
    lead_policy:
      typeof bc.lead_policy === 'object' && bc.lead_policy !== null
        ? (bc.lead_policy as Record<string, unknown>)
        : undefined,
    holidays_attend: normalizeStringArray(bc.holidays_attend),
    closure_periods: normalizeClosurePeriods(bc.closure_periods),
    allow_sequence_booking: Boolean(bc.allow_sequence_booking),
    sequence_eligible_services: normalizeStringArray(bc.sequence_eligible_services),
    target_audience:
      typeof bc.target_audience === 'object' && bc.target_audience !== null
        ? (bc.target_audience as Record<string, unknown>)
        : undefined,
    interaction_style: normalizeInteractionStyle(bc.interaction_style),
    branding:
      typeof bc.branding === 'object' && bc.branding !== null
        ? (bc.branding as Record<string, unknown>)
        : undefined,
  }
}

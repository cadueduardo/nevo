// @ts-nocheck
import type { SimulatorConfig } from "../types.ts"
import type {
  AudienceMode,
  BusinessBrain,
  BusinessBrainAudience,
  BusinessBrainPolicies,
  BusinessBrainService,
  BusinessBrainStaffMember,
  BusinessBrainStaffSchedule,
} from "./types.ts"
import { normalizeText } from "../utils.ts"

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeInteractionStyle(
  value: unknown
): "numbered_options" | "conversational" | "hybrid" {
  return value === "numbered_options" || value === "conversational" || value === "hybrid"
    ? value
    : "hybrid"
}

function normalizeAudienceModes(config: SimulatorConfig): AudienceMode[] {
  const rawModes =
    Array.isArray(config.target_audience?.modes) && config.target_audience?.modes.length
      ? config.target_audience?.modes
      : config.target_audience?.mode
        ? [config.target_audience.mode]
        : ["all"]

  const valid = rawModes.filter(
    (mode): mode is AudienceMode =>
      mode === "all" ||
      mode === "women_only" ||
      mode === "men_only" ||
      mode === "kids_only" ||
      mode === "custom"
  )

  return valid.length > 0 ? Array.from(new Set(valid)) : ["all"]
}

function normalizeSchedule(value: unknown): BusinessBrainStaffSchedule | undefined {
  if (!value || typeof value !== "object") return undefined
  const schedule = value as Record<string, unknown>
  const days =
    Array.isArray(schedule.days_of_week) && schedule.days_of_week.length > 0
      ? schedule.days_of_week.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
      : undefined

  return {
    days_of_week: days,
    start_time: normalizeString(schedule.start_time),
    end_time: normalizeString(schedule.end_time),
    breaks: Array.isArray(schedule.breaks)
      ? schedule.breaks
          .map((item) => {
            if (!item || typeof item !== "object") return null
            const breakItem = item as Record<string, unknown>
            const start = normalizeString(breakItem.start)
            const end = normalizeString(breakItem.end)
            if (!start || !end) return null
            return { start, end }
          })
          .filter(Boolean) as Array<{ start: string; end: string }>
      : undefined,
    interval_minutes:
      typeof schedule.interval_minutes === "number" ? schedule.interval_minutes : undefined,
    min_booking_lead_minutes:
      typeof schedule.min_booking_lead_minutes === "number"
        ? schedule.min_booking_lead_minutes
        : undefined,
  }
}

function normalizeServices(config: SimulatorConfig): BusinessBrainService[] {
  const raw =
    Array.isArray(config.booking_services) && config.booking_services.length > 0
      ? config.booking_services
      : Array.isArray(config.services)
        ? config.services
        : []

  const sequenceEligible = new Set(
    (Array.isArray(config.sequence_eligible_services) ? config.sequence_eligible_services : [])
      .map((item) => normalizeText(String(item || "")))
      .filter(Boolean)
  )

  return raw
    .map((service) => {
      const name = normalizeString(service?.name)
      if (!name) return null
      return {
        name,
        normalized_name: normalizeText(name),
        description: normalizeString(service?.description),
        duration_minutes:
          typeof service?.duration_minutes === "number" ? service.duration_minutes : undefined,
        base_price: typeof service?.base_price === "number" ? service.base_price : undefined,
        sequence_eligible:
          config.allow_sequence_booking === true &&
          (sequenceEligible.size === 0 || sequenceEligible.has(normalizeText(name))),
      } as BusinessBrainService
    })
    .filter(Boolean) as BusinessBrainService[]
}

function normalizeStaff(config: SimulatorConfig): BusinessBrainStaffMember[] {
  const raw = Array.isArray(config.staff) ? config.staff : []
  return raw
    .map((staff) => {
      const name = normalizeString(staff?.name)
      if (!name) return null
      return {
        name,
        normalized_name: normalizeText(name),
        use_business_schedule: staff?.use_business_schedule === true,
        schedule: normalizeSchedule(staff?.schedule),
      } as BusinessBrainStaffMember
    })
    .filter(Boolean) as BusinessBrainStaffMember[]
}

function normalizeFaq(config: SimulatorConfig): Array<{ question: string; answer: string }> {
  const raw = Array.isArray(config.faq) ? config.faq : []
  return raw
    .map((item) => {
      const question = normalizeString(item?.question)
      const answer = normalizeString(item?.answer)
      if (!question || !answer) return null
      return { question, answer }
    })
    .filter(Boolean) as Array<{ question: string; answer: string }>
}

function buildAudience(config: SimulatorConfig): BusinessBrainAudience {
  return {
    modes: normalizeAudienceModes(config),
    note: normalizeString(config.target_audience?.note),
    kids_age_min:
      typeof config.target_audience?.kids_age_min === "number"
        ? config.target_audience.kids_age_min
        : undefined,
  }
}

function buildPolicies(config: SimulatorConfig): BusinessBrainPolicies {
  return {
    reject_unlisted_services: config.lead_policy?.reject_unlisted_services === true,
    sequence_enabled: config.allow_sequence_booking === true,
    interaction_style: normalizeInteractionStyle(config.interaction_style),
  }
}

export function buildBusinessBrain(config: SimulatorConfig): BusinessBrain {
  return {
    business_name: normalizeString(config.business_name),
    business_type: normalizeString(config.business_type),
    tone: config.tone,
    address: config.establishment_address,
    faq: normalizeFaq(config),
    services: normalizeServices(config),
    staff: normalizeStaff(config),
    audience: buildAudience(config),
    policies: buildPolicies(config),
    schedule: normalizeSchedule(config.schedule),
    holidays_attend: Array.isArray(config.holidays_attend)
      ? config.holidays_attend.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined,
    closure_periods: Array.isArray(config.closure_periods)
      ? config.closure_periods
          .map((item) => {
            const start = normalizeString(item?.start)
            const end = normalizeString(item?.end)
            if (!start || !end) return null
            return {
              start,
              end,
              reason: normalizeString(item?.reason),
            }
          })
          .filter(Boolean) as Array<{ start: string; end: string; reason?: string }>
      : undefined,
    raw_config: config,
  }
}

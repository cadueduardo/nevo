// @ts-nocheck
import { buildStaffDayOptions, getScheduleForStaff } from "../staff.ts"
import {
  filterDaysExcludingClosedToday,
  getMockAvailability,
} from "../utils.ts"
import { getServicesTotalDuration } from "../services.ts"
import type { SimulatorState } from "../types.ts"
import type { BusinessBrain } from "./types.ts"

export function getSemanticDayOptions(
  brain: BusinessBrain,
  staffName?: string
): string[] {
  const schedule = getScheduleForStaff(brain.raw_config, staffName)
  const days = Array.isArray(schedule?.days_of_week) ? schedule.days_of_week : []
  return buildStaffDayOptions(filterDaysExcludingClosedToday(days, schedule))
}

export function getSemanticTimeOptions(
  brain: BusinessBrain,
  state: SimulatorState,
  input: {
    date?: string
    staff_name?: string
    service?: string
  }
): string[] {
  if (!input.date) return []
  const schedule = getScheduleForStaff(brain.raw_config, input.staff_name)
  const serviceDuration = getServicesTotalDuration(
    brain.raw_config,
    input.service || state.slots?.service
  )
  const availability = getMockAvailability(
    input.date,
    schedule,
    state.booked_slots,
    input.staff_name,
    serviceDuration ?? undefined
  )
  return availability.available.slice(0, 24)
}

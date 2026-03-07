// @ts-nocheck
import { getServicesTotalDurationOrFallback } from "../services.ts"
import { getNextAvailableSlot, getOtherStaffOptions } from "../staff.ts"
import { fromMinutes, toMinutes } from "../utils.ts"
import type { SimulatorState } from "../types.ts"
import type { BusinessBrain, SemanticCompletedBookingDraft } from "./types.ts"

export interface SemanticSequenceSuggestion {
  available: boolean
  suggested_date?: string
  suggested_time?: string
  suggested_staff_name?: string
  has_other_staff_same_day: boolean
}

export function planSequentialBooking(
  brain: BusinessBrain,
  state: SimulatorState,
  anchorBooking: SemanticCompletedBookingDraft | undefined,
  nextServiceValue: string | undefined
): SemanticSequenceSuggestion {
  if (!anchorBooking?.date || !anchorBooking?.time) {
    return {
      available: false,
      has_other_staff_same_day: false,
    }
  }

  const anchorStaff = anchorBooking.staff_name
  const hasOtherStaff = getOtherStaffOptions(brain.raw_config, anchorStaff).length > 0
  const nextDuration = getServicesTotalDurationOrFallback(brain.raw_config, nextServiceValue)
  const anchorDuration =
    anchorBooking.duration_minutes ??
    getServicesTotalDurationOrFallback(brain.raw_config, anchorBooking.service) ??
    30
  const anchorEndTime = fromMinutes(toMinutes(anchorBooking.time) + anchorDuration)
  const nextSlot = getNextAvailableSlot(
    anchorBooking.date,
    brain.raw_config,
    state.booked_slots,
    anchorStaff,
    anchorEndTime,
    nextDuration ?? undefined
  )

  if (!nextSlot) {
    return {
      available: false,
      suggested_date: anchorBooking.date,
      suggested_staff_name: anchorStaff,
      has_other_staff_same_day: hasOtherStaff,
    }
  }

  return {
    available: true,
    suggested_date: anchorBooking.date,
    suggested_time: nextSlot,
    suggested_staff_name: anchorStaff,
    has_other_staff_same_day: hasOtherStaff,
  }
}

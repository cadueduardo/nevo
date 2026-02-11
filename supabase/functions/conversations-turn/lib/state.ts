// @ts-nocheck
import { normalizeText } from "./utils.ts"
import type { SimulatorState, SimulatorResult } from "./types.ts"

export function createSimulatorState(): SimulatorState {
  return { slots: { quote_answers: {} } }
}

export function buildResult(message: string, state: SimulatorState, actionOptions?: string[]): SimulatorResult {
  return { message, state: { ...state, last_prompt: message }, action_options: actionOptions }
}

export function resetSlotsForNextBooking(state: SimulatorState): SimulatorState["slots"] {
  return {
    quote_answers: {},
    customer_name: state.slots.customer_name,
    customer_phone: state.slots.customer_phone,
    customer_email: state.slots.customer_email,
  }
}

export function addBookedSlot(
  booked: Record<string, Record<string, string[]>> | undefined,
  staffName: string | undefined,
  date?: string,
  time?: string
): Record<string, Record<string, string[]>> {
  if (!date || !time) return booked || {}
  const key = staffName ? normalizeText(staffName) : "default"
  const next = { ...(booked || {}) }
  const staffSlots = next[key] || {}
  const list = Array.isArray(staffSlots[date]) ? [...staffSlots[date]] : []
  if (!list.includes(time)) list.push(time)
  staffSlots[date] = list
  next[key] = staffSlots
  return next
}

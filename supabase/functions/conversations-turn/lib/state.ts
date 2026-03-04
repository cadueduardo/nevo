// @ts-nocheck
import { normalizeText, toMinutes, fromMinutes } from "./utils.ts"
import type { SimulatorState, SimulatorResult } from "./types.ts"

export function createSimulatorState(): SimulatorState {
  return { slots: { quote_answers: {} } }
}

export function buildResult(message: string, state: SimulatorState, actionOptions?: string[]): SimulatorResult {
  const normalizedOptions = Array.isArray(actionOptions)
    ? actionOptions.map((opt, idx) => {
        const value = String(opt || "").trim()
        if (!value) return value
        // Evita quebrar opções técnicas (ex: open_url|...)
        if (/^[a-z_]+\|/i.test(value)) return value
        // Evita duplicar numeração caso já venha "1 - ..."
        if (/^\d+\s*-\s+/.test(value)) return value
        return `${idx + 1} - ${value}`
      })
    : actionOptions
  return {
    message,
    state: {
      ...state,
      last_prompt: message,
      last_action_options: Array.isArray(normalizedOptions) && normalizedOptions.length > 0 ? normalizedOptions : undefined,
    },
    action_options: normalizedOptions,
  }
}

export function resetSlotsForNextBooking(state: SimulatorState): SimulatorState["slots"] {
  return {
    quote_answers: {},
    customer_name: state.slots.customer_name,
    customer_phone: state.slots.customer_phone,
    customer_email: state.slots.customer_email,
  }
}

/**
 * Adiciona um agendamento aos blocos ocupados.
 * Se durationMinutes e intervalMinutes forem passados, bloqueia todos os slots
 * no intervalo [time, time+duration) (ex.: 09:00 com 60 min e intervalo 30 = bloqueia 09:00 e 09:30).
 */
export function addBookedSlot(
  booked: Record<string, Record<string, string[]>> | undefined,
  staffName: string | undefined,
  date?: string,
  time?: string,
  durationMinutes?: number | null,
  intervalMinutes?: number
): Record<string, Record<string, string[]>> {
  if (!date || !time) return booked || {}
  const key = staffName ? normalizeText(staffName) : "default"
  const next = { ...(booked || {}) }
  const staffSlots = next[key] || {}
  const list = Array.isArray(staffSlots[date]) ? [...staffSlots[date]] : []
  const interval = intervalMinutes ?? 30
  if (durationMinutes != null && durationMinutes > 0 && interval > 0) {
    const startMins = toMinutes(time)
    const endMins = startMins + durationMinutes
    for (let m = startMins; m < endMins; m += interval) {
      const slot = fromMinutes(m)
      if (!list.includes(slot)) list.push(slot)
    }
  } else {
    if (!list.includes(time)) list.push(time)
  }
  staffSlots[date] = list
  next[key] = staffSlots
  return next
}

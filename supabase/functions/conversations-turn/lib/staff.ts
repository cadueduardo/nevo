// @ts-nocheck
import { normalizeText } from "./utils.ts"
import { getMockAvailability } from "./utils.ts"
import type { SimulatorConfig } from "./types.ts"

export function getStaffList(config: SimulatorConfig): Array<{ name: string; use_business_schedule?: boolean; schedule?: any }> {
  return Array.isArray(config.staff) ? config.staff.filter((s) => s?.name) : []
}

export function resolveStaffFromText(text: string, staffList: Array<{ name: string }>): string | null {
  const cleaned = text.replace(/^\s*\d+\s*-\s*/, "")
  const msg = normalizeText(cleaned)
  for (const staff of staffList) {
    const name = normalizeText(staff.name)
    if (name && (msg === name || msg.includes(name))) return staff.name
  }
  return null
}

export function isAnyStaffRequest(text: string): boolean {
  const msg = normalizeText(text)
  return /(qualquer|tanto faz|indiferente|nao importa)/.test(msg)
}

export function getScheduleForStaff(config: SimulatorConfig, staffName?: string) {
  if (!staffName) return config.schedule
  const staff = getStaffList(config).find((s) => normalizeText(s.name) === normalizeText(staffName))
  if (!staff) return config.schedule
  if (staff.use_business_schedule) return config.schedule
  return staff.schedule || config.schedule
}

export function getOtherStaffOptions(config: SimulatorConfig, staffName?: string): string[] {
  const list = getStaffList(config)
  if (list.length <= 1) return []
  const key = staffName ? normalizeText(staffName) : ""
  return list
    .filter((s) => normalizeText(s.name) !== key)
    .map((s) => s.name)
}

export function hasOtherStaffOptions(config: SimulatorConfig, staffName?: string): boolean {
  return getOtherStaffOptions(config, staffName).length > 0
}

export function buildStaffDayOptions(days: string[] = []): string[] {
  const labels: Record<string, string> = {
    monday: "Segunda",
    tuesday: "Terça",
    wednesday: "Quarta",
    thursday: "Quinta",
    friday: "Sexta",
    saturday: "Sábado",
    sunday: "Domingo",
  }
  return days.map((d) => labels[d] || d)
}

export function getNextAvailableSlot(
  dateIso: string,
  config: SimulatorConfig,
  bookedSlots: Record<string, Record<string, string[]>> | undefined,
  staffName: string | undefined,
  afterTime?: string,
  serviceDurationMinutes?: number | null
): string | null {
  const schedule = getScheduleForStaff(config, staffName)
  const availability = getMockAvailability(dateIso, schedule, bookedSlots, staffName, serviceDurationMinutes)
  if (!availability.available.length) return null
  if (!afterTime) return availability.available[0]
  const next = availability.available.find((slot) => slot > afterTime)
  return next || null
}

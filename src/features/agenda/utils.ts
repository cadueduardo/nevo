import type { Appointment } from './types'

export const START_HOUR = 8
export const END_HOUR = 20

export function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, days: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

export function startOfWeek(d: Date, weekStartsOnMonday = true) {
  const x = startOfDay(d)
  const day = x.getDay()
  const diff = weekStartsOnMonday ? (day === 0 ? -6 : 1 - day) : -day
  return addDays(x, diff)
}

export function endOfWeek(d: Date, weekStartsOnMonday = true) {
  const s = startOfWeek(d, weekStartsOnMonday)
  return addDays(s, 6)
}

export function toISODate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatWeekLabel(from: Date, to: Date) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
  return `${fmt.format(from)} – ${fmt.format(to)}`
}

export function formatDayChip(d: Date) {
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' })
    .format(d)
    .replace('.', '')
  const day = new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(d)
  return { weekday, day }
}

export function formatDateLong(d: Date) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  return fmt.format(d)
}

export function formatTime(d: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function minutesSinceStartHour(date: Date) {
  const start = new Date(date)
  start.setHours(START_HOUR, 0, 0, 0)
  return Math.max(0, Math.round((date.getTime() - start.getTime()) / 60000))
}

export function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000))
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function dayKey(d: Date) {
  return toISODate(d)
}

export function isSameISODate(a: Date, b: Date) {
  return toISODate(a) === toISODate(b)
}

export function parseISO(iso: string) {
  return new Date(iso)
}

export function groupAppointmentsByDay(items: Appointment[]) {
  const map = new Map<string, Appointment[]>()
  for (const appt of items) {
    const d = toISODate(parseISO(appt.start_at))
    const arr = map.get(d) ?? []
    arr.push(appt)
    map.set(d, arr)
  }
  for (const [, arr] of map.entries()) {
    arr.sort(
      (a, b) => parseISO(a.start_at).getTime() - parseISO(b.start_at).getTime()
    )
  }
  return map
}

export function getWeekDays(anchor: Date) {
  const s = startOfWeek(anchor, true)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
}

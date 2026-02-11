// @ts-nocheck
import type { SimulatorConfig } from "./types.ts"

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map((v) => parseInt(v, 10))
  return h * 60 + (Number.isNaN(m) ? 0 : m)
}

export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function toIsoDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function formatDatePt(dateIso: string): string {
  const [yyyy, mm, dd] = dateIso.split("-")
  return `${dd}/${mm}/${yyyy}`
}

/** Adiciona N dias a uma data ISO (YYYY-MM-DD). */
export function addDaysToIsoDate(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

export function getWeekdayKey(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`)
  const day = date.getDay()
  const map = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  return map[day]
}

export function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 100000
  }
  return hash
}

export function pickVariant(seed: string, variants: string[]): string {
  if (variants.length === 0) return ""
  const idx = Math.abs(hashString(seed || "0")) % variants.length
  return variants[idx]
}

// --- Parsing ---

export function hasExplicitDate(text: string): boolean {
  return /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.test(text)
}

export function parseTime(text: string): string | null {
  const msg = normalizeText(text)
  if (hasExplicitDate(text)) return null
  const match = msg.match(/(?:as|a|às)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\b/)
  if (!match) return null
  const hh = String(parseInt(match[1], 10)).padStart(2, "0")
  const mm = match[2] ? String(parseInt(match[2], 10)).padStart(2, "0") : "00"
  return `${hh}:${mm}`
}

export function parseEmail(text: string): string | null {
  const match = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  return match ? match[0] : null
}

export function parsePhone(text: string): string | null {
  const digits = text.replace(/\D/g, "")
  if (digits.length < 10 || digits.length > 13) return null
  return digits
}

export function parseDate(text: string, now = new Date()): string | null {
  const msg = normalizeText(text)
  if (msg.includes("hoje")) return toIsoDate(now)
  if (msg.includes("amanha")) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return toIsoDate(d)
  }
  const match = msg.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (!match) return null
  const day = parseInt(match[1], 10)
  const month = parseInt(match[2], 10) - 1
  const yearRaw = match[3] ? parseInt(match[3], 10) : now.getFullYear()
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw
  const date = new Date(year, month, day)
  if (Number.isNaN(date.getTime())) return null
  return toIsoDate(date)
}

export function parseWeekdayDate(text: string, now = new Date()): string | null {
  const msg = normalizeText(text)
  const weekdayMap: Record<string, number> = {
    domingo: 0,
    "domingo-feira": 0,
    segunda: 1,
    "segunda-feira": 1,
    terca: 2,
    "terca-feira": 2,
    quarta: 3,
    "quarta-feira": 3,
    quinta: 4,
    "quinta-feira": 4,
    sexta: 5,
    "sexta-feira": 5,
    sabado: 6,
    "sabado": 6,
    "sabado-feira": 6,
  }
  const key = Object.keys(weekdayMap).find((k) => msg.includes(k))
  if (!key) return null
  const targetDay = weekdayMap[key]
  const currentDay = now.getDay()
  let diff = (targetDay - currentDay + 7) % 7
  const wantsNext =
    msg.includes("proxima") ||
    msg.includes("próxima") ||
    msg.includes("prox") ||
    msg.includes("que vem") ||
    msg.includes("semana que vem")
  if (diff === 0 && wantsNext) diff = 7
  if (wantsNext && diff < 7) diff += 7
  const date = new Date(now)
  date.setDate(date.getDate() + diff)
  return toIsoDate(date)
}

export function parseTimePeriod(text: string): "morning" | "afternoon" | "evening" | null {
  const msg = normalizeText(text)
  if (/(de\s+manha|manha|manhã)/.test(msg)) return "morning"
  if (/(de\s+tarde|tarde)/.test(msg)) return "afternoon"
  if (/(de\s+noite|noite)/.test(msg)) return "evening"
  return null
}

export function formatTimePeriod(period: "morning" | "afternoon" | "evening"): string {
  if (period === "morning") return "de manha"
  if (period === "afternoon") return "a tarde"
  return "a noite"
}

export function parseDateOrWeekday(text: string, now = new Date()): string | null {
  return parseDate(text, now) || parseWeekdayDate(text, now)
}

export function parseTemplateChoice(text: string): "same_next" | "same_day" | "other_day" | "other_staff" | null {
  const msg = normalizeText(text)
  if (msg.includes("proximo horario") || msg.includes("próximo horario") || msg.includes("mesmo dia e colaborador")) return "same_next"
  if (msg.includes("mesmo dia") || msg.includes("outro horario no mesmo dia") || msg.includes("outro horário no mesmo dia"))
    return "same_day"
  if (msg.includes("outro dia") || msg.includes("outra data")) return "other_day"
  if (msg.includes("trocar colaborador") || msg.includes("outro colaborador")) return "other_staff"
  return null
}

// --- Schedule ---

export function buildDailySlots(start = "09:00", end = "18:00", intervalMinutes = 60): string[] {
  const s = toMinutes(start)
  const e = toMinutes(end)
  const step = Math.max(5, intervalMinutes || 60)
  const slots: string[] = []
  for (let t = s; t + step <= e; t += step) {
    slots.push(fromMinutes(t))
  }
  return slots
}

export function applyBreaks(slots: string[], breaks: Array<{ start: string; end: string }> = []): string[] {
  if (!breaks.length) return slots
  return slots.filter((slot) => {
    const t = toMinutes(slot)
    for (const b of breaks) {
      const bs = toMinutes(b.start)
      const be = toMinutes(b.end)
      if (t >= bs && t < be) return false
    }
    return true
  })
}

export function isWithinSchedule(time: string, schedule?: SimulatorConfig["schedule"]): { ok: boolean; reason?: string } {
  const start = schedule?.start_time || "09:00"
  const end = schedule?.end_time || "18:00"
  const t = toMinutes(time)
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (t < s || t >= e) {
    return { ok: false, reason: `Nosso horario de atendimento e das ${start} as ${end}.` }
  }
  const breaks = schedule?.breaks || []
  for (const b of breaks) {
    const bs = toMinutes(b.start)
    const be = toMinutes(b.end)
    if (t >= bs && t < be) {
      return { ok: false, reason: `Nesse horario estamos em pausa. Atendemos das ${start} as ${end}.` }
    }
  }
  return { ok: true }
}

const BUSINESS_TZ = "America/Sao_Paulo"

function getNowInBusinessTz(now: Date = new Date()): { dateIso: string; time: string } {
  const dateIso = now.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ }) // YYYY-MM-DD
  const time = now.toLocaleTimeString("pt-BR", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hour12: false })
  return { dateIso, time }
}

/** Retorna a data de hoje (YYYY-MM-DD) no fuso do negócio. */
export function getTodayIsoBusinessTz(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ })
}

/** Retorna true se o estabelecimento já encerrou o expediente de hoje (hora atual >= end_time). */
export function isBusinessClosedForToday(
  schedule?: SimulatorConfig["schedule"],
  now: Date = new Date()
): boolean {
  const end = schedule?.end_time || "18:00"
  const { dateIso: todayIso, time: nowTime } = getNowInBusinessTz(now)
  const nowMins = toMinutes(nowTime)
  const endMins = toMinutes(end)
  return nowMins >= endMins
}

/** Filtra os dias de atendimento removendo hoje quando o expediente já encerrou. */
export function filterDaysExcludingClosedToday(
  days: string[],
  schedule?: SimulatorConfig["schedule"],
  now: Date = new Date()
): string[] {
  if (!isBusinessClosedForToday(schedule, now)) return days
  const { dateIso: todayIso } = getNowInBusinessTz(now)
  const todayWeekday = getWeekdayKey(todayIso)
  return days.filter((d) => d !== todayWeekday)
}

export function getMockAvailability(
  dateIso: string,
  schedule?: SimulatorConfig["schedule"],
  bookedSlots?: Record<string, Record<string, string[]>>,
  staffName?: string,
  serviceDurationMinutes?: number | null,
  now: Date = new Date()
) {
  const start = schedule?.start_time || "09:00"
  const end = schedule?.end_time || "18:00"
  const interval = serviceDurationMinutes || schedule?.interval_minutes || 60
  let slots = applyBreaks(buildDailySlots(start, end, interval), schedule?.breaks || [])
  const { dateIso: todayIso, time: nowTime } = getNowInBusinessTz(now)
  if (dateIso === todayIso) {
    const nowMins = toMinutes(nowTime)
    slots = slots.filter((slot) => toMinutes(slot) > nowMins)
  }
  const occupied = new Set<string>()
  const fixedOccupied = ["10:00", "15:00"]
  fixedOccupied.forEach((t) => {
    if (slots.includes(t)) occupied.add(t)
  })
  const staffKey = staffName ? normalizeText(staffName) : "default"
  const alreadyBooked = bookedSlots?.[staffKey]?.[dateIso] || []
  alreadyBooked.forEach((t) => {
    if (slots.includes(t)) occupied.add(t)
  })
  return {
    available: slots.filter((slot) => !occupied.has(slot)),
    occupied: Array.from(occupied),
  }
}

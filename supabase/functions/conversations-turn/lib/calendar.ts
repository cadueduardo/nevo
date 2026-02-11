// @ts-nocheck
import { toMinutes, fromMinutes, formatDatePt } from "./utils.ts"
import { getServicesTotalDuration } from "./services.ts"
import type { SimulatorConfig } from "./types.ts"

export function formatIcsDateTime(dateIso: string, time: string): string {
  const [yyyy, mm, dd] = dateIso.split("-")
  const [hh, min] = time.split(":")
  return `${yyyy}${mm}${dd}T${hh}${min}00`
}

function formatIcsStamp(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const hh = String(date.getUTCHours()).padStart(2, "0")
  const min = String(date.getUTCMinutes()).padStart(2, "0")
  const ss = String(date.getUTCSeconds()).padStart(2, "0")
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`
}

function escapeIcsValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;")
}

export function buildCalendarIcs(options: {
  summary: string
  description?: string
  location?: string
  dateIso: string
  time: string
  durationMinutes: number
}): string {
  const { summary, description, location, dateIso, time, durationMinutes } = options
  const start = formatIcsDateTime(dateIso, time)
  const end = formatIcsDateTime(dateIso, fromMinutes(toMinutes(time) + durationMinutes))
  const uid = crypto.randomUUID()
  const stamp = formatIcsStamp(new Date())

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nevo//Atendimento//PT-BR",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeIcsValue(summary)}`,
    description ? `DESCRIPTION:${escapeIcsValue(description)}` : null,
    location ? `LOCATION:${escapeIcsValue(location)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n")
}

export async function uploadCalendarIcs(ics: string): Promise<string | null> {
  const { createSupabaseAdmin } = await import("./http.ts")
  const { supabaseAdmin, envError } = createSupabaseAdmin() as { supabaseAdmin: any; envError: string | null }
  if (envError || !supabaseAdmin) return null

  const bucketName = "calendar"
  try {
    const { data: existing } = await supabaseAdmin.storage.getBucket(bucketName)
    if (!existing) {
      await supabaseAdmin.storage.createBucket(bucketName, { public: true })
    }
  } catch {
    return null
  }

  const filePath = `appointments/${crypto.randomUUID()}.ics`
  const { error } = await supabaseAdmin.storage
    .from(bucketName)
    .upload(filePath, new Blob([ics], { type: "text/calendar" }), { upsert: true })
  if (error) return null

  const { data } = supabaseAdmin.storage.from(bucketName).getPublicUrl(filePath)
  return data?.publicUrl || null
}

export async function buildFinalBookingMessage(options: {
  config: SimulatorConfig
  service?: string
  staffName?: string
  dateIso?: string
  time?: string
}): Promise<{ message: string; calendar_url?: string | null }> {
  const { config, service, staffName, dateIso, time } = options
  const finalService = service || "atendimento"
  const staff = staffName ? ` com ${staffName}` : ""
  const date = dateIso ? formatDatePt(dateIso) : ""
  const hour = time || ""
  const duration = getServicesTotalDuration(config, finalService) || 60
  const summary = `${finalService}${staff}`
  const description = config.business_name ? `Agendamento na ${config.business_name}` : "Agendamento confirmado"
  const location = config.business_name || undefined
  const calendarIcs =
    dateIso && time
      ? buildCalendarIcs({
          summary,
          description,
          location,
          dateIso,
          time,
          durationMinutes: duration,
        })
      : null
  const calendarUrl = calendarIcs ? await uploadCalendarIcs(calendarIcs) : null
  const baseMessage =
    `Perfeito! Seu agendamento de ${finalService}${staff} ficou confirmado para ${date} às ${hour}. ` +
    "Se precisar de algo, estou à disposição."
  return { message: baseMessage, calendar_url: calendarUrl }
}

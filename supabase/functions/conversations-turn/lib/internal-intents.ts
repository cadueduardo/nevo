// @ts-nocheck
/**
 * Intents internas de agenda (modo internal, owner/admin).
 * Classificação por padrões; handlers determinísticos.
 */
import {
  normalizeText,
  getTodayIsoBusinessTz,
  addDaysToIsoDate,
  parseTime,
  parseDate,
  parseDateOrWeekday,
  toMinutes,
  formatDatePt,
} from "./utils.ts"

const BUSINESS_TZ = "America/Sao_Paulo"
const TIME_TOLERANCE_MINUTES = 20

export type InternalIntentType =
  | "query_appointments_today"
  | "query_appointments_tomorrow"
  | "query_appointments_by_date"
  | "query_appointment_by_time"
  | "cancel_appointment"
  | "create_appointment_internal"
  | null

export interface InternalIntentSlots {
  date?: string
  time?: string
  name?: string
  service?: string
  cancellation_reason?: string
}

export interface ClassifiedInternalIntent {
  intent: InternalIntentType
  slots: InternalIntentSlots
}

function toBusinessDateTime(value: string): { dateIso: string; time: string } {
  const dt = new Date(value)
  return {
    dateIso: dt.toLocaleDateString("en-CA", { timeZone: BUSINESS_TZ }),
    time: dt.toLocaleTimeString("pt-BR", {
      timeZone: BUSINESS_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  }
}

/**
 * Classifica a intenção interna por padrões (sem IA).
 */
export function classifyInternalIntent(text: string): ClassifiedInternalIntent {
  const msg = normalizeText(text)
  const todayIso = getTodayIsoBusinessTz()
  const tomorrowIso = addDaysToIsoDate(todayIso, 1)
  const slots: InternalIntentSlots = {}

  // cancel_appointment: cancelar, desmarcar, etc.
  if (
    /\b(cancelar|desmarcar|cancela|desmarca)\b/.test(msg) ||
    /\b(quero\s+)?cancelar\s+(o\s+)?(agendamento|compromisso|horario)\b/.test(msg)
  ) {
    const time = parseTime(text)
    const date = parseDateOrWeekday(text) || parseDate(text)
    if (time) slots.time = time
    if (date) slots.date = date
    return { intent: "cancel_appointment", slots }
  }

  // query_appointments_today
  if (
    /\b(hoje|dia\s+de\s+hoje)\b/.test(msg) &&
    /\b(agenda|agendamentos?|compromissos?|consultas?|horarios?|marcacoes?|marcações?|que\s+tem)\b/.test(msg)
  ) {
    return { intent: "query_appointments_today", slots: { date: todayIso } }
  }

  // query_appointments_tomorrow
  if (
    /\b(amanha|amanhã)\b/.test(msg) &&
    /\b(agenda|agendamentos?|compromissos?|consultas?|horarios?|marcacoes?|marcações?|que\s+tem)\b/.test(msg)
  ) {
    return { intent: "query_appointments_tomorrow", slots: { date: tomorrowIso } }
  }

  // query_appointments_by_date: data explícita ou dia da semana
  const dateFromText = parseDateOrWeekday(text) || parseDate(text)
  if (
    dateFromText &&
    /\b(agenda|agendamentos?|compromissos?|consultas?|horarios?|marcacoes?|marcações?|dia\s+\d)\b/.test(msg)
  ) {
    return { intent: "query_appointments_by_date", slots: { date: dateFromText } }
  }

  // query_appointment_by_time: horário explícito (ex: "quem tem às 14h", "14:00")
  const timeFromText = parseTime(text)
  if (
    timeFromText &&
    /\b(quem|qual|dados?|informacoes?|informações?|cliente|paciente|agendamento|tem)\b/.test(msg)
  ) {
    const date = parseDateOrWeekday(text) || parseDate(text) || todayIso
    return { intent: "query_appointment_by_time", slots: { date, time: timeFromText } }
  }
  // Também: "às 14h", "14:00" sozinho (contexto de agenda)
  if (timeFromText && /\b(as|a|às)\s*\d/.test(msg)) {
    const date = parseDateOrWeekday(text) || parseDate(text) || todayIso
    return { intent: "query_appointment_by_time", slots: { date, time: timeFromText } }
  }

  // create_appointment_internal: criar, agendar, marcar (para dono criar em nome de cliente)
  if (
    /\b(criar|agendar|marcar|cadastrar)\s+(um\s+)?(agendamento|compromisso|horario|consulta)\b/.test(msg) ||
    /\b(quero\s+)?(agendar|marcar)\s+para\b/.test(msg)
  ) {
    const time = parseTime(text)
    const date = parseDateOrWeekday(text) || parseDate(text) || todayIso
    if (time) slots.time = time
    if (date) slots.date = date
    return { intent: "create_appointment_internal", slots }
  }

  return { intent: null, slots: {} }
}

export interface HandleInternalIntentParams {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  message: string
  config?: { business_name?: string }
}

export interface HandleInternalIntentResult {
  handled: boolean
  message: string
}

/**
 * Processa intents internas de agenda. Retorna { handled: true, message } se resolveu;
 * { handled: false } se não é intent interna ou não classificou.
 */
export async function handleInternalIntent(params: HandleInternalIntentParams): Promise<HandleInternalIntentResult> {
  const { supabaseAdmin, tenantId, agentId, message } = params
  const { intent, slots } = classifyInternalIntent(message)

  if (!intent) return { handled: false, message: "" }

  const todayIso = getTodayIsoBusinessTz()

  switch (intent) {
    case "query_appointments_today": {
      const dateIso = slots.date || todayIso
      const start = `${dateIso}T00:00:00.000-03:00`
      const end = `${dateIso}T23:59:59.999-03:00`
      const { data: rows, error } = await supabaseAdmin
        .from("appointment")
        .select("attendee_name, staff_name, service_names, start_at, status")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .gte("start_at", start)
        .lte("start_at", end)
        .order("start_at", { ascending: true })

      if (error) {
        console.error("internal intent query_appointments_today error:", error)
        return { handled: true, message: "Não consegui consultar a agenda. Tente novamente." }
      }

      const items = (rows || []).map((r: any) => {
        const { time } = toBusinessDateTime(r.start_at)
        const svc = Array.isArray(r.service_names) && r.service_names.length > 0 ? r.service_names.join(", ") : "—"
        return `${time} – ${r.attendee_name || "—"} (${r.staff_name || "—"}) – ${svc}`
      })
      const label = dateIso === todayIso ? "Hoje" : formatDatePt(dateIso)
      const text = items.length > 0 ? `📅 ${label}:\n${items.join("\n")}` : `📅 ${label}: Nenhum agendamento.`
      return { handled: true, message: text }
    }

    case "query_appointments_tomorrow": {
      const tomorrowIso = addDaysToIsoDate(todayIso, 1)
      const start = `${tomorrowIso}T00:00:00.000-03:00`
      const end = `${tomorrowIso}T23:59:59.999-03:00`
      const { data: rows, error } = await supabaseAdmin
        .from("appointment")
        .select("attendee_name, staff_name, service_names, start_at, status")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .gte("start_at", start)
        .lte("start_at", end)
        .order("start_at", { ascending: true })

      if (error) {
        console.error("internal intent query_appointments_tomorrow error:", error)
        return { handled: true, message: "Não consegui consultar a agenda. Tente novamente." }
      }

      const items = (rows || []).map((r: any) => {
        const { time } = toBusinessDateTime(r.start_at)
        const svc = Array.isArray(r.service_names) && r.service_names.length > 0 ? r.service_names.join(", ") : "—"
        return `${time} – ${r.attendee_name || "—"} (${r.staff_name || "—"}) – ${svc}`
      })
      const text =
        items.length > 0 ? `📅 Amanhã:\n${items.join("\n")}` : "📅 Amanhã: Nenhum agendamento."
      return { handled: true, message: text }
    }

    case "query_appointments_by_date": {
      const dateIso = slots.date || todayIso
      const start = `${dateIso}T00:00:00.000-03:00`
      const end = `${dateIso}T23:59:59.999-03:00`
      const { data: rows, error } = await supabaseAdmin
        .from("appointment")
        .select("attendee_name, staff_name, service_names, start_at, status")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .gte("start_at", start)
        .lte("start_at", end)
        .order("start_at", { ascending: true })

      if (error) {
        console.error("internal intent query_appointments_by_date error:", error)
        return { handled: true, message: "Não consegui consultar a agenda. Tente novamente." }
      }

      const items = (rows || []).map((r: any) => {
        const { time } = toBusinessDateTime(r.start_at)
        const svc = Array.isArray(r.service_names) && r.service_names.length > 0 ? r.service_names.join(", ") : "—"
        return `${time} – ${r.attendee_name || "—"} (${r.staff_name || "—"}) – ${svc}`
      })
      const label = formatDatePt(dateIso)
      const text = items.length > 0 ? `📅 ${label}:\n${items.join("\n")}` : `📅 ${label}: Nenhum agendamento.`
      return { handled: true, message: text }
    }

    case "query_appointment_by_time": {
      const dateIso = slots.date || todayIso
      const timeStr = slots.time || ""
      const targetMins = toMinutes(timeStr)
      const minMins = targetMins - TIME_TOLERANCE_MINUTES
      const maxMins = targetMins + TIME_TOLERANCE_MINUTES

      const start = `${dateIso}T00:00:00.000-03:00`
      const end = `${dateIso}T23:59:59.999-03:00`
      const { data: rows, error } = await supabaseAdmin
        .from("appointment")
        .select("attendee_name, staff_name, service_names, start_at, contact_id")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .gte("start_at", start)
        .lte("start_at", end)
        .order("start_at", { ascending: true })

      if (error) {
        console.error("internal intent query_appointment_by_time error:", error)
        return { handled: true, message: "Não consegui consultar. Tente novamente." }
      }

      const inWindow = (rows || []).filter((r: any) => {
        const { time } = toBusinessDateTime(r.start_at)
        const mins = toMinutes(time)
        return mins >= minMins && mins <= maxMins
      })

      if (inWindow.length === 0) {
        return { handled: true, message: `Nenhum agendamento encontrado por volta das ${timeStr}.` }
      }

      // Buscar telefone do contato quando houver contact_id
      const contactIds = [...new Set(inWindow.map((r: any) => r.contact_id).filter(Boolean))]
      let contactPhones: Record<string, string> = {}
      if (contactIds.length > 0) {
        const { data: contacts } = await supabaseAdmin
          .from("contact")
          .select("id, phone, display_name")
          .in("id", contactIds)
        for (const c of contacts || []) {
          contactPhones[c.id] = c.phone || c.display_name || "—"
        }
      }

      const lines = inWindow.slice(0, 3).map((r: any) => {
        const { time } = toBusinessDateTime(r.start_at)
        const svc = Array.isArray(r.service_names) && r.service_names.length > 0 ? r.service_names.join(", ") : "—"
        const phone = r.contact_id ? contactPhones[r.contact_id] || "—" : "—"
        return `${time} – ${r.attendee_name || "—"} | Tel: ${phone} | ${svc}`
      })
      const suffix = inWindow.length > 3 ? `\n(E mais ${inWindow.length - 3} agendamento(s) nessa faixa.)` : ""
      return { handled: true, message: `📅 Por volta das ${timeStr}:\n${lines.join("\n")}${suffix}` }
    }

    case "cancel_appointment": {
      const dateIso = slots.date || todayIso
      const timeStr = slots.time

      if (!timeStr) {
        return {
          handled: true,
          message: "Para cancelar, informe o horário do agendamento (ex.: cancelar o das 14h).",
        }
      }

      const targetMins = toMinutes(timeStr)
      const minMins = targetMins - TIME_TOLERANCE_MINUTES
      const maxMins = targetMins + TIME_TOLERANCE_MINUTES
      const start = `${dateIso}T00:00:00.000-03:00`
      const end = `${dateIso}T23:59:59.999-03:00`

      const { data: rows, error } = await supabaseAdmin
        .from("appointment")
        .select("id, attendee_name, start_at")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .gte("start_at", start)
        .lte("start_at", end)

      if (error) {
        console.error("internal intent cancel_appointment query error:", error)
        return { handled: true, message: "Não consegui localizar o agendamento. Tente novamente." }
      }

      const match = (rows || []).find((r: any) => {
        const { time } = toBusinessDateTime(r.start_at)
        const mins = toMinutes(time)
        return mins >= minMins && mins <= maxMins
      })

      if (!match) {
        return { handled: true, message: `Nenhum agendamento encontrado por volta das ${timeStr} em ${formatDatePt(dateIso)}.` }
      }

      const { error: updateErr } = await supabaseAdmin
        .from("appointment")
        .update({
          status: "cancelled",
          cancellation_reason: slots.cancellation_reason || "Cancelado pelo dono via assistente",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", match.id)

      if (updateErr) {
        console.error("internal intent cancel_appointment update error:", updateErr)
        return { handled: true, message: "Não consegui cancelar. Tente novamente." }
      }

      const { time } = toBusinessDateTime(match.start_at)
      return {
        handled: true,
        message: `✅ Agendamento de ${match.attendee_name || "—"} às ${time} foi cancelado.`,
      }
    }

    case "create_appointment_internal": {
      // Por ora: redireciona para o fluxo normal de agendamento.
      // O dono pode usar o simulador para criar; ou futuramente extrair slots via IA.
      return {
        handled: true,
        message:
          "Para criar um agendamento, use o fluxo de agendamento normalmente (informe serviço, data e horário). Em breve teremos criação rápida por mensagem.",
      }
    }

    default:
      return { handled: false, message: "" }
  }
}

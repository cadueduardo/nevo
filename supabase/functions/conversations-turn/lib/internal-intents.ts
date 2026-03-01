// @ts-nocheck
/**
 * Intents internas de agenda e orçamento (modo internal, owner/admin).
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
  fromMinutes,
  formatDatePt,
  isWithinSchedule,
  isTimeTooSoonForDate,
  isBusinessClosedForToday,
  getWeekdayKey,
} from "./utils.ts"
import { findServiceFromText, getServiceDurationMinutes } from "./services.ts"
import { getScheduleForStaff } from "./staff.ts"
import {
  extractQuoteSlotsFromText,
  validateQuoteSlots,
  calculateQuote,
  formatInternalQuote,
  type QuoteSlots,
  type QuoteServiceRow,
} from "./quote-engine.ts"
import type { SimulatorState } from "./types.ts"
import { generateQuotePdf } from "./generatePdf.ts"

const BUSINESS_TZ = "America/Sao_Paulo"
const TIME_TOLERANCE_MINUTES = 20

export type InternalIntentType =
  | "query_appointments_today"
  | "query_appointments_tomorrow"
  | "query_appointments_by_date"
  | "query_appointment_by_time"
  | "query_contact_by_appointment_time"
  | "query_contact_by_name"
  | "cancel_appointment"
  | "create_appointment_internal"
  | "request_quote_internal"
  | "confirm_quote_pdf"
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

  // query_contact_by_appointment_time: contato/dados do cliente por horário (reusa lógica de query_appointment_by_time)
  const timeForContact = parseTime(text)
  if (
    timeForContact &&
    /\b(contato|dados?|cliente|paciente|telefone|quem\s+e)\b/.test(msg) &&
    /\b(das?|as|a|às|horario|hora)\b/.test(msg)
  ) {
    const date = parseDateOrWeekday(text) || parseDate(text) || todayIso
    return { intent: "query_contact_by_appointment_time", slots: { date, time: timeForContact } }
  }

  // query_contact_by_name: buscar contato por nome
  const contactNameMatch = msg.match(
    /\b(contato|buscar|dados?\s+de?|quem\s+e|telefone\s+de)\s+(.+?)(?:\s*[?.!]?)$/
  )
  if (contactNameMatch && contactNameMatch[2].trim().length >= 2) {
    const name = contactNameMatch[2].trim()
    return { intent: "query_contact_by_name", slots: { name } }
  }
  if (/\b(contato|buscar)\s+/.test(msg)) {
    const afterTrigger = msg.replace(/^(?:contato|buscar)\s+/, "").trim()
    if (afterTrigger.length >= 2) return { intent: "query_contact_by_name", slots: { name: afterTrigger } }
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
    const name = extractAttendeeNameFromMessage(text)
    if (time) slots.time = time
    if (date) slots.date = date
    if (name) slots.name = name
    return { intent: "create_appointment_internal", slots }
  }

  // request_quote_internal: orçamento, faz orçamento, cotação, etc.
  if (
    /\b(orçamento|orcamento|cotação|cotacao|cotar|orçar|orcar)\b/.test(msg) ||
    /\b(faz|fazer|quero|preciso)\s+(um\s+)?(orçamento|orcamento|cotação|cotacao)\b/.test(msg) ||
    /\b(orçamento|orcamento)\s+(de|para)\b/.test(msg)
  ) {
    return { intent: "request_quote_internal", slots: {} }
  }

  return { intent: null, slots: {} }
}

export interface HandleInternalIntentParams {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  message: string
  config?: {
    business_name?: string
    branding?: {
      enabled?: boolean
      logo_url?: string
      company_legal_name?: string
      cnpj?: string
      company_phone?: string
      company_email?: string
    }
    schedule?: { days_of_week?: string[]; start_time?: string; end_time?: string; breaks?: Array<{ start: string; end: string }>; interval_minutes?: number; min_booking_lead_minutes?: number }
    services?: Array<{ name: string; duration_minutes?: number }>
  }
  /** Estado do simulador (para quote_pending e confirmação de PDF). */
  state?: SimulatorState
  conversationId?: string
  channelId?: string
}

export interface HandleInternalIntentResult {
  handled: boolean
  message: string
  /** Estado atualizado (ex.: quote_pending). */
  state?: SimulatorState
  /** Opções de ação (ex.: "Sim" / "Não"). */
  action_options?: string[]
}

function isQuoteConfirmation(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /\b(sim|confirmar|confirmo|pode\s+gerar|gerar\s+pdf|quero\s+o\s+pdf)\b/.test(msg) ||
    /^sim\s*[.!]?$/i.test(text.trim()) ||
    /^confirmo\s*[.!]?$/i.test(text.trim())
  )
}

/** Extrai nome do cliente de mensagens como "agendar para João Silva amanhã 14h" ou "cliente Maria". */
function extractAttendeeNameFromMessage(text: string): string | null {
  const m = text.match(/(?:para|cliente)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{1,40}?)(?:\s+(?:amanhã|hoje|\d{1,2}[\/\-]\d{1,2}|\d{1,2}h|\d{1,2}:\d{2})|\s*$)/i)
  if (m) return m[1].trim()
  const m2 = text.match(/(?:para|cliente)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{1,40})/i)
  if (m2) return m2[1].trim()
  return null
}

function isQuoteDecline(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /\b(nao|não|nao\s+quero|dispenso|cancelar)\b/.test(msg) ||
    /^nao\s*[.!]?$/i.test(text.trim()) ||
    /^não\s*[.!]?$/i.test(text.trim())
  )
}

/**
 * Processa intents internas de agenda e orçamento. Retorna { handled: true, message } se resolveu;
 * { handled: false } se não é intent interna ou não classificou.
 */
export async function handleInternalIntent(params: HandleInternalIntentParams): Promise<HandleInternalIntentResult> {
  const { supabaseAdmin, tenantId, agentId, message, state: incomingState, conversationId } = params
  const todayIso = getTodayIsoBusinessTz()

  // quote_pending + recusa: limpar estado
  if (incomingState?.quote_pending && isQuoteDecline(message)) {
    return {
      handled: true,
      message: "Ok, sem problema. O orçamento não foi salvo.",
      state: { ...incomingState, quote_pending: undefined },
    }
  }

  // appointment_pending + recusa: limpar estado
  if (incomingState?.appointment_pending && isQuoteDecline(message)) {
    return {
      handled: true,
      message: "Ok, o agendamento não foi criado.",
      state: { ...incomingState, appointment_pending: undefined },
    }
  }

  // confirm_appointment: estado tem appointment_pending e usuário confirmou
  if (incomingState?.appointment_pending && isQuoteConfirmation(message)) {
    const pending = incomingState.appointment_pending
    try {
      const startAt = `${pending.date}T${pending.time}:00.000-03:00`
      const endMins = toMinutes(pending.time) + pending.duration_minutes
      const endTime = fromMinutes(endMins)
      const endAt = `${pending.date}T${endTime}:00.000-03:00`

      let contactId: string | null = null
      if (params.channelId) {
        const { data: existing } = await supabaseAdmin
          .from("contact")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("channel_id", params.channelId)
          .eq("display_name", pending.attendee_name)
          .limit(1)
          .maybeSingle()
        if (existing?.id) {
          contactId = existing.id
        } else {
          const { data: newContact } = await supabaseAdmin
            .from("contact")
            .insert({
              tenant_id: tenantId,
              channel_id: params.channelId,
              external_id: `internal:${pending.attendee_name}:${Date.now()}`,
              display_name: pending.attendee_name,
              phone: "",
            })
            .select("id")
            .single()
          contactId = newContact?.id ?? null
        }
      }

      const { error: insertErr } = await supabaseAdmin.from("appointment").insert({
        tenant_id: tenantId,
        agent_id: agentId,
        attendee_name: pending.attendee_name,
        staff_name: null,
        service_names: [pending.service_name],
        start_at: startAt,
        end_at: endAt,
        status: "confirmed",
        contact_id: contactId,
      })

      if (insertErr) {
        console.error("internal intent confirm_appointment insert error:", insertErr)
        return {
          handled: true,
          message: "Não consegui criar o agendamento. Tente novamente.",
          state: { ...incomingState, appointment_pending: undefined },
        }
      }

      const nextState = { ...incomingState, appointment_pending: undefined }
      return {
        handled: true,
        message: `✅ Agendamento criado: ${pending.attendee_name}, ${pending.service_name}, ${formatDatePt(pending.date)} às ${pending.time}.`,
        state: nextState,
      }
    } catch (err) {
      console.error("internal intent confirm_appointment error:", err)
      return {
        handled: true,
        message: "Ocorreu um erro ao criar o agendamento. Tente novamente.",
        state: { ...incomingState, appointment_pending: undefined },
      }
    }
  }

  // confirm_quote_pdf: estado tem quote_pending e usuário confirmou (Sim, Confirmar, etc.)
  if (incomingState?.quote_pending && isQuoteConfirmation(message)) {
    const pending = incomingState.quote_pending
    if (!conversationId) {
      return {
        handled: true,
        message: "Não foi possível salvar o orçamento (conversa não identificada). Tente novamente.",
        state: { ...incomingState, quote_pending: undefined },
      }
    }
    try {
      const { error: insertErr } = await supabaseAdmin
        .from("request")
        .insert({
          tenant_id: tenantId,
          conversation_id: conversationId,
          status: "pending",
          slots: pending.slots,
          blueprint_id: pending.service_id,
          total_value: pending.result.total,
          currency: pending.result.currency || "BRL",
          calculation_result: pending.result,
          is_estimated: false,
        })

      if (insertErr) {
        console.error("internal intent confirm_quote_pdf insert error:", insertErr)
        return {
          handled: true,
          message: "Não consegui salvar o orçamento. Tente novamente.",
          state: { ...incomingState, quote_pending: undefined },
        }
      }

      const totalFormatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: pending.result.currency || "BRL",
      }).format(pending.result.total)
      const nextState = { ...incomingState, quote_pending: undefined }

      const branding = params.config?.branding
      const pdfResult = await generateQuotePdf(supabaseAdmin, tenantId, {
        serviceName: pending.service_name,
        total: pending.result.total,
        currency: pending.result.currency || "BRL",
        breakdown: pending.result.breakdown,
        businessName: params.config?.business_name,
        branding,
      })

      if (pdfResult?.url) {
        const upgradeNote =
          branding?.enabled !== true
            ? " Quer deixar esse orçamento mais profissional com seu logo e dados da empresa? Configure na área logada."
            : ""
        return {
          handled: true,
          message: `✅ Orçamento de ${pending.service_name} (${totalFormatted}) salvo no histórico.\n\n📄 PDF gerado. Link para download (válido por 7 dias):\n${pdfResult.url}${upgradeNote}`,
          state: nextState,
        }
      }

      return {
        handled: true,
        message: `✅ Orçamento de ${pending.service_name} (${totalFormatted}) salvo no histórico. Não foi possível gerar o PDF agora; acesse pela área logada.`,
        state: nextState,
      }
    } catch (err) {
      console.error("internal intent confirm_quote_pdf error:", err)
      return {
        handled: true,
        message: "Ocorreu um erro ao processar. Tente novamente.",
        state: { ...incomingState, quote_pending: undefined },
      }
    }
  }

  const { intent, slots } = classifyInternalIntent(message)
  if (!intent) return { handled: false, message: "" }

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

    case "query_appointment_by_time":
    case "query_contact_by_appointment_time": {
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

    case "query_contact_by_name": {
      const searchName = slots.name?.trim()
      if (!searchName || searchName.length < 2) {
        return { handled: true, message: "Informe o nome para buscar (ex.: contato João)." }
      }

      const term = `%${searchName}%`
      const { data: contacts, error } = await supabaseAdmin
        .from("contact")
        .select("id, display_name, phone, external_id")
        .eq("tenant_id", tenantId)
        .or(`display_name.ilike.${term},phone.ilike.${term}`)
        .limit(10)

      if (error) {
        console.error("internal intent query_contact_by_name error:", error)
        return { handled: true, message: "Não consegui buscar. Tente novamente." }
      }

      const list = contacts || []
      if (list.length === 0) {
        return { handled: true, message: `Nenhum contato encontrado para "${searchName}".` }
      }

      if (list.length === 1) {
        const c = list[0]
        const name = c.display_name || c.external_id || "—"
        return {
          handled: true,
          message: `📇 ${name}\nTel: ${c.phone || "—"}`,
        }
      }

      const lines = list.slice(0, 5).map((c: any, i: number) => {
        const name = c.display_name || c.external_id || c.phone || "—"
        return `${i + 1}. ${name} – ${c.phone || "—"}`
      })
      return {
        handled: true,
        message: `Encontrei ${list.length} contato(s):\n${lines.join("\n")}\n\nQual deles? (informe o número ou nome completo)`,
      }
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
      const schedule = params.config?.schedule
      const services = params.config?.services || []
      const dateIso = slots.date || getTodayIsoBusinessTz()
      const timeStr = slots.time
      const serviceName = slots.service || findServiceFromText(message, services)
      const attendeeName = slots.name || extractAttendeeNameFromMessage(message)

      if (!timeStr) {
        return {
          handled: true,
          message: "Para criar o agendamento, informe o horário (ex.: às 14h, 14:00).",
        }
      }
      if (!attendeeName || attendeeName.length < 2) {
        return {
          handled: true,
          message: "Qual o nome do cliente? (ex.: agendar para João Silva amanhã 14h)",
        }
      }
      if (!serviceName) {
        const svcList = services.slice(0, 5).map((s) => s.name).join(", ")
        return {
          handled: true,
          message: `Qual serviço? ${svcList ? `Opções: ${svcList}` : "Informe o nome do serviço."}`,
        }
      }

      const duration = getServiceDurationMinutes(
        { services } as any,
        serviceName
      ) ?? 60
      const scheduleForValidation = schedule
        ? { start_time: schedule.start_time || "09:00", end_time: schedule.end_time || "18:00", breaks: schedule.breaks }
        : undefined
      const within = isWithinSchedule(timeStr, scheduleForValidation)
      if (!within.ok) {
        return { handled: true, message: within.reason || "Horário fora do expediente." }
      }
      if (isTimeTooSoonForDate(dateIso, timeStr, schedule?.min_booking_lead_minutes ?? 20)) {
        return {
          handled: true,
          message: "Esse horário está muito próximo. Escolha um horário com pelo menos 20 min de antecedência.",
        }
      }
      const dayKey = getWeekdayKey(dateIso)
      const days = schedule?.days_of_week || ["monday", "tuesday", "wednesday", "thursday", "friday"]
      if (!days.includes(dayKey)) {
        return {
          handled: true,
          message: `Não atendemos nesse dia. Nossa agenda: ${days.join(", ")}.`,
        }
      }

      const startAt = `${dateIso}T${timeStr}:00.000-03:00`
      const endMins = toMinutes(timeStr) + duration
      const endAt = `${dateIso}T${fromMinutes(endMins)}:00.000-03:00`
      const { data: conflicts } = await supabaseAdmin
        .from("appointment")
        .select("id, attendee_name, start_at")
        .eq("tenant_id", tenantId)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .lt("start_at", endAt)
        .gt("end_at", startAt)

      if (Array.isArray(conflicts) && conflicts.length > 0) {
        const first = conflicts[0] as any
        const { time } = toBusinessDateTime(first.start_at)
        return {
          handled: true,
          message: `Já existe agendamento às ${time} (${first.attendee_name || "—"}). Escolha outro horário.`,
        }
      }

      const nextState: SimulatorState = {
        ...(incomingState || {}),
        appointment_pending: {
          date: dateIso,
          time: timeStr,
          service_name: serviceName,
          attendee_name: attendeeName.trim(),
          duration_minutes: duration,
        },
      }
      return {
        handled: true,
        message: `Confirma: **${attendeeName.trim()}**, ${serviceName}, ${formatDatePt(dateIso)} às ${timeStr}?`,
        state: nextState,
        action_options: ["Sim", "Não"],
      }
    }

    case "request_quote_internal": {
      // Carregar quote_service do agente
      const { data: quoteServices, error: qsError } = await supabaseAdmin
        .from("quote_service")
        .select("id, agent_id, name, pricing_type, variables_schema, pricing_rules, external_variable_keys, keywords, active")
        .eq("agent_id", agentId)
        .eq("active", true)

      if (qsError) {
        console.error("internal intent request_quote_internal quote_service error:", qsError)
        return { handled: true, message: "Não consegui carregar os serviços de orçamento. Tente novamente." }
      }

      const services = (quoteServices || []) as QuoteServiceRow[]
      if (services.length === 0) {
        return {
          handled: true,
          message:
            "Ainda não há serviços de orçamento configurados. Configure na área logada (serviços de orçamento) para usar esta função.",
        }
      }

      // Usar o primeiro serviço (MVP: um por agente; futuro: detectar por keywords)
      const service = services[0]
      const schema = (service.variables_schema || []) as Array<{ key: string; label?: string; required?: boolean }>

      const slots: QuoteSlots = extractQuoteSlotsFromText(message)
      const validation = validateQuoteSlots(schema, slots)

      if (!validation.valid) {
        const missingList = validation.missing.join(", ")
        return {
          handled: true,
          message: `Para o orçamento de ${service.name}, preciso de: ${missingList}. Informe na mensagem (ex.: cortina 2,80 x 2,60 blackout wave com instalação).`,
        }
      }

      const calcResult = calculateQuote(service, slots)
      const formatted = formatInternalQuote(calcResult)

      const nextState: SimulatorState = {
        ...(incomingState || {}),
        quote_pending: {
          service_id: service.id,
          service_name: service.name,
          slots: slots as Record<string, unknown>,
          result: calcResult,
        },
      }

      return {
        handled: true,
        message: `${formatted}\n\nDeseja gerar o PDF do orçamento?`,
        state: nextState,
        action_options: ["Sim", "Não"],
      }
    }

    default:
      return { handled: false, message: "" }
  }
}

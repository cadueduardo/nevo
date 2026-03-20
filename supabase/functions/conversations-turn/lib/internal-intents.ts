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
import { resolveConfiguredServicesFromConfig } from "./canonical-services.ts"
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

function resolveInternalParsedDate(text: string, fallbackDate?: string): string | undefined {
  return parseDateOrWeekday(text) || parseDate(text) || fallbackDate
}

function hasInternalAgendaKeywords(msg: string): boolean {
  return /\b(agenda|agendamentos?|compromissos?|consultas?|horarios?|marcacoes?|marcações?|que\s+tem)\b/.test(
    msg
  )
}

function resolveInternalBaseIntentSlots(params: {
  text: string
  fallbackDate?: string
  includeName?: boolean
}): InternalIntentSlots {
  const { text, fallbackDate, includeName = false } = params
  const slots: InternalIntentSlots = {}
  const time = parseTime(text)
  const date = resolveInternalParsedDate(text, fallbackDate)
  const name = includeName ? extractAttendeeNameFromMessage(text) : null
  if (time) slots.time = time
  if (date) slots.date = date
  if (name) slots.name = name
  return slots
}

function resolveInternalContactLookupName(msg: string): string | null {
  const contactNameMatch = msg.match(
    /\b(contato|buscar|dados?\s+de?|quem\s+e|telefone\s+de)\s+(.+?)(?:\s*[?.!]?)$/
  )
  if (contactNameMatch && contactNameMatch[2].trim().length >= 2) {
    return contactNameMatch[2].trim()
  }

  if (/\b(contato|buscar)\s+/.test(msg)) {
    const afterTrigger = msg.replace(/^(?:contato|buscar)\s+/, "").trim()
    if (afterTrigger.length >= 2) return afterTrigger
  }

  return null
}

function resolveInternalTimedAgendaSlots(params: {
  text: string
  fallbackDate: string
}): { date: string; time: string } | null {
  const { text, fallbackDate } = params
  const time = parseTime(text)
  if (!time) return null
  return {
    date: resolveInternalParsedDate(text, fallbackDate)!,
    time,
  }
}

function resolveInternalTimedAgendaIntent(params: {
  text: string
  msg: string
  fallbackDate: string
}): ClassifiedInternalIntent | null {
  const { text, msg, fallbackDate } = params
  const timedAgendaSlots = resolveInternalTimedAgendaSlots({
    text,
    fallbackDate,
  })
  if (!timedAgendaSlots) return null

  if (
    /\b(contato|dados?|cliente|paciente|telefone|quem\s+e)\b/.test(msg) &&
    /\b(das?|as|a|às|horario|hora)\b/.test(msg)
  ) {
    return { intent: "query_contact_by_appointment_time", slots: timedAgendaSlots }
  }

  if (
    /\b(quem|qual|dados?|informacoes?|informações?|cliente|paciente|agendamento|tem)\b/.test(msg) ||
    /\b(as|a|às)\s*\d/.test(msg)
  ) {
    return { intent: "query_appointment_by_time", slots: timedAgendaSlots }
  }

  return null
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
    return {
      intent: "cancel_appointment",
      slots: resolveInternalBaseIntentSlots({ text }),
    }
  }

  // query_appointments_today
  if (/\b(hoje|dia\s+de\s+hoje)\b/.test(msg) && hasInternalAgendaKeywords(msg)) {
    return { intent: "query_appointments_today", slots: { date: todayIso } }
  }

  // query_appointments_tomorrow
  if (/\b(amanha|amanhã)\b/.test(msg) && hasInternalAgendaKeywords(msg)) {
    return { intent: "query_appointments_tomorrow", slots: { date: tomorrowIso } }
  }

  // query_appointments_by_date: data explícita ou dia da semana
  const dateFromText = resolveInternalParsedDate(text)
  if (dateFromText && (hasInternalAgendaKeywords(msg) || /\bdia\s+\d\b/.test(msg))) {
    return { intent: "query_appointments_by_date", slots: { date: dateFromText } }
  }

  // query_contact_by_appointment_time: contato/dados do cliente por horário (reusa lógica de query_appointment_by_time)
  const timedAgendaSlots = resolveInternalTimedAgendaSlots({
    text,
    fallbackDate: todayIso,
  })
  if (
    timedAgendaSlots &&
    /\b(contato|dados?|cliente|paciente|telefone|quem\s+e)\b/.test(msg) &&
    /\b(das?|as|a|às|horario|hora)\b/.test(msg)
  ) {
    return { intent: "query_contact_by_appointment_time", slots: timedAgendaSlots }
  }

  // query_contact_by_name: buscar contato por nome
  const contactLookupName = resolveInternalContactLookupName(msg)
  if (contactLookupName) {
    return { intent: "query_contact_by_name", slots: { name: contactLookupName } }
  }

  // query_appointment_by_time: horário explícito (ex: "quem tem às 14h", "14:00")
  if (
    timedAgendaSlots &&
    /\b(quem|qual|dados?|informacoes?|informações?|cliente|paciente|agendamento|tem)\b/.test(msg)
  ) {
    return { intent: "query_appointment_by_time", slots: timedAgendaSlots }
  }
  // Também: "às 14h", "14:00" sozinho (contexto de agenda)
  if (timedAgendaSlots && /\b(as|a|às)\s*\d/.test(msg)) {
    return { intent: "query_appointment_by_time", slots: timedAgendaSlots }
  }

  // create_appointment_internal: criar, agendar, marcar (para dono criar em nome de cliente)
  if (
    /\b(criar|agendar|marcar|cadastrar)\s+(um\s+)?(agendamento|compromisso|horario|consulta)\b/.test(msg) ||
    /\b(quero\s+)?(agendar|marcar)\s+para\b/.test(msg)
  ) {
    return {
      intent: "create_appointment_internal",
      slots: resolveInternalBaseIntentSlots({
        text,
        fallbackDate: todayIso,
        includeName: true,
      }),
    }
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

function buildHandledInternalResult(params: {
  message: string
  state?: SimulatorState
  action_options?: string[]
}): HandleInternalIntentResult {
  return {
    handled: true,
    message: params.message,
    state: params.state,
    action_options: params.action_options,
  }
}

function buildUnhandledInternalResult(): HandleInternalIntentResult {
  return {
    handled: false,
    message: "",
  }
}

function buildClearedPendingInternalResult(params: {
  incomingState?: SimulatorState
  clearKey: "quote_pending" | "appointment_pending"
  message: string
}): HandleInternalIntentResult {
  const { incomingState, clearKey, message } = params
  return buildHandledInternalResult({
    message,
    state: incomingState ? { ...incomingState, [clearKey]: undefined } : incomingState,
  })
}

function buildPendingInternalResult(params: {
  incomingState?: SimulatorState
  pendingKey: "quote_pending" | "appointment_pending"
  pendingValue: Record<string, unknown>
  message: string
  action_options?: string[]
}): HandleInternalIntentResult {
  const { incomingState, pendingKey, pendingValue, message, action_options } = params
  return buildHandledInternalResult({
    message,
    state: {
      ...(incomingState || {}),
      [pendingKey]: pendingValue,
    } as SimulatorState,
    action_options,
  })
}

function resolveInternalPendingDeclineResult(params: {
  incomingState?: SimulatorState
  pendingKey: "quote_pending" | "appointment_pending"
}): HandleInternalIntentResult | null {
  const { incomingState, pendingKey } = params
  if (!(incomingState as any)?.[pendingKey]) return null

  return buildClearedPendingInternalResult({
    incomingState,
    clearKey: pendingKey,
    message:
      pendingKey === "quote_pending"
        ? "Ok, sem problema. O orçamento não foi salvo."
        : "Ok, o agendamento não foi criado.",
  })
}

async function runInternalPendingCompletion(params: {
  incomingState?: SimulatorState
  clearKey: "quote_pending" | "appointment_pending"
  errorContext: string
  errorMessage: string
  onExecute: () => Promise<string>
}): Promise<HandleInternalIntentResult> {
  const { incomingState, clearKey, errorContext, errorMessage, onExecute } = params
  try {
    const successMessage = await onExecute()
    return buildClearedPendingInternalResult({
      incomingState,
      clearKey,
      message: successMessage,
    })
  } catch (err) {
    console.error(`internal intent ${errorContext} error:`, err)
    return buildClearedPendingInternalResult({
      incomingState,
      clearKey,
      message: errorMessage,
    })
  }
}

async function queryActiveAppointmentsByDate(params: {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  dateIso: string
  select: string
}) {
  const { supabaseAdmin, tenantId, agentId, dateIso, select } = params
  const start = `${dateIso}T00:00:00.000-03:00`
  const end = `${dateIso}T23:59:59.999-03:00`
  return await supabaseAdmin
    .from("appointment")
    .select(select)
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .neq("status", "cancelled")
    .gte("start_at", start)
    .lte("start_at", end)
}

async function queryContactsByIds(params: {
  supabaseAdmin: any
  ids: string[]
}) {
  const { supabaseAdmin, ids } = params
  if (ids.length === 0) return { data: [], error: null }
  return await supabaseAdmin
    .from("contact")
    .select("id, phone, display_name")
    .in("id", ids)
}

async function queryContactsByTerm(params: {
  supabaseAdmin: any
  tenantId: string
  term: string
}) {
  const { supabaseAdmin, tenantId, term } = params
  return await supabaseAdmin
    .from("contact")
    .select("id, display_name, phone, external_id")
    .eq("tenant_id", tenantId)
    .or(`display_name.ilike.${term},phone.ilike.${term}`)
    .limit(10)
}

async function queryAppointmentsByDate(params: {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  dateIso: string
}) {
  return await queryActiveAppointmentsByDate({
    ...params,
    select: "attendee_name, staff_name, service_names, start_at, status",
  })
    .order("start_at", { ascending: true })
}

async function queryOverlappingAppointments(params: {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  startAt: string
  endAt: string
}) {
  const { supabaseAdmin, tenantId, agentId, startAt, endAt } = params
  return await supabaseAdmin
    .from("appointment")
    .select("id, attendee_name, start_at")
    .eq("tenant_id", tenantId)
    .eq("agent_id", agentId)
    .neq("status", "cancelled")
    .lt("start_at", endAt)
    .gt("end_at", startAt)
}

async function queryActiveQuoteServices(params: {
  supabaseAdmin: any
  agentId: string
}) {
  const { supabaseAdmin, agentId } = params
  return await supabaseAdmin
    .from("quote_service")
    .select(
      "id, agent_id, name, pricing_type, variables_schema, pricing_rules, external_variable_keys, keywords, active"
    )
    .eq("agent_id", agentId)
    .eq("active", true)
}

function validateInternalAppointmentDraft(params: {
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    min_booking_lead_minutes?: number
  }
  services: Array<{ name: string; duration_minutes?: number }>
  dateIso: string
  timeStr?: string
  attendeeName?: string
  serviceName?: string | null
}): { message?: string; duration?: number; normalizedServiceName?: string } {
  const { schedule, services, dateIso, timeStr, attendeeName, serviceName } = params

  if (!timeStr) {
    return { message: "Para criar o agendamento, informe o horário (ex.: às 14h, 14:00)." }
  }
  if (!attendeeName || attendeeName.length < 2) {
    return { message: "Qual o nome do cliente? (ex.: agendar para João Silva amanhã 14h)" }
  }
  if (!serviceName) {
    const svcList = services.slice(0, 5).map((s) => s.name).join(", ")
    return {
      message: `Qual serviço? ${svcList ? `Opções: ${svcList}` : "Informe o nome do serviço."}`,
    }
  }

  const duration = getServiceDurationMinutes({ services } as any, serviceName) ?? 60
  const scheduleForValidation = schedule
    ? {
        start_time: schedule.start_time || "09:00",
        end_time: schedule.end_time || "18:00",
        breaks: schedule.breaks,
      }
    : undefined
  const within = isWithinSchedule(timeStr, scheduleForValidation)
  if (!within.ok) {
    return { message: within.reason || "Horário fora do expediente." }
  }
  if (isTimeTooSoonForDate(dateIso, timeStr, schedule?.min_booking_lead_minutes ?? 20)) {
    return {
      message: "Esse horário está muito próximo. Escolha um horário com pelo menos 20 min de antecedência.",
    }
  }

  const dayKey = getWeekdayKey(dateIso)
  const days = schedule?.days_of_week || ["monday", "tuesday", "wednesday", "thursday", "friday"]
  if (!days.includes(dayKey)) {
    return { message: `Não atendemos nesse dia. Nossa agenda: ${days.join(", ")}.` }
  }

  return {
    duration,
    normalizedServiceName: serviceName,
  }
}

function resolveInternalQuoteService(params: {
  quoteServices: QuoteServiceRow[]
}): { service?: QuoteServiceRow; message?: string } {
  const { quoteServices } = params
  if (quoteServices.length === 0) {
    return {
      message:
        "Ainda não há serviços de orçamento configurados. Configure na área logada (serviços de orçamento) para usar esta função.",
    }
  }

  return { service: quoteServices[0] }
}

function resolveTimeWindowBounds(timeStr: string): {
  targetMins: number
  minMins: number
  maxMins: number
} {
  const targetMins = toMinutes(timeStr)
  return {
    targetMins,
    minMins: targetMins - TIME_TOLERANCE_MINUTES,
    maxMins: targetMins + TIME_TOLERANCE_MINUTES,
  }
}

function filterAppointmentsByTimeWindow(params: {
  rows: any[]
  minMins: number
  maxMins: number
}): any[] {
  const { rows, minMins, maxMins } = params
  return (rows || []).filter((r: any) => {
    const { time } = toBusinessDateTime(r.start_at)
    const mins = toMinutes(time)
    return mins >= minMins && mins <= maxMins
  })
}

async function ensureInternalContactId(params: {
  supabaseAdmin: any
  tenantId: string
  channelId?: string
  attendeeName: string
}): Promise<string | null> {
  const { supabaseAdmin, tenantId, channelId, attendeeName } = params
  if (!channelId) return null

  const { data: existing } = await supabaseAdmin
    .from("contact")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("display_name", attendeeName)
    .limit(1)
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data: newContact } = await supabaseAdmin
    .from("contact")
    .insert({
      tenant_id: tenantId,
      channel_id: channelId,
      external_id: `internal:${attendeeName}:${Date.now()}`,
      display_name: attendeeName,
      phone: "",
    })
    .select("id")
    .single()

  return newContact?.id ?? null
}

function formatAppointmentAgendaMessage(params: {
  rows: any[]
  label: string
}): string {
  const { rows, label } = params
  const items = (rows || []).map((r: any) => {
    const { time } = toBusinessDateTime(r.start_at)
    const svc =
      Array.isArray(r.service_names) && r.service_names.length > 0 ? r.service_names.join(", ") : "—"
    return `${time} – ${r.attendee_name || "—"} (${r.staff_name || "—"}) – ${svc}`
  })
  return items.length > 0 ? `📅 ${label}:\n${items.join("\n")}` : `📅 ${label}: Nenhum agendamento.`
}

function formatAppointmentWindowMessage(params: {
  rows: any[]
  contactPhones: Record<string, string>
  timeStr: string
}): string {
  const { rows, contactPhones, timeStr } = params
  const lines = rows.slice(0, 3).map((r: any) => {
    const { time } = toBusinessDateTime(r.start_at)
    const svc = Array.isArray(r.service_names) && r.service_names.length > 0 ? r.service_names.join(", ") : "—"
    const phone = r.contact_id ? contactPhones[r.contact_id] || "—" : "—"
    return `${time} – ${r.attendee_name || "—"} | Tel: ${phone} | ${svc}`
  })
  const suffix = rows.length > 3 ? `\n(E mais ${rows.length - 3} agendamento(s) nessa faixa.)` : ""
  return `📅 Por volta das ${timeStr}:\n${lines.join("\n")}${suffix}`
}

function formatContactLookupMessage(params: {
  contacts: any[]
  searchName: string
}): string {
  const { contacts, searchName } = params
  if (contacts.length === 0) {
    return `Nenhum contato encontrado para "${searchName}".`
  }

  if (contacts.length === 1) {
    const c = contacts[0]
    const name = c.display_name || c.external_id || "—"
    return `📇 ${name}\nTel: ${c.phone || "—"}`
  }

  const lines = contacts.slice(0, 5).map((c: any, i: number) => {
    const name = c.display_name || c.external_id || c.phone || "—"
    return `${i + 1}. ${name} – ${c.phone || "—"}`
  })
  return `Encontrei ${contacts.length} contato(s):\n${lines.join("\n")}\n\nQual deles? (informe o número ou nome completo)`
}

async function resolveInternalAgendaQuery(params: {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  dateIso: string
  label: string
  errorContext:
    | "query_appointments_today"
    | "query_appointments_tomorrow"
    | "query_appointments_by_date"
}): Promise<HandleInternalIntentResult> {
  const { supabaseAdmin, tenantId, agentId, dateIso, label, errorContext } = params
  const { data: rows, error } = await queryAppointmentsByDate({
    supabaseAdmin,
    tenantId,
    agentId,
    dateIso,
  })

  if (error) {
    console.error(`internal intent ${errorContext} error:`, error)
    return buildHandledInternalResult({ message: "Não consegui consultar a agenda. Tente novamente." })
  }

  return buildHandledInternalResult({
    message: formatAppointmentAgendaMessage({ rows: rows || [], label }),
  })
}

async function findInternalAppointmentsAroundTime(params: {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  dateIso: string
  timeStr: string
  select: string
  errorContext: "query_appointment_by_time" | "cancel_appointment"
  errorMessage: string
}): Promise<
  | { ok: true; matches: any[] }
  | { ok: false; result: HandleInternalIntentResult }
> {
  const { supabaseAdmin, tenantId, agentId, dateIso, timeStr, select, errorContext, errorMessage } = params
  const { minMins, maxMins } = resolveTimeWindowBounds(timeStr)
  const { data: rows, error } = await queryActiveAppointmentsByDate({
    supabaseAdmin,
    tenantId,
    agentId,
    dateIso,
    select,
  })

  if (error) {
    console.error(`internal intent ${errorContext} error:`, error)
    return {
      ok: false,
      result: buildHandledInternalResult({ message: errorMessage }),
    }
  }

  return {
    ok: true,
    matches: filterAppointmentsByTimeWindow({
      rows: rows || [],
      minMins,
      maxMins,
    }),
  }
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

  if (isQuoteDecline(message) && incomingState?.quote_pending) {
    return buildClearedPendingInternalResult({
      incomingState,
      clearKey: "quote_pending",
      message: "Ok, sem problema. O orçamento não foi salvo.",
    })
  }

  // appointment_pending + recusa: limpar estado
  if (incomingState?.appointment_pending && isQuoteDecline(message)) {
    return buildClearedPendingInternalResult({
      incomingState,
      clearKey: "appointment_pending",
      message: "Ok, o agendamento não foi criado.",
    })
  }

  // confirm_appointment: estado tem appointment_pending e usuário confirmou
  if (incomingState?.appointment_pending && isQuoteConfirmation(message)) {
    const pending = incomingState.appointment_pending
    return await runInternalPendingCompletion({
      incomingState,
      clearKey: "appointment_pending",
      errorContext: "confirm_appointment",
      errorMessage: "Ocorreu um erro ao criar o agendamento. Tente novamente.",
      onExecute: async () => {
      const startAt = `${pending.date}T${pending.time}:00.000-03:00`
      const endMins = toMinutes(pending.time) + pending.duration_minutes
      const endTime = fromMinutes(endMins)
      const endAt = `${pending.date}T${endTime}:00.000-03:00`

      const contactId = await ensureInternalContactId({
        supabaseAdmin,
        tenantId,
        channelId: params.channelId,
        attendeeName: pending.attendee_name,
      })

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
        throw insertErr
      }

        return `✅ Agendamento criado: ${pending.attendee_name}, ${pending.service_name}, ${formatDatePt(pending.date)} às ${pending.time}.`
      },
    })
  }

  // confirm_quote_pdf: estado tem quote_pending e usuário confirmou (Sim, Confirmar, etc.)
  if (incomingState?.quote_pending && isQuoteConfirmation(message)) {
    const pending = incomingState.quote_pending
    if (!conversationId) {
      return buildClearedPendingInternalResult({
        incomingState,
        clearKey: "quote_pending",
        message: "Não foi possível salvar o orçamento (conversa não identificada). Tente novamente.",
      })
    }
    return await runInternalPendingCompletion({
      incomingState,
      clearKey: "quote_pending",
      errorContext: "confirm_quote_pdf",
      errorMessage: "Ocorreu um erro ao processar. Tente novamente.",
      onExecute: async () => {
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
          throw insertErr
        }

        const totalFormatted = new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: pending.result.currency || "BRL",
        }).format(pending.result.total)
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
          return `✅ Orçamento de ${pending.service_name} (${totalFormatted}) salvo no histórico.\n\n📄 PDF gerado. Link para download (válido por 7 dias):\n${pdfResult.url}${upgradeNote}`
        }

        return `✅ Orçamento de ${pending.service_name} (${totalFormatted}) salvo no histórico. Não foi possível gerar o PDF agora; acesse pela área logada.`
      },
    })
  }

  const { intent, slots } = classifyInternalIntent(message)
  if (!intent) return buildUnhandledInternalResult()

  switch (intent) {
    case "query_appointments_today": {
      const dateIso = slots.date || todayIso
      const label = dateIso === todayIso ? "Hoje" : formatDatePt(dateIso)
      return await resolveInternalAgendaQuery({
        supabaseAdmin,
        tenantId,
        agentId,
        dateIso,
        label,
        errorContext: "query_appointments_today",
      })
    }

    case "query_appointments_tomorrow": {
      const tomorrowIso = addDaysToIsoDate(todayIso, 1)
      return await resolveInternalAgendaQuery({
        supabaseAdmin,
        tenantId,
        agentId,
        dateIso: tomorrowIso,
        label: "Amanhã",
        errorContext: "query_appointments_tomorrow",
      })
    }

    case "query_appointments_by_date": {
      const dateIso = slots.date || todayIso
      return await resolveInternalAgendaQuery({
        supabaseAdmin,
        tenantId,
        agentId,
        dateIso,
        label: formatDatePt(dateIso),
        errorContext: "query_appointments_by_date",
      })
    }

    case "query_appointment_by_time":
    case "query_contact_by_appointment_time": {
      const dateIso = slots.date || todayIso
      const timeStr = slots.time || ""
      const timeWindowLookup = await findInternalAppointmentsAroundTime({
        supabaseAdmin,
        tenantId,
        agentId,
        dateIso,
        timeStr,
        select: "attendee_name, staff_name, service_names, start_at, contact_id",
        errorContext: "query_appointment_by_time",
        errorMessage: "Não consegui consultar. Tente novamente.",
      })
      if (!timeWindowLookup.ok) return timeWindowLookup.result

      if (timeWindowLookup.matches.length === 0) {
        return buildHandledInternalResult({ message: `Nenhum agendamento encontrado por volta das ${timeStr}.` })
      }

      // Buscar telefone do contato quando houver contact_id
      const contactIds = [...new Set(timeWindowLookup.matches.map((r: any) => r.contact_id).filter(Boolean))]
      let contactPhones: Record<string, string> = {}
      if (contactIds.length > 0) {
        const { data: contacts } = await queryContactsByIds({
          supabaseAdmin,
          ids: contactIds,
        })
        for (const c of contacts || []) {
          contactPhones[c.id] = c.phone || c.display_name || "—"
        }
      }

      return buildHandledInternalResult({
        message: formatAppointmentWindowMessage({
          rows: timeWindowLookup.matches,
          contactPhones,
          timeStr,
        }),
      })
    }

    case "query_contact_by_name": {
      const searchName = slots.name?.trim()
      if (!searchName || searchName.length < 2) {
        return buildHandledInternalResult({ message: "Informe o nome para buscar (ex.: contato João)." })
      }

      const term = `%${searchName}%`
      const { data: contacts, error } = await queryContactsByTerm({
        supabaseAdmin,
        tenantId,
        term,
      })

      if (error) {
        console.error("internal intent query_contact_by_name error:", error)
        return buildHandledInternalResult({ message: "Não consegui buscar. Tente novamente." })
      }

      return buildHandledInternalResult({
        message: formatContactLookupMessage({
          contacts: contacts || [],
          searchName,
        }),
      })
    }

    case "cancel_appointment": {
      const dateIso = slots.date || todayIso
      const timeStr = slots.time

      if (!timeStr) {
        return buildHandledInternalResult({
          message: "Para cancelar, informe o horário do agendamento (ex.: cancelar o das 14h).",
        })
      }

      const timeWindowLookup = await findInternalAppointmentsAroundTime({
        supabaseAdmin,
        tenantId,
        agentId,
        dateIso,
        timeStr,
        select: "id, attendee_name, start_at",
        errorContext: "cancel_appointment",
        errorMessage: "Não consegui localizar o agendamento. Tente novamente.",
      })
      if (!timeWindowLookup.ok) return timeWindowLookup.result

      const match = timeWindowLookup.matches[0]

      if (!match) {
        return buildHandledInternalResult({ message: `Nenhum agendamento encontrado por volta das ${timeStr} em ${formatDatePt(dateIso)}.` })
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
        return buildHandledInternalResult({ message: "Não consegui cancelar. Tente novamente." })
      }

      const { time } = toBusinessDateTime(match.start_at)
      return buildHandledInternalResult({
        message: `✅ Agendamento de ${match.attendee_name || "—"} às ${time} foi cancelado.`,
      })
    }

    case "create_appointment_internal": {
      const schedule = params.config?.schedule
      const services = resolveConfiguredServicesFromConfig(params.config)
      const dateIso = slots.date || getTodayIsoBusinessTz()
      const timeStr = slots.time
      const serviceName = slots.service || findServiceFromText(message, services)
      const attendeeName = slots.name || extractAttendeeNameFromMessage(message)
      const appointmentDraft = validateInternalAppointmentDraft({
        schedule,
        services,
        dateIso,
        timeStr,
        attendeeName: attendeeName || undefined,
        serviceName,
      })
      if (appointmentDraft.message) {
        return buildHandledInternalResult({ message: appointmentDraft.message })
      }

      const duration = appointmentDraft.duration ?? 60
      const normalizedServiceName = appointmentDraft.normalizedServiceName || serviceName

      const startAt = `${dateIso}T${timeStr}:00.000-03:00`
      const endMins = toMinutes(timeStr) + duration
      const endAt = `${dateIso}T${fromMinutes(endMins)}:00.000-03:00`
      const { data: conflicts } = await queryOverlappingAppointments({
        supabaseAdmin,
        tenantId,
        agentId,
        startAt,
        endAt,
      })

      if (Array.isArray(conflicts) && conflicts.length > 0) {
        const first = conflicts[0] as any
        const { time } = toBusinessDateTime(first.start_at)
        return buildHandledInternalResult({
          message: `Já existe agendamento às ${time} (${first.attendee_name || "—"}). Escolha outro horário.`,
        })
      }

      return buildPendingInternalResult({
        incomingState,
        pendingKey: "appointment_pending",
        pendingValue: {
          date: dateIso,
          time: timeStr,
          service_name: normalizedServiceName,
          attendee_name: attendeeName.trim(),
          duration_minutes: duration,
        },
        message: `Confirma: **${attendeeName.trim()}**, ${normalizedServiceName}, ${formatDatePt(dateIso)} às ${timeStr}?`,
        action_options: ["Sim", "Não"],
      })
    }

    case "request_quote_internal": {
      // Carregar quote_service do agente
      const { data: quoteServices, error: qsError } = await queryActiveQuoteServices({
        supabaseAdmin,
        agentId,
      })

      if (qsError) {
        console.error("internal intent request_quote_internal quote_service error:", qsError)
        return buildHandledInternalResult({ message: "Não consegui carregar os serviços de orçamento. Tente novamente." })
      }

      const services = (quoteServices || []) as QuoteServiceRow[]
      const quoteServiceSelection = resolveInternalQuoteService({
        quoteServices: services,
      })
      if (quoteServiceSelection.message) {
        return buildHandledInternalResult({
          message: quoteServiceSelection.message,
        })
      }

      // Usar o primeiro serviço (MVP: um por agente; futuro: detectar por keywords)
      const service = quoteServiceSelection.service!
      const schema = (service.variables_schema || []) as Array<{ key: string; label?: string; required?: boolean }>

      const slots: QuoteSlots = extractQuoteSlotsFromText(message)
      const validation = validateQuoteSlots(schema, slots)

      if (!validation.valid) {
        const missingList = validation.missing.join(", ")
        return buildHandledInternalResult({
          message: `Para o orçamento de ${service.name}, preciso de: ${missingList}. Informe na mensagem (ex.: cortina 2,80 x 2,60 blackout wave com instalação).`,
        })
      }

      const calcResult = calculateQuote(service, slots)
      const formatted = formatInternalQuote(calcResult)

      return buildPendingInternalResult({
        incomingState,
        pendingKey: "quote_pending",
        pendingValue: {
          service_id: service.id,
          service_name: service.name,
          slots: slots as Record<string, unknown>,
          result: calcResult,
        },
        message: `${formatted}\n\nDeseja gerar o PDF do orçamento?`,
        action_options: ["Sim", "Não"],
      })
    }

    default:
      return buildUnhandledInternalResult()
  }
}

// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import {
  json,
  corsHeaders,
  createSupabaseAdmin,
  rewriteWithTone,
  normalizeText,
  toMinutes,
  fromMinutes,
  toIsoDate,
  formatDatePt,
  getWeekdayKey,
  hashString,
  pickVariant,
  parseTime,
  parseDate,
  parseWeekdayDate,
  parseTimePeriod,
  parseDateOrWeekday,
  parseEmail,
  parsePhone,
  hasExplicitDate,
  parseTemplateChoice,
  resolveOptionByNumber,
  formatTimePeriod,
  buildDailySlots,
  applyBreaks,
  getMockAvailability,
  isWithinSchedule,
  isBusinessClosedForToday,
  getTodayIsoBusinessTz,
  isTimeTooSoonForDate,
  MIN_BOOKING_LEAD_MINUTES,
  isGreeting,
  isWhoAreYou,
  getGreetingByTime,
  isConfused,
  isEndTestCommand,
  isFinalizedState,
  isPriceQuestion,
  isListServicesQuestion,
  isServiceDetailQuestion,
  isExplicitBookingIntent,
  looksLikeAttendeeName,
  isVisitRequest,
  isAvailabilityQuestion,
  isYes,
  isNo,
  isPoliteDecline,
  isDirectServiceInquiry,
  isConfirmAction,
  isDonePhrase,
  isThanksOrClosingPhrase,
  detectModeFromText,
  findServiceByExactMatch,
  findServiceFromText,
  findServicesFromText,
  getServiceWithPrice,
  getServiceDurationMinutes,
  getServicesTotalDuration,
  getServicesTotalPrice,
  parseServiceNames,
  getStaffList,
  resolveStaffFromText,
  isAnyStaffRequest,
  getScheduleForStaff,
  getOtherStaffOptions,
  buildStaffDayOptions,
  getNextAvailableSlot,
  getCordialPrefix,
  getGreetingMessage,
  buildListServicesMessage,
  buildBookingConfirmationIntro,
  buildPriceNotAvailableMessage,
  buildDayNotServedMessage,
  buildDateBlockedMessage,
  buildAvailabilityForDateMessage,
  buildServicesListWithPrices,
  buildGenericFallback,
  buildClarificationMessage,
  buildServiceOptions,
  buildServicePrompt,
  buildMultiBookingIntro,
  buildAdditionalBookingAfterCompletePrompt,
  buildSingleAdditionalPrompt,
  buildMultiBookingSummary,
  buildFinalThanksMessage,
  buildRejectionMessage,
  generateRejectionMessageWithAI,
  interpretFlowWithAI,
  interpretAdditionalBookingsWithAI,
  interpretSlotsFromMessageWithAI,
  createSimulatorState,
  buildResult,
  resetSlotsForNextBooking,
  addDaysToIsoDate,
  addBookedSlot,
  buildCalendarIcs,
  uploadCalendarIcs,
  buildFinalBookingMessage,
  classifyServiceMatch,
  areaMatchesServices,
  hasMatchContext,
  hasAdditionalBookings,
  applyAdditionalBookingState,
  handleShortDecline,
  tryAnswerInformationalQuestion,
  isMyBookingQuestion,
  getMyBookingAnswer,
  answerWithContextualAI,
  generateAvailabilityResponseWithAI,
  extractContactPreferenceFromText,
  isDateBlocked,
  shouldBlockByTargetAudience,
  buildTargetAudienceRestrictionMessage,
  buildAudienceClarificationMessage,
  needsAudienceClarification,
  handleInternalIntent,
  tryHandleExternalQuote,
} from "./lib/index.ts"
import type {
  ConversationTurnRequest,
  ConversationTurnResponse,
  FlowOrchestratorOutput,
  SimulatorConfig,
  SimulatorState,
  SimulatorResult,
} from "./lib/index.ts"

// ---- funções movidas para lib/ ----
// Removido dead code: isAdditionalBookingRequest, extractCountFromText

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) return value
  if (typeof value !== "string") return undefined
  const normalized = value.replace(/[^\d,.-]/g, "").replace(",", ".").trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? undefined : parsed
}

function normalizeIncomingServices(
  raw: unknown
): Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }> {
  if (!Array.isArray(raw)) return []
  return raw
    .map((svc) => {
      const item = (svc || {}) as Record<string, unknown>
      const name = String(item.name || item.service_name || "").trim()
      if (!name) return null
      const duration = parseOptionalNumber(item.duration_minutes ?? item.duration ?? item.estimated_duration_minutes)
      const price = parseOptionalNumber(item.base_price ?? item.price ?? item.value)
      const description = typeof item.description === "string" ? item.description : undefined
      return {
        name,
        ...(duration != null ? { duration_minutes: duration } : {}),
        ...(price != null ? { base_price: price } : {}),
        ...(description ? { description } : {}),
      }
    })
    .filter(Boolean) as Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
}

function hasAnyConfiguredPrice(
  services: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }> | undefined
): boolean {
  return Boolean(services?.some((svc) => typeof svc.base_price === "number" && !Number.isNaN(svc.base_price)))
}

async function loadServicesFromSettings(
  supabaseAdmin: any,
  tenantId: string,
  agentId?: string
): Promise<Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>> {
  if (agentId) {
    const { data: agentSetting } = await supabaseAdmin
      .from("agent_setting")
      .select("business_config")
      .eq("agent_id", agentId)
      .maybeSingle()
    const agentServices = normalizeIncomingServices(
      agentSetting?.business_config?.booking_services ?? agentSetting?.business_config?.services
    )
    if (agentServices.length > 0) return agentServices
  }

  const { data: tenantSetting } = await supabaseAdmin
    .from("tenant_setting")
    .select("business_config")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  return normalizeIncomingServices(
    tenantSetting?.business_config?.booking_services ?? tenantSetting?.business_config?.services
  )
}

async function loadServicesFromOnboardingSession(
  supabaseAdmin: any,
  sessionId?: string
): Promise<Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>> {
  if (!sessionId) return []
  const { data: onboardingSession } = await supabaseAdmin
    .from("onboarding_sessions")
    .select("collected_data")
    .eq("session_id", sessionId)
    .maybeSingle()
  return normalizeIncomingServices(
    onboardingSession?.collected_data?.booking_services ?? onboardingSession?.collected_data?.services
  )
}

function mergeServicesPreferIncoming(
  incoming: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>,
  fallback: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
): Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }> {
  const byName = new Map<string, { name: string; duration_minutes?: number; base_price?: number; description?: string }>()

  for (const svc of fallback) {
    const key = normalizeText(svc.name || "")
    if (!key) continue
    byName.set(key, { ...svc })
  }

  for (const svc of incoming) {
    const key = normalizeText(svc.name || "")
    if (!key) continue
    const base = byName.get(key) || { name: svc.name }
    byName.set(key, {
      ...base,
      ...svc,
      name: svc.name || base.name,
      duration_minutes: svc.duration_minutes ?? base.duration_minutes,
      base_price: svc.base_price ?? base.base_price,
      description: svc.description ?? base.description,
    })
  }

  return Array.from(byName.values()).filter((svc) => Boolean((svc.name || "").trim()))
}

function getEntryActionOptions(config: SimulatorConfig): string[] {
  if (config.context_mode === "quote") return ["Quero orçamento"]
  if (config.context_mode === "both") return ["Quero agendar", "Quero orçamento"]
  return ["Quero agendar"]
}

function tryHandlePriceQuestionAnytime(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState
): SimulatorResult | null {
  if (!isPriceQuestion(text)) return null

  const cordial = getCordialPrefix(config, false)
  const serviceName = findServiceFromText(text, config.services || [])
  const svc = getServiceWithPrice(config.services || [], serviceName)

  if (serviceName && svc && svc.base_price != null) {
    return buildResult(
      cordial + `O ${svc.name} esta R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
      state,
      ["Quero agendar", "Só queria saber"]
    )
  }

  if (serviceName && svc) {
    const noPrice = buildPriceNotAvailableMessage(config, serviceName)
    return buildResult(cordial + noPrice.message, state, noPrice.action_options)
  }

  const withPrice = (config.services || []).filter((s) => s.base_price != null)
  if (withPrice.length > 0) {
    return buildServicesListResult(config, state, cordial)
  }

  const noPrice = buildPriceNotAvailableMessage(config, serviceName || undefined)
  return buildResult(cordial + noPrice.message, state, noPrice.action_options)
}

function buildServicesListResult(
  config: SimulatorConfig,
  state: SimulatorState,
  prefix?: string
): SimulatorResult {
  const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
  const fullMessage = prefix ? `${prefix} ${buildServicesListWithPrices(config)}` : buildServicesListWithPrices(config)
  return buildResult(
    fullMessage,
    { ...state, last_service_options: serviceOptions },
    serviceOptions.length > 0 ? serviceOptions : undefined
  )
}

function getSequenceServicesFromText(config: SimulatorConfig, text: string): string[] {
  if (!config.allow_sequence_booking) return []
  const eligibleForSequence =
    (config.sequence_eligible_services?.length ?? 0) > 0
      ? config.sequence_eligible_services || []
      : (config.services || []).map((s) => s.name).filter(Boolean)
  return findServicesFromText(text, config.services || [], eligibleForSequence)
}

function tryResolveNumericServiceSelection(incomingText: string, state: SimulatorState): string | null {
  if (!/^[1-9]\d*$/.test(incomingText)) return null
  const serviceOptions = (state.last_service_options || []).map((s) => String(s || "").trim()).filter(Boolean)
  if (serviceOptions.length === 0) return null

  if (Array.isArray(state.last_action_options) && state.last_action_options.length > 0) {
    const byAction = resolveOptionByNumber(incomingText, state.last_action_options)
    if (byAction) {
      const exact = serviceOptions.find((s) => normalizeText(s) === normalizeText(byAction))
      if (exact) return exact
      return null
    }
  }

  if (state.step === "qualification" || (!state.slots?.service && state.step !== "booking")) {
    return resolveOptionByNumber(incomingText, serviceOptions)
  }
  return null
}

function tryHandleServicesQuestionAnytime(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState
): SimulatorResult | null {
  if (isListServicesQuestion(text)) {
    return buildServicesListResult(config, state)
  }

  if (!isServiceDetailQuestion(text)) return null

  const serviceName = findServiceFromText(text, config.services || []) || state.slots?.service || null
  const svc = getServiceWithPrice(config.services || [], serviceName)
  if (!svc) {
    const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
    if (serviceOptions.length > 0) {
      return buildResult("Claro. Sobre qual serviço você quer mais detalhes?", state, serviceOptions)
    }
    return buildResult("No momento não encontrei serviços cadastrados para detalhar.", state)
  }

  const duration = getServiceDurationMinutes(config, svc.name)
  const parts = [`Sobre ${svc.name}:`]
  if (svc.description) parts.push(svc.description)
  if (duration != null) parts.push(`Duração média: ${duration} min.`)
  if (svc.base_price != null) parts.push(`Valor: R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}.`)
  return buildResult(parts.join(" "), state, ["Quero agendar", "Só queria saber"])
}

/** Responde perguntas sobre disponibilidade em um horário específico em qualquer momento da conversa (evita IA inventar "intervalo" em vez de pausa/expediente). */
async function tryHandleAvailabilityQuestionAnytime(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState,
  history: Array<{ role: string; content: string }>
): Promise<SimulatorResult | null> {
  if (/^[1-9]\d*$/.test(text.trim())) return null
  const timeFromText = parseTime(text)
  if (!timeFromText) return null
  const hasAvailabilityIntent =
    isAvailabilityQuestion(text) ||
    /\b(agendar|marcar)\b.*\b(as|às|as)\s*\d|quero\s+as\s+\d/.test(normalizeText(text))
  if (!hasAvailabilityIntent) return null

  const dateIso =
    parseDateOrWeekday(text) || state.slots?.date || addDaysToIsoDate(getTodayIsoBusinessTz(), 1)
  const staffList = getStaffList(config)
  const staffName = state.slots?.staff_name || staffList[0]?.name
  const schedule = getScheduleForStaff(config, staffName)
  const service =
    state.slots?.service || findServiceFromText(text, config.services || []) || (config.services || [])[0]?.name
  const duration = getServicesTotalDuration(config, service) ?? 30
  const availability = getMockAvailability(
    dateIso,
    schedule,
    state.booked_slots,
    staffName,
    duration
  )
  const normalizedTime = timeFromText.includes(":")
    ? timeFromText.replace(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/, (_, h, m) =>
        `${String(parseInt(h, 10)).padStart(2, "0")}:${String(parseInt(m, 10)).padStart(2, "0")}`
      )
    : `${timeFromText.padStart(2, "0")}:00`
  const isAvailable = availability.available.includes(normalizedTime)
  const within = !isAvailable ? isWithinSchedule(normalizedTime, schedule) : null
  const unavailableReason = within && !within.ok ? within.reason : undefined

  const fluidResponse = await generateAvailabilityResponseWithAI(
    config,
    {
      requested_time: normalizedTime,
      date_iso: dateIso,
      is_available: isAvailable,
      available_slots: availability.available.slice(0, 12),
      service: service || undefined,
      unavailable_reason: unavailableReason,
    },
    history
  )

  const nextState: SimulatorState = { ...state }
  nextState.slots = { ...nextState.slots, date: dateIso }
  if (staffName) nextState.slots.staff_name = staffName
  if (service) nextState.slots.service = service
  if (isAvailable) {
    nextState.slots.time = normalizedTime
    nextState.mode = "booking"
    nextState.step = undefined
  }

  const options =
    availability.available.length > 0
      ? isAvailable
        ? [`Sim, ${normalizedTime}`, "Outro horario", ...(getOtherStaffOptions(config, staffName).length > 0 ? ["Outro colaborador"] : [])]
        : availability.available.slice(0, 8).map((t, i) => `${i + 1} - ${t}`)
      : ["Quero agendar"]

  return buildResult(fluidResponse, nextState, options)
}

type ConversationRuntimeContext = {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  /** FASE 7: true = client/unknown (external); bloqueia cancelamento e consulta de agenda. */
  isExternalActor?: boolean
  contactId?: string
  contact?: { display_name?: string | null }
  senderDisplayName?: string
  history: Array<{ role: string; content: string }>
  config: SimulatorConfig
}

type CancelableAppointment = {
  id: string
  attendee_name?: string | null
  staff_name?: string | null
  service_names?: string[] | null
  start_at?: string | null
  status?: string | null
}

const CANCEL_REASON_OPTIONS = [
  "Mudou de planos",
  "Não poderá comparecer no horário",
  "Encontrou outro horário melhor",
  "Quero reagendar para outro dia",
  "Outro motivo",
  "Prefiro não responder",
]

function isCancellationIntent(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /(cancel|cancelar|cancelamento|desmarc|desmarcar|desmarca|nao vou poder|nao poderei|nao consigo ir|nao vou conseguir)/.test(msg) ||
    /(quero cancelar|preciso cancelar|gostaria de cancelar)/.test(msg)
  )
}

function cleanupCancellationState(state: SimulatorState): SimulatorState {
  const next = { ...state }
  next.pending_cancel_selection = undefined as any
  next.pending_cancel_confirm = undefined as any
  next.pending_cancel_reason = undefined as any
  next.pending_cancel_reason_custom = undefined as any
  next.pending_cancel_reschedule = undefined as any
  next.cancel_candidates = undefined as any
  next.cancel_target_id = undefined as any
  next.cancel_target_snapshot = undefined as any
  next.cancel_reason = undefined as any
  return next
}

function getCancellationIdentityHints(
  state: SimulatorState,
  runtime: ConversationRuntimeContext
): string[] {
  const hints = new Set<string>()
  const maybePush = (v: unknown) => {
    const raw = String(v || "").trim()
    if (!raw) return
    const n = normalizeText(raw)
    if (!n || n === "cliente") return
    hints.add(n)
  }
  maybePush(state.slots?.attendee_name)
  maybePush(state.slots?.customer_name)
  maybePush(state.last_booking?.attendee_name)
  maybePush(runtime.senderDisplayName)
  maybePush(runtime.contact?.display_name)
  for (const booking of state.completed_bookings || []) maybePush(booking.attendee_name)
  return Array.from(hints)
}

function formatAppointmentOption(appt: CancelableAppointment): string {
  const startAt = appt.start_at ? new Date(appt.start_at) : null
  const date = startAt
    ? startAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "data não identificada"
  const time = startAt
    ? startAt.toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "--:--"
  const service = Array.isArray(appt.service_names) && appt.service_names.length > 0 ? appt.service_names.join(", ") : "serviço"
  const staff = appt.staff_name ? ` com ${appt.staff_name}` : ""
  return `${service} em ${date} às ${time}${staff}`
}

function filterAppointmentsByText(
  appointments: CancelableAppointment[],
  text: string
): CancelableAppointment[] {
  let filtered = [...appointments]
  const dateMention = parseDateOrWeekday(text)
  const timeMention = parseTime(text)
  if (dateMention) {
    filtered = filtered.filter((a) => (a.start_at || "").startsWith(dateMention))
  }
  if (timeMention) {
    filtered = filtered.filter((a) => {
      if (!a.start_at) return false
      const hhmm = new Date(a.start_at).toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      return hhmm === timeMention
    })
  }
  return filtered
}

async function findCancelableAppointments(
  runtime: ConversationRuntimeContext,
  state: SimulatorState,
  text: string
): Promise<{ candidates: CancelableAppointment[]; usedIdentityHints: boolean }> {
  const todayIso = getTodayIsoBusinessTz()
  const fetchCandidates = async (byContact: boolean) => {
    let query = runtime.supabaseAdmin
      .from("appointment")
      .select("id, attendee_name, staff_name, service_names, start_at, status")
      .eq("tenant_id", runtime.tenantId)
      .eq("agent_id", runtime.agentId)
      .in("status", ["confirmed", "open", "pending"])
      .gte("start_at", `${todayIso}T00:00:00.000-03:00`)
      .order("start_at", { ascending: true })
      .limit(60)
    if (byContact && runtime.contactId) {
      query = query.eq("contact_id", runtime.contactId)
    }
    return await query
  }

  let { data, error } = await fetchCandidates(true)
  if ((!data || data.length === 0) && runtime.contactId) {
    const fallback = await fetchCandidates(false)
    data = fallback.data
    error = fallback.error
  }

  if (error) {
    console.error("cancel lookup error:", error)
    return { candidates: [], usedIdentityHints: false }
  }

  const all = (data || []) as CancelableAppointment[]
  let filtered = filterAppointmentsByText(all, text)
  const hints = getCancellationIdentityHints(state, runtime)
  if (hints.length > 0) {
    const byName = filtered.filter((a) => {
      const attendee = normalizeText(String(a.attendee_name || ""))
      return hints.some((h) => attendee.includes(h) || h.includes(attendee))
    })
    if (byName.length > 0) {
      return { candidates: byName, usedIdentityHints: true }
    }
  }

  if (filtered.length === 0) filtered = all
  return { candidates: filtered, usedIdentityHints: false }
}

function buildCancellationSuccessMessage(snapshot?: CancelableAppointment | null): string {
  if (!snapshot) return "Pronto, seu agendamento foi cancelado com sucesso."
  return `Pronto, cancelei ${formatAppointmentOption(snapshot)}.`
}

function prefillRescheduleStateFromCancelledAppointment(
  state: SimulatorState,
  cancelled?: CancelableAppointment | null
): SimulatorState {
  if (!cancelled) return state
  const serviceJoined =
    Array.isArray(cancelled.service_names) && cancelled.service_names.length > 0
      ? cancelled.service_names.join(", ")
      : undefined
  return {
    ...state,
    mode: "booking",
    step: undefined,
    pending_cancel_reschedule: undefined as any,
    slots: {
      ...state.slots,
      attendee_name: cancelled.attendee_name || state.slots?.attendee_name,
      service: serviceJoined || state.slots?.service,
      staff_name: cancelled.staff_name || state.slots?.staff_name,
      date: undefined,
      time: undefined,
      time_period: undefined,
    },
  }
}

async function tryHandleCancellationAnytime(
  runtime: ConversationRuntimeContext,
  text: string,
  state: SimulatorState,
  senderDisplayName?: string
): Promise<SimulatorResult | null> {
  // FASE 7: Cliente (external) não pode cancelar via chat; apenas owner/admin.
  if (runtime.isExternalActor && isCancellationIntent(text)) {
    return buildResult(
      "Para cancelar ou alterar seu agendamento, entre em contato conosco.",
      { ...state }
    )
  }
  const isPendingFlow = Boolean(
    (state as any).pending_cancel_selection ||
      (state as any).pending_cancel_confirm ||
      (state as any).pending_cancel_reason ||
      (state as any).pending_cancel_reason_custom ||
      (state as any).pending_cancel_reschedule
  )
  if (!isPendingFlow && !isCancellationIntent(text)) return null

  const nextState: SimulatorState = { ...state }
  const msg = normalizeText(text)

  if ((nextState as any).pending_cancel_selection) {
    const candidates = ((nextState as any).cancel_candidates || []) as CancelableAppointment[]
    const options = candidates.map((c) => formatAppointmentOption(c))
    const resolved = resolveOptionByNumber(text, options)
    const selected =
      resolved != null
        ? candidates[options.findIndex((o) => normalizeText(o) === normalizeText(resolved))]
        : filterAppointmentsByText(candidates, text)[0]
    if (!selected) {
      return buildResult("Não consegui identificar qual agendamento você quer cancelar. Escolha uma opção da lista.", nextState, options)
    }
    ;(nextState as any).cancel_target_id = selected.id
    ;(nextState as any).cancel_target_snapshot = selected
    ;(nextState as any).pending_cancel_selection = undefined
    ;(nextState as any).pending_cancel_confirm = true
    return buildResult(`Confirma o cancelamento de ${formatAppointmentOption(selected)}?`, nextState, ["Sim, cancelar", "Não, manter"])
  }

  if ((nextState as any).pending_cancel_confirm) {
    if (isNo(msg)) {
      return buildResult("Perfeito, mantive seu agendamento como está.", cleanupCancellationState(nextState))
    }
    if (!isYes(msg) && !/(cancelar|confirmar)/.test(msg)) {
      return buildResult("Posso cancelar agora. Você confirma o cancelamento?", nextState, ["Sim, cancelar", "Não, manter"])
    }
    ;(nextState as any).pending_cancel_confirm = undefined
    ;(nextState as any).pending_cancel_reason = true
    return buildResult(
      "Antes de concluir, você pode me informar o motivo do cancelamento?",
      nextState,
      CANCEL_REASON_OPTIONS
    )
  }

  if ((nextState as any).pending_cancel_reason_custom) {
    ;(nextState as any).cancel_reason = text.trim() || "Outro motivo"
    ;(nextState as any).pending_cancel_reason_custom = undefined
    ;(nextState as any).pending_cancel_reason = undefined
  } else if ((nextState as any).pending_cancel_reason) {
    const resolved = resolveOptionByNumber(text, CANCEL_REASON_OPTIONS) || text.trim()
    const normalized = normalizeText(resolved)
    if (!resolved) {
      return buildResult("Pode me dizer o motivo do cancelamento?", nextState, CANCEL_REASON_OPTIONS)
    }
    if (normalized.includes("outro")) {
      ;(nextState as any).pending_cancel_reason_custom = true
      return buildResult("Perfeito. Pode escrever o motivo com suas palavras?", nextState)
    }
    ;(nextState as any).cancel_reason = resolved
    ;(nextState as any).pending_cancel_reason = undefined
  }

  if (!(nextState as any).pending_cancel_reason && !(nextState as any).pending_cancel_reason_custom) {
    const targetId = (nextState as any).cancel_target_id as string | undefined
    if (!targetId) {
      return buildResult(
        "Não encontrei qual agendamento devo cancelar. Me diga a data e horário (ex: sexta às 14:00).",
        cleanupCancellationState(nextState)
      )
    }

    const { error: cancelError } = await runtime.supabaseAdmin
      .from("appointment")
      .update({
        status: "cancelled",
        cancellation_reason: (nextState as any).cancel_reason || null,
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", targetId)
      .eq("tenant_id", runtime.tenantId)
      .eq("agent_id", runtime.agentId)
      .neq("status", "cancelled")
    if (cancelError) {
      console.error("cancel update error:", cancelError)
      return buildResult(
        "Tive um problema para cancelar agora. Pode tentar novamente em instantes?",
        cleanupCancellationState(nextState)
      )
    }

    ;(nextState as any).pending_cancel_reschedule = true
    const snapshot = ((nextState as any).cancel_target_snapshot || null) as CancelableAppointment | null
    return buildResult(
      `${buildCancellationSuccessMessage(snapshot)} Quer que eu já te ajude a reagendar?`,
      nextState,
      ["Sim, reagendar agora", "Não, por enquanto"]
    )
  }

  if ((nextState as any).pending_cancel_reschedule) {
    const shouldReschedule = isYes(msg) || /(reagendar|remarcar|sim)/.test(msg)
    if (!shouldReschedule) {
      return buildResult(
        "Sem problemas. Quando quiser remarcar, é só me chamar.",
        cleanupCancellationState(nextState)
      )
    }

    const snapshot = ((nextState as any).cancel_target_snapshot || null) as CancelableAppointment | null
    const preparedState = prefillRescheduleStateFromCancelledAppointment(nextState, snapshot)
    const cleanState = cleanupCancellationState(preparedState)
    const reschedule = await resolveBooking(runtime.config, "quero reagendar", cleanState, runtime.history, senderDisplayName)
    return buildResult(`Perfeito, vamos reagendar. ${reschedule.message}`, reschedule.state, reschedule.action_options)
  }

  const lookup = await findCancelableAppointments(runtime, nextState, text)
  const candidates = lookup.candidates
  if (candidates.length === 0) {
    return buildResult(
      "Não encontrei agendamento futuro para cancelar. Me informe o nome usado no agendamento e a data/horário para eu localizar.",
      cleanupCancellationState(nextState)
    )
  }

  if (!lookup.usedIdentityHints && candidates.length > 1) {
    return buildResult(
      "Encontrei mais de um agendamento. Para sua segurança, me diga a data e horário do atendimento que você quer cancelar.",
      cleanupCancellationState(nextState)
    )
  }

  if (candidates.length === 1) {
    const one = candidates[0]
    ;(nextState as any).cancel_target_id = one.id
    ;(nextState as any).cancel_target_snapshot = one
    ;(nextState as any).pending_cancel_confirm = true
    return buildResult(`Você quer cancelar ${formatAppointmentOption(one)}?`, nextState, ["Sim, cancelar", "Não, manter"])
  }

  ;(nextState as any).cancel_candidates = candidates.slice(0, 6)
  ;(nextState as any).pending_cancel_selection = true
  const options = ((nextState as any).cancel_candidates as CancelableAppointment[]).map((a) => formatAppointmentOption(a))
  return buildResult("Encontrei estes agendamentos. Qual deles você quer cancelar?", nextState, options)
}

async function resolveBooking(
  config: SimulatorConfig,
  text: string,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string
): Promise<SimulatorResult> {
  const toNumberedOptions = (options: string[]): string[] => options.map((option, idx) => `${idx + 1} - ${option}`)
  const getOtherDayOptions = (schedule?: { days_of_week?: string[] } | null): string[] => {
    const dayOptions = buildStaffDayOptions(schedule?.days_of_week || [])
    return dayOptions.length > 0 ? dayOptions : ["Outro dia"]
  }
  const nextState: SimulatorState = {
    ...state,
    step: "booking",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
    completed_bookings: state.completed_bookings ? [...state.completed_bookings] : [],
  }
  const pref = nextState.contact_preference ?? state.contact_preference ?? "both"
  const hasPhone = Boolean(nextState.slots.customer_phone)
  const hasEmail = Boolean(nextState.slots.customer_email)
  const contactOk =
    pref === "phone"
      ? hasPhone
      : pref === "email"
        ? hasEmail
        : hasPhone && hasEmail
  const bookingComplete =
    Boolean(nextState.slots.service) &&
    Boolean(nextState.slots.date) &&
    Boolean(nextState.slots.time) &&
    Boolean(nextState.slots.customer_name) &&
    contactOk
  // Cliente confirmou com frase de encerramento (ex.: "tudo certo", "confirmar") sem ter passado pelo botão "Confirmar agendamento".
  // É obrigatório fazer push em completed_bookings e atualizar booked_slots para que o insert na tabela appointment seja feito ao final do turn.
  // NÃO tratar como encerramento se está no meio da escolha de opção (ex: "Isso, mesmo dia e colaborador").
  const isConfirm =
    isDonePhrase(text) ||
    (text.trim() === "1" && Array.isArray(state.last_confirm_options) && state.last_confirm_options.length > 0)
  if (!state.pending_template_choice && !state.pending_second_service_choice && !state.pending_final_confirmation && !state.final_thanks_sent && isConfirm && bookingComplete) {
    nextState.booked_slots = addBookedSlot(
      nextState.booked_slots,
      nextState.slots.staff_name,
      nextState.slots.date,
      nextState.slots.time
    )
    if (!nextState.completed_bookings) nextState.completed_bookings = []
    nextState.completed_bookings.push({
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
    })
    const finalResult = await buildFinalBookingMessage({
      config,
      service: nextState.slots.service,
      staffName: nextState.slots.staff_name,
      dateIso: nextState.slots.date,
      time: nextState.slots.time,
    })
    nextState.final_thanks_sent = true
    nextState.slots = resetSlotsForNextBooking(nextState)
    return buildResult(finalResult.message, nextState)
  }
  const isConfirmShort =
    isDonePhrase(text) ||
    (text.trim() === "1" && Array.isArray(state.last_confirm_options) && state.last_confirm_options.length > 0)
  if (!state.pending_template_choice && !state.pending_second_service_choice && !state.pending_final_confirmation && !state.final_thanks_sent && isConfirmShort) {
    const bookings = nextState.completed_bookings || []
    if (bookings.length > 0) {
      nextState.final_thanks_sent = true
      nextState.completed_bookings = []
      return buildResult(buildFinalThanksMessage(config.business_name, bookings), nextState)
    }
  }
  // Resposta "2", "3", "4" às opções de confirmação (Outro horário, Outro dia, Trocar colaborador)
  const lastConfirm = state.last_confirm_options
  if (lastConfirm?.length && bookingComplete) {
    const choiceNum = resolveOptionByNumber(text, lastConfirm)
    if (choiceNum && !choiceNum.startsWith("Sim")) {
      nextState.last_confirm_options = undefined
      const last = nextState.last_booking
      if (choiceNum.includes("Outro horario") && last?.date && last?.staff_name) {
        const schedule = getScheduleForStaff(config, last.staff_name)
        const serviceDuration = getServicesTotalDuration(config, nextState.slots.service)
        const availability = last.date
          ? getMockAvailability(last.date, schedule, nextState.booked_slots, last.staff_name, serviceDuration ?? 30)
          : { available: [] as string[], occupied: [] as string[] }
        if (availability.available.length) {
          nextState.slots.date = last.date
          nextState.slots.staff_name = last.staff_name
          nextState.last_time_options = availability.available.slice(0, 24)
          nextState.last_time_options_date = last.date
          nextState.last_time_options_staff = last.staff_name
          return buildResult(
            "Qual horario voce prefere no mesmo dia?",
            nextState,
            toNumberedOptions(availability.available.slice(0, 24))
          )
        }
      }
      if (choiceNum.includes("Outro dia")) {
        nextState.slots.date = undefined
        nextState.slots.time = undefined
        return buildResult("Qual dia voce prefere?", nextState)
      }
      if (choiceNum.includes("Trocar colaborador") || choiceNum.includes("colaborador")) {
        nextState.slots.staff_name = undefined
        const staffOptions = [...getStaffList(config).map((s) => s.name), "Tanto faz"]
        return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
          ...toNumberedOptions(staffOptions),
        ])
      }
    }
  }

  // REGRA CRÍTICA: dígito "1"/"2"/"3" com attendee e sem data = seleção de serviço → perguntar dia, NUNCA horário
  const isDigitOnlyEarly = /^[1-9]\d*$/.test(text.trim())
  const serviceOpts = buildServiceOptions(config.services || [])
  const canResolveService = serviceOpts.length > 0 && resolveOptionByNumber(text, serviceOpts)
  if (
    isDigitOnlyEarly &&
    nextState.slots.attendee_name &&
    !nextState.slots.service &&
    !nextState.slots.date &&
    !state.last_confirm_options?.length &&
    !state.pending_template_choice &&
    !state.pending_second_service_choice &&
    canResolveService
  ) {
    const serviceFromNum = resolveOptionByNumber(text, serviceOpts)!
    nextState.slots.service = serviceFromNum === "Quero agendar uma visita" ? "visita" : serviceFromNum
    nextState.last_service_options = undefined
    // Seleção numérica de serviço deve sempre reiniciar etapa de agenda (evita herdar data/horário antigo da sessão).
    nextState.slots.date = undefined
    nextState.slots.time = undefined
    nextState.slots.time_period = undefined
    nextState.pending_date_confirmation = undefined
    nextState.last_time_options = undefined
    nextState.last_time_options_date = undefined
    nextState.last_time_options_staff = undefined
    const staffName = nextState.slots.staff_name || (getStaffList(config)[0]?.name)
    const schedule = staffName ? getScheduleForStaff(config, staffName) : null
    const days = schedule?.days_of_week || []
    const dayOpts = buildStaffDayOptions(days)
    if (!nextState.slots.staff_name && staffName) nextState.slots.staff_name = staffName
    nextState.just_identified_service = true
    return buildResult(
      `Entendi, voce precisa de ${nextState.slots.service}. Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
      nextState,
      toNumberedOptions(dayOpts)
    )
  }

  if (state.pending_final_confirmation) {
    if (isConfirmAction(text) || isYes(text)) {
      nextState.pending_final_confirmation = false
      nextState.pending_additional_booking = false
      nextState.pending_additional_count = 0
      return buildResult("Perfeito! Agendamentos confirmados. Precisa de mais alguma coisa?", nextState)
    }
    if (isNo(text)) {
      nextState.pending_final_confirmation = false
      return buildResult("Tudo bem! O que voce quer ajustar nos agendamentos?", nextState)
    }
  }

  const explicitService = findServiceFromText(text, config.services || [])
  const wasAdditionalPending = Boolean(state.pending_additional_booking || state.pending_additional_count)
  const cp = state.contact_preference ?? "both"
  const hasCompletedBooking =
    Boolean(state.slots?.service) &&
    Boolean(state.slots?.date) &&
    Boolean(state.slots?.time) &&
    Boolean(state.slots?.customer_name) &&
    (cp === "phone" ? Boolean(state.slots?.customer_phone) : cp === "email" ? Boolean(state.slots?.customer_email) : Boolean(state.slots?.customer_phone) && Boolean(state.slots?.customer_email))
  const interpretedAdditional = await interpretAdditionalBookingsWithAI(text, {
    has_completed_booking: hasCompletedBooking,
    history,
  })
  const interpretedCountRaw = typeof interpretedAdditional?.count === "number" ? interpretedAdditional.count : null
  const interpretedCount = interpretedCountRaw !== null ? Math.max(0, interpretedCountRaw) : null
  const interpretedHasAdditional =
    interpretedAdditional?.has_additional === true || (interpretedCount !== null && interpretedCount > 0)

  const lastAssistantMsg =
    state.last_prompt || (history.length > 0 ? history.filter((m) => m.role === "assistant").pop()?.content : undefined)
  const waitingFor = nextState.pending_attendee_name
    ? "attendee_name"
    : !nextState.slots.service
      ? "service"
      : !nextState.slots.date
        ? "date"
        : !nextState.slots.time
          ? "time"
          : undefined
  const slotsInterpretation =
    waitingFor || nextState.pending_attendee_name
      ? await interpretSlotsFromMessageWithAI(text, {
          waiting_for: waitingFor,
          current_slots: nextState.slots,
          services: config.services || [],
          history,
          last_assistant_message: lastAssistantMsg,
          sender_display_name: senderDisplayName,
        }, config)
      : null
  const normalizedText = normalizeText(text)
  const allowAiDateAutofill =
    hasExplicitDate(text) ||
    normalizedText.includes("hoje") ||
    normalizedText.includes("amanha")

  // Não usar slots da IA quando a mensagem é só número (ex: "1" = opção de serviço)
  const isDigitOnly = /^[1-9]\d*$/.test(text.trim())
  if (
    waitingFor === "service" &&
    slotsInterpretation?.service &&
    !nextState.slots.service &&
    !isDigitOnly
  ) {
    nextState.slots.service = slotsInterpretation.service
  }

  // Não usar data da IA para "hoje"/"amanhã" — a IA não tem data atual em tempo real.
  // Deixar parseDateOrWeekday resolver (usa getTodayIsoBusinessTz), senão o filtro de
  // horários passados falha (isTodayInBusinessTz dá false se a IA retornar data errada).
  const isHojeOuAmanha = normalizedText.includes("hoje") || normalizedText.includes("amanha")
  if (
    waitingFor === "date" &&
    slotsInterpretation?.date &&
    !nextState.slots.date &&
    !isDigitOnly &&
    allowAiDateAutofill &&
    !isHojeOuAmanha &&
    /^\d{4}-\d{2}-\d{2}$/.test(slotsInterpretation.date)
  ) {
    nextState.slots.date = slotsInterpretation.date
  }
  // Horário extraído pela IA: só aceitar se estiver na grade real (disponível, não em pausa, intervalo correto)
  if (
    waitingFor === "time" &&
    slotsInterpretation?.time &&
    !nextState.slots.time &&
    !isDigitOnly
  ) {
    const rawTime = slotsInterpretation.time
    const normalizedTime = rawTime.includes(":")
      ? rawTime.replace(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/, (_, h, m) =>
          `${String(parseInt(h, 10)).padStart(2, "0")}:${String(parseInt(m, 10)).padStart(2, "0")}`
        )
      : `${String(parseInt(rawTime, 10)).padStart(2, "0")}:00`
    const dateIsoForTime = nextState.slots.date || getTodayIsoBusinessTz()
    const staffList = getStaffList(config)
    const staffNameForTime = nextState.slots.staff_name || (staffList[0]?.name)
    const scheduleForTime = getScheduleForStaff(config, staffNameForTime)
    const availabilityForTime = getMockAvailability(
      dateIsoForTime,
      scheduleForTime,
      nextState.booked_slots,
      staffNameForTime,
      getServicesTotalDuration(config, nextState.slots.service || nextState.pending_default_service)
    )
    if (availabilityForTime.available.includes(normalizedTime)) {
      nextState.slots.time = normalizedTime
    } else {
      const within = isWithinSchedule(normalizedTime, scheduleForTime)
      const options = availabilityForTime.available.slice(0, 24)
      nextState.last_time_options = options
      nextState.last_time_options_date = dateIsoForTime
      nextState.last_time_options_staff = staffNameForTime
      const msg = !within.ok
        ? `${within.reason || "Esse horário não está disponível."} Temos: ${options.slice(0, 8).join(", ")}. Qual prefere?`
        : "Esse horário não temos disponível (não bate com nossa grade). Temos: " +
          options.slice(0, 8).join(", ") +
          ". Qual prefere?"
      return buildResult(msg, nextState, toNumberedOptions(options))
    }
  }
  if (
    waitingFor === "attendee_name" &&
    slotsInterpretation?.attendee_name &&
    !nextState.slots.attendee_name &&
    !isDigitOnly
  ) {
    nextState.slots.attendee_name = slotsInterpretation.attendee_name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = slotsInterpretation.attendee_name
  }

  // Cliente perguntou "tem horário às 14?" — consultar agenda e responder de forma fluida
  // Não executar quando msg é só número (ex: "1" = opção de serviço)
  if (slotsInterpretation?.needs_availability_check && slotsInterpretation?.time && !isDigitOnly) {
    const dateIso = nextState.slots.date || getTodayIsoBusinessTz()
    const staffList = getStaffList(config)
    const staffName = nextState.slots.staff_name || (staffList[0]?.name)
    const schedule = getScheduleForStaff(config, staffName)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    ) ?? 30
    const availability = getMockAvailability(
      dateIso,
      schedule,
      nextState.booked_slots,
      staffName,
      serviceDuration
    )
    const requestedTime = slotsInterpretation.time.includes(":")
      ? slotsInterpretation.time
      : `${String(parseInt(slotsInterpretation.time, 10)).padStart(2, "0")}:00`
    const isAvailable = availability.available.includes(requestedTime)
    const within = !isAvailable ? isWithinSchedule(requestedTime, schedule) : null
    const unavailableReason = within && !within.ok ? within.reason : undefined

    const fluidResponse = await generateAvailabilityResponseWithAI(config, {
      attendee_name: nextState.slots.attendee_name,
      requested_time: requestedTime,
      date_iso: dateIso,
      is_available: isAvailable,
      available_slots: availability.available.slice(0, 12),
      service: nextState.slots.service,
      unavailable_reason: unavailableReason,
    }, history)

    if (isAvailable) {
      nextState.slots.date = dateIso
      nextState.slots.time = requestedTime
      nextState.slots.staff_name = staffName
      nextState.pending_attendee_name = false
      const options = [
        `Sim, ${requestedTime}`,
        "Outro horario",
        ...(getOtherStaffOptions(config, staffName).length > 0 ? ["Outro colaborador"] : []),
      ]
      return buildResult(fluidResponse, nextState, options)
    }
    return buildResult(fluidResponse, nextState, availability.available.slice(0, 8))
  }

  if (!nextState.slots.service) {
    const serviceFromNumber =
      state.last_service_options?.length && resolveOptionByNumber(text, state.last_service_options)
    if (serviceFromNumber) {
      nextState.slots.service = serviceFromNumber === "Quero agendar uma visita" ? "visita" : serviceFromNumber
      nextState.last_service_options = undefined
      // Ao escolher serviço por número, não carregar data/horário previamente preenchidos.
      nextState.slots.date = undefined
      nextState.slots.time = undefined
      nextState.slots.time_period = undefined
      nextState.pending_date_confirmation = undefined
      nextState.last_time_options = undefined
      nextState.last_time_options_date = undefined
      nextState.last_time_options_staff = undefined
      // Se a GUARDA no início não pegou (ex: fluxo sem attendee), perguntar dia quando faltar data
      if (!nextState.slots.date) {
        const staffName = nextState.slots.staff_name || (getStaffList(config)[0]?.name)
        const schedule = staffName ? getScheduleForStaff(config, staffName) : null
        const days = schedule?.days_of_week || []
        const dayOpts = buildStaffDayOptions(days)
        nextState.just_identified_service = true
        if (!nextState.slots.staff_name && staffName) nextState.slots.staff_name = staffName
        return buildResult(
          `Entendi, voce precisa de ${nextState.slots.service}. Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
          nextState,
          toNumberedOptions(dayOpts)
        )
      }
    } else if (explicitService) nextState.slots.service = explicitService
    else if (isVisitRequest(text)) nextState.slots.service = "visita"
    else if (nextState.pending_default_service && nextState.pending_default_service_locked)
      nextState.slots.service = nextState.pending_default_service
  }

  // Só entrar em multi-pessoas quando a mensagem indica VÁRIAS PESSOAS (ex.: "para meu marido e meu filho"), não quando são só VÁRIOS SERVIÇOS para a mesma pessoa (ex.: "corte e barba")
  const isMultiServiceSinglePerson =
    nextState.slots.service && String(nextState.slots.service).includes(",")
  if (
    !nextState.pending_additional_count &&
    !nextState.pending_additional_booking &&
    interpretedHasAdditional &&
    !isMultiServiceSinglePerson
  ) {
    nextState.pending_additional_booking = true
    nextState.pending_attendee_name = true
    nextState.pending_additional_count = interpretedCount && interpretedCount > 0 ? interpretedCount : 1
    if (nextState.expected_additional_count === undefined) {
      nextState.expected_additional_count = nextState.pending_additional_count
    }
    if (explicitService && !nextState.pending_default_service_locked) {
      nextState.pending_default_service = explicitService
      nextState.pending_default_service_locked = true
    }
  }

  if (nextState.pending_attendee_name) {
    // Fallback: assistente pediu o nome e cliente respondeu só com o nome (ex: "Cesar") — usar como attendee
    const lastAskedForName = lastAssistantMsg && /qual[\s\w]*nome/.test(normalizeText(lastAssistantMsg))
    const directNameAnswer = lastAskedForName && looksLikeAttendeeName(text)
    if (slotsInterpretation?.relationship_only && !directNameAnswer) {
      const rel = slotsInterpretation.relationship || "pessoa"
      const question =
        rel === "filho"
          ? "Claro, vamos comecar pelo seu filho. Qual o nome dele?"
          : rel === "filha"
            ? "Claro, vamos comecar pela sua filha. Qual o nome dela?"
            : rel === "marido"
              ? "Claro, vamos comecar pelo seu marido. Qual o nome dele?"
              : rel === "esposa"
                ? "Claro, vamos comecar pela sua esposa. Qual o nome dela?"
                : `Claro! Qual o nome ${rel === "pessoa" ? "dessa pessoa" : `do(a) seu(sua) ${rel}`}?`
      return buildResult(question, nextState)
    }

    const name =
      slotsInterpretation?.attendee_name && slotsInterpretation.attendee_name.trim()
        ? slotsInterpretation.attendee_name.trim()
        : text.trim()
    if (!name || interpretedHasAdditional || isExplicitBookingIntent(text)) {
      return buildResult(`${buildMultiBookingIntro()} De quem sera o primeiro agendamento?`, nextState)
    }
    nextState.slots.attendee_name = name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = name
    if (slotsInterpretation?.service && !nextState.slots.service) {
      nextState.slots.service = slotsInterpretation.service
    }
    nextState.pending_attendee_name = false
    if (nextState.last_booking && !nextState.pending_template_choice) {
      nextState.pending_template_choice = true
      const staffLabel = nextState.last_booking.staff_name ? ` da ${nextState.last_booking.staff_name}` : ""
      const dateLabel = nextState.last_booking.date ? formatDatePt(nextState.last_booking.date) : "esse dia"
      const hasOtherStaff = getOtherStaffOptions(config, nextState.last_booking.staff_name).length > 0
      const rawOpts = [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
        ...(hasOtherStaff ? ["Trocar colaborador"] : []),
      ]
      const options = rawOpts.map((o, i) => `${i + 1} - ${o}`)
      nextState.last_template_options = options
      const optsText = hasOtherStaff
        ? "Prefere o proximo horario, outro horario no mesmo dia, outro dia ou trocar colaborador?"
        : "Prefere o proximo horario, outro horario no mesmo dia ou outro dia?"
      return buildResult(`Certo, para ${name}. Quer agendar tambem em ${dateLabel}${staffLabel}? ${optsText}`, nextState, options)
    }
    const staffList = getStaffList(config)
    if (staffList.length > 1) {
      const staffOptions = [...staffList.map((s) => s.name), "Tanto faz"]
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...toNumberedOptions(staffOptions),
      ])
    }
    const serviceOpts = buildServiceOptions(config.services || [])
    const numberedOpts = serviceOpts.map((o, i) => `${i + 1} - ${o}`)
    nextState.last_service_options = serviceOpts
    const msg = `Otimo! Vamos agendar primeiro para o ${name}. Qual servico seria? (responda com o numero ou nome)`
    return buildResult(msg, nextState, numberedOpts)
  }

  if (nextState.pending_second_service_choice) {
    const serviceOptions = buildServiceOptions(config.services || [])
    const resolved = resolveOptionByNumber(text, serviceOptions) || findServiceFromText(text, config.services || [])
    const serviceNames = (config.services || []).map((s) => s.name).filter(Boolean)
    if (resolved && (resolved === "Quero agendar uma visita" || serviceNames.includes(resolved))) {
      nextState.pending_second_service_choice = false
      nextState.slots.service = resolved === "Quero agendar uma visita" ? "visita" : resolved
      const last = nextState.last_booking
      if (last?.date && last?.staff_name) {
        const serviceDuration = getServicesTotalDuration(config, nextState.slots.service)
        const next = getNextAvailableSlot(last.date, config, nextState.booked_slots, last.staff_name, last.time, serviceDuration)
        if (next) {
          nextState.slots.date = last.date
          nextState.slots.time = next
          nextState.slots.staff_name = last.staff_name
          const firstName = last.attendee_name || "o primeiro"
          const confirmOpts = [`1 - Sim, ${next}`, "2 - Outro horario no mesmo dia", "3 - Outro dia", ...(getOtherStaffOptions(config, last.staff_name).length > 0 ? ["4 - Trocar colaborador"] : [])]
          nextState.last_confirm_options = confirmOpts
          return buildResult(
            `Otimo, vamos agendar ${nextState.slots.attendee_name || "ele"} em seguida ao ${firstName}. Sugeri ${next} em ${formatDatePt(last.date)}. Posso confirmar?`,
            nextState,
            confirmOpts
          )
        }
        const hasOtherStaff = getOtherStaffOptions(config, last.staff_name).length > 0
        const msg = hasOtherStaff
          ? "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia ou trocar colaborador?"
          : "Nao encontrei um proximo horario nesse dia. Quer escolher outro dia?"
        return buildResult(msg, nextState, [
          "1 - Outro dia",
          ...(hasOtherStaff ? ["2 - Trocar colaborador"] : []),
        ])
      }
    } else {
      const opts = buildServiceOptions(config.services || []).map((o, i) => `${i + 1} - ${o}`)
      return buildResult("Qual servico voce prefere? (responda com o numero ou nome)", nextState, opts)
    }
  }

  if (nextState.pending_template_choice) {
    const templateOpts = state.last_template_options || []
    const choice = parseTemplateChoice(text, templateOpts.length > 0 ? templateOpts : undefined)
    const last = nextState.last_booking
    if (choice && last) {
      nextState.pending_template_choice = false
      nextState.last_template_options = undefined
      if (choice === "same_next") {
        const staffName = last.staff_name
        const defaultService = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceList = buildServiceOptions(config.services || [])
        const numberedServiceOpts = serviceList.map((o, i) => `${i + 1} - ${o}`)
        nextState.pending_second_service_choice = true
        const firstName = last.attendee_name || "o primeiro"
        const secondName = nextState.slots.attendee_name || "ele"
        const defaultLabel = defaultService === "visita" ? "visita" : defaultService
        const question =
          defaultService
            ? `Otimo, vamos agendar ${secondName} em seguida ao ${firstName}. O dele tambem vai ser ${defaultLabel}? Ou prefere trocar o servico:`
            : `Otimo, vamos agendar ${secondName} em seguida ao ${firstName}. Qual servico?`
        return buildResult(question, nextState, numberedServiceOpts)
      }
      if (choice === "same_day") {
        if (last.date) nextState.slots.date = last.date
        nextState.slots.staff_name = last.staff_name
        const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
        const serviceForSlots = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceDuration = getServicesTotalDuration(config, serviceForSlots)
        const availability = last.date
          ? getMockAvailability(last.date, schedule, nextState.booked_slots, nextState.slots.staff_name, serviceDuration)
          : { available: [], occupied: [] }
        if (!availability.available.length) {
          const closedToday =
            last.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
          const msg = closedToday
            ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
            : getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? "Esse dia esta cheio. Quer tentar outro dia ou trocar colaborador?"
              : "Esse dia esta cheio. Quer tentar outro dia?"
          const closedDayOptions = getOtherDayOptions(schedule)
          return buildResult(msg, nextState, [
            ...(closedToday ? closedDayOptions : ["Outro dia"]),
            ...(getOtherStaffOptions(config, nextState.slots.staff_name).length > 0
              ? ["Trocar colaborador"]
              : []),
          ])
        }
        nextState.last_time_options = availability.available.slice(0, 24)
        nextState.last_time_options_date = nextState.slots.date
        nextState.last_time_options_staff = nextState.slots.staff_name
        return buildResult(
          "Qual horario voce prefere no mesmo dia?",
          nextState,
          toNumberedOptions(availability.available.slice(0, 24))
        )
      }
      if (choice === "other_day") {
        nextState.slots.date = undefined
        nextState.slots.time = undefined
        return buildResult("Qual dia voce prefere?", nextState)
      }
      if (choice === "other_staff") {
        nextState.slots.staff_name = undefined
        const staffOptions = [...getStaffList(config).map((s) => s.name), "Tanto faz"]
        return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
          ...toNumberedOptions(staffOptions),
        ])
      }
    }
  }

  const staffList = getStaffList(config)
  if (staffList.length === 1 && !nextState.slots.staff_name) {
    nextState.slots.staff_name = staffList[0].name
  }

  if (staffList.length > 1) {
    if (!nextState.slots.staff_name) {
      const staffOptions = [...staffList.map((s) => s.name), "Tanto faz"]
      const selectedByNumber = resolveOptionByNumber(text, staffOptions)
      const selected = resolveStaffFromText(text, staffList)
      if (selectedByNumber && selectedByNumber !== "Tanto faz") {
        nextState.slots.staff_name = selectedByNumber
      } else if (selected) {
        nextState.slots.staff_name = selected
      } else if (selectedByNumber === "Tanto faz" || isAnyStaffRequest(text)) {
        nextState.slots.staff_name = staffList[0].name
      }
    }

    if (!nextState.slots.staff_name) {
      const staffOptions = [...staffList.map((s) => s.name), "Tanto faz"]
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...toNumberedOptions(staffOptions),
      ])
    }

    if (!state.slots?.staff_name && nextState.slots.staff_name && nextState.slots.service && !nextState.slots.date) {
      if (isGreeting(text)) {
        return buildResult(getGreetingMessage(config), nextState)
      }
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const days = schedule?.days_of_week || []
      if (days.length > 0) {
        const daysLabel = days.map((d) => buildStaffDayOptions([d])[0]).join(", ")
        const dayOptions = buildStaffDayOptions(days)
        const intro =
          nextState.just_identified_service && nextState.slots.service
            ? `Entendi, voce precisa de ${nextState.slots.service}. `
            : ""
        nextState.just_identified_service = false
        return buildResult(
          `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel (${daysLabel}). Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
          nextState,
          toNumberedOptions(dayOptions)
        )
      }
      if (isBusinessClosedForToday(schedule) && (schedule?.days_of_week || []).length > 0) {
        return buildResult(
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
        )
      }
    }
  }

  if (bookingComplete && (interpretedHasAdditional || (nextState.pending_additional_count || 0) > 0)) {
    let extraCount = interpretedCount && interpretedCount > 0 ? interpretedCount : 0
    if (!extraCount && interpretedHasAdditional) extraCount = 1
    nextState.last_booking = {
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
    }
    if (interpretedHasAdditional && !wasAdditionalPending) {
      nextState.pending_default_service = explicitService || undefined
      nextState.pending_default_service_locked = Boolean(explicitService)
    } else if (nextState.pending_default_service_locked && nextState.slots.service) {
      nextState.pending_default_service = nextState.slots.service
    }
    nextState.booked_slots = addBookedSlot(
      nextState.booked_slots,
      nextState.slots.staff_name,
      nextState.slots.date,
      nextState.slots.time
    )
    nextState.completed_bookings?.push({
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
    })
    nextState.pending_additional_count = extraCount
    nextState.pending_additional_booking = extraCount > 0
    if (nextState.expected_additional_count === undefined && extraCount > 0) {
      nextState.expected_additional_count = extraCount
    }
    nextState.slots = resetSlotsForNextBooking(nextState)
    nextState.pending_attendee_name = true
    return buildResult(extraCount > 0 ? buildAdditionalBookingAfterCompletePrompt() : buildSingleAdditionalPrompt(), nextState)
  }

  if (state.pending_date_confirmation) {
    const pendingDate = state.pending_date_confirmation
    const pendingDateLabel = formatDatePt(pendingDate)
    const pendingDateOptions = [`Sim, ${pendingDateLabel}`, "Outra data"]
    const dateConfirmationInput = resolveOptionByNumber(text, pendingDateOptions) || text
    const normalizedConfirmation = normalizeText(dateConfirmationInput).trim()
    const parsedDateFromConfirmation = parseDateOrWeekday(dateConfirmationInput)

    if (parsedDateFromConfirmation) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const usedWeekday = !hasExplicitDate(dateConfirmationInput) && parseWeekdayDate(dateConfirmationInput)
      let candidateDate = parsedDateFromConfirmation

      if (
        usedWeekday &&
        candidateDate === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        candidateDate = addDaysToIsoDate(candidateDate, 7)
      } else if (
        !usedWeekday &&
        candidateDate === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
        )
      }

      const blocked = await isDateBlocked(candidateDate, {
        holidays_attend: config.holidays_attend,
        closure_periods: config.closure_periods,
      })
      if (blocked.blocked) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          buildDateBlockedMessage(blocked.reason || "Essa data nao esta disponivel."),
          nextState,
          ["Outro dia"]
        )
      }

      if (usedWeekday) {
        nextState.pending_date_confirmation = candidateDate
        return buildResult(`Voce quis dizer ${formatDatePt(candidateDate)}?`, nextState, [
          `Sim, ${formatDatePt(candidateDate)}`,
          "Outra data",
        ])
      }

      nextState.slots.date = candidateDate
      nextState.pending_date_confirmation = undefined
    }

    if (isYes(dateConfirmationInput) || normalizedConfirmation === "s") {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const confirmedDate = pendingDate
      if (
        confirmedDate === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
        )
      }
      const blocked = await isDateBlocked(confirmedDate, {
        holidays_attend: config.holidays_attend,
        closure_periods: config.closure_periods,
      })
      if (blocked.blocked) {
        nextState.pending_date_confirmation = undefined
        return buildResult(
          buildDateBlockedMessage(blocked.reason || "Essa data nao esta disponivel."),
          nextState,
          ["Outro dia"]
        )
      }
      nextState.slots.date = confirmedDate
      nextState.pending_date_confirmation = undefined
    } else if (
      isNo(dateConfirmationInput) ||
      normalizedConfirmation === "n" ||
      normalizeText(dateConfirmationInput).includes("outra")
    ) {
      nextState.pending_date_confirmation = undefined
      return buildResult("Qual dia voce prefere?", nextState)
    }
  }

  if (normalizeText(text).includes("outro dia") || normalizeText(text).includes("outra data")) {
    nextState.slots.date = undefined
    nextState.slots.time = undefined
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    return buildResult("Qual dia voce prefere?", nextState, getOtherDayOptions(schedule))
  }

  // Priorizar pergunta de preço: mesmo com staff+service (sem data), responder preço + botões como no WhatsApp
  if (isPriceQuestion(text)) {
    const cordial = getCordialPrefix(config, false)
    const serviceName = findServiceFromText(text, config.services || [])
    const svc = getServiceWithPrice(config.services || [], serviceName)
    if (serviceName && svc && svc.base_price != null) {
      nextState.slots.service = svc.name
      nextState.just_identified_service = true
      return buildResult(
        cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
        nextState,
        ["Quero agendar", "Só queria saber"]
      )
    }
    // Rejeição para qualquer serviço que não esteja na lista do negócio (preço, agendamento, etc.)
    if (!serviceName && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }
    const withPrice = (config.services || []).filter((s) => s.base_price != null)
    if (withPrice.length > 0) {
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      nextState.last_service_options = serviceOptions
      return buildServicesListResult(config, nextState, cordial)
    }
    const noPrice = buildPriceNotAvailableMessage(config, serviceName || undefined)
    return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
  }

  const scheduleForDateCandidate = getScheduleForStaff(config, nextState.slots.staff_name)
  const rawDayOptionsForDateCandidate = buildStaffDayOptions(scheduleForDateCandidate?.days_of_week || [])
  const expectsDateInput = waitingFor === "date"
  const lastActionNormalized = (state.last_action_options || []).map((opt) =>
    normalizeText(String(opt || "").replace(/^\d+\s*-\s*/, "").trim())
  )
  const rawDayOptionsNormalized = rawDayOptionsForDateCandidate.map((opt) => normalizeText(opt))
  const isCurrentPromptDayOptions =
    rawDayOptionsForDateCandidate.length > 0 &&
    lastActionNormalized.length === rawDayOptionsNormalized.length &&
    rawDayOptionsNormalized.every((opt, idx) => lastActionNormalized[idx] === opt)
  const dateInputCandidate = expectsDateInput
    ? (isCurrentPromptDayOptions
        ? (resolveOptionByNumber(text, rawDayOptionsForDateCandidate) || text)
        : text)
    : text
  const dateCandidate = !nextState.slots.date ? parseDateOrWeekday(dateInputCandidate) : null
  if (!nextState.slots.date && !dateCandidate && nextState.slots.staff_name && nextState.slots.service) {
    if (isGreeting(text)) {
      return buildResult(getGreetingMessage(config), nextState)
    }
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const days = schedule?.days_of_week || []
    const dayOptions = buildStaffDayOptions(days)
    const daysLabel = days.length > 0 ? days.map((d) => buildStaffDayOptions([d])[0]).join(", ") : "segunda a sabado"
    const intro =
      nextState.just_identified_service && nextState.slots.service
        ? `Entendi, voce precisa de ${nextState.slots.service}. `
        : ""
    nextState.just_identified_service = false
    return buildResult(
      `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel (${daysLabel}). Em qual dia voce gostaria de agendar? (ex: Hoje, Amanha ou dia da semana)`,
      nextState,
      toNumberedOptions(dayOptions)
    )
  }

  if (state.pending_contact_field) {
    if (state.pending_contact_field === "name") {
      const name = text.trim()
      if (!name) {
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      nextState.slots.customer_name = name
      nextState.pending_contact_field = undefined
    } else if (state.pending_contact_field === "contact_preference") {
      const prefOptions = ["Só celular", "Só email", "Celular e email"]
      const prefInput = resolveOptionByNumber(text, prefOptions) || text
      const t = prefInput.toLowerCase().trim()
      let pref: "phone" | "email" | "both" | null = null
      // Reconhece "celular mesmo", "só celular", "cell", etc.
      if (/(s[oó]|apenas)\s*celular|celular\s*(apenas|mesmo)|celular\s+\d/.test(t)) pref = "phone"
      else if (/(s[oó]|apenas)\s*email|email\s*apenas/.test(t)) pref = "email"
      else if (/(ambos|celular\s*e\s*email|os\s*dois)/.test(t)) pref = "both"
      if (!pref) {
        pref = await extractContactPreferenceFromText(prefInput, history)
      }
      if (pref === "phone") {
        nextState.contact_preference = "phone"
        nextState.pending_contact_field = undefined
        // Se a mensagem já contém o número (ex: "Celular mesmo 11972763228"), extrair e não perguntar de novo
        const phoneFromText = parsePhone(text)
        if (phoneFromText) {
          nextState.slots.customer_phone = phoneFromText
          // não retorna aqui; o fluxo continua abaixo e avança para o próximo passo
        } else {
          nextState.pending_contact_field = "phone"
          return buildResult("Qual seu celular com DDD?", nextState)
        }
      } else if (pref === "email") {
        nextState.contact_preference = "email"
        nextState.pending_contact_field = undefined
        const emailFromText = parseEmail(text)
        if (emailFromText) {
          nextState.slots.customer_email = emailFromText
        } else {
          nextState.pending_contact_field = "email"
          return buildResult("Qual seu email?", nextState)
        }
      } else if (pref === "both") {
        nextState.contact_preference = "both"
        nextState.pending_contact_field = undefined
        const phoneFromText = parsePhone(text)
        if (phoneFromText) {
          nextState.slots.customer_phone = phoneFromText
          nextState.pending_contact_field = "email"
          return buildResult("Qual seu email?", nextState)
        }
        nextState.pending_contact_field = "phone"
        return buildResult("Qual seu celular com DDD?", nextState)
      } else {
        return buildResult(
          "Como prefere ser contatado? Escolha: Só celular, Só email ou Celular e email.",
          nextState,
          prefOptions
        )
      }
    } else if (state.pending_contact_field === "phone") {
      const phone = parsePhone(text)
      if (!phone) {
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      nextState.slots.customer_phone = phone
      nextState.pending_contact_field = undefined
    } else if (state.pending_contact_field === "email") {
      const email = parseEmail(text)
      if (!email) {
        return buildResult("Qual seu email?", nextState)
      }
      nextState.slots.customer_email = email
      nextState.pending_contact_field = undefined
    }
  }

  if (!nextState.slots.customer_email) {
    const email = parseEmail(text)
    if (email) nextState.slots.customer_email = email
  }
  if (!nextState.slots.customer_phone) {
    const phone = parsePhone(text)
    if (phone) nextState.slots.customer_phone = phone
  }

  if (config.allow_sequence_booking) {
    const eligibleForSequence =
      (config.sequence_eligible_services?.length ?? 0) > 0
        ? config.sequence_eligible_services || []
        : (config.services || []).map((s) => s.name).filter(Boolean)
    const mentionedMultiple = findServicesFromText(text, config.services || [], eligibleForSequence)
    if (mentionedMultiple.length >= 2 && (!nextState.slots.date || !nextState.slots.time)) {
      nextState.slots.service = mentionedMultiple.join(", ")
      nextState.just_identified_service = true
    }
  }

  if (!nextState.slots.service) {
    if (isVisitRequest(text)) {
      nextState.slots.service = "Visita"
    } else if (config.services && config.services.length === 1) {
      nextState.slots.service = config.services[0].name
    } else if (config.allow_sequence_booking) {
      const eligibleForSequence =
        (config.sequence_eligible_services?.length ?? 0) > 0
          ? config.sequence_eligible_services || []
          : (config.services || []).map((s) => s.name).filter(Boolean)
      const multiple = findServicesFromText(text, config.services || [], eligibleForSequence)
      if (multiple.length > 0) {
        nextState.slots.service = multiple.join(", ")
      } else {
        const service = findServiceFromText(text, config.services || [])
        if (service) nextState.slots.service = service
      }
    } else {
      const service = findServiceFromText(text, config.services || [])
      if (service) nextState.slots.service = service
    }
  }

  if (!nextState.slots.date) {
    const scheduleForDate = getScheduleForStaff(config, nextState.slots.staff_name)
    const rawDayOptions = buildStaffDayOptions(scheduleForDate?.days_of_week || [])
    const rawDayOptionsNorm = rawDayOptions.map((opt) => normalizeText(opt))
    const isPromptDayOptions =
      rawDayOptions.length > 0 &&
      lastActionNormalized.length === rawDayOptionsNorm.length &&
      rawDayOptionsNorm.every((opt, idx) => lastActionNormalized[idx] === opt)
    const dateInput =
      expectsDateInput && isPromptDayOptions
        ? (resolveOptionByNumber(text, rawDayOptions) || text)
        : text
    let date = parseDateOrWeekday(dateInput)
    if (date) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const usedWeekday = !hasExplicitDate(dateInput) && parseWeekdayDate(dateInput)
      const allowedDays = schedule?.days_of_week

      // Dia da semana fora do expediente? Responder logo (hoje, amanhã, quarta, etc.)
      if (allowedDays && allowedDays.length > 0) {
        const weekday = getWeekdayKey(date)
        if (!allowedDays.includes(weekday)) {
          const { message, action_options } = buildDayNotServedMessage(
            weekday,
            allowedDays,
            schedule
          )
          return buildResult(message, nextState, action_options)
        }
      }

      if (
        usedWeekday &&
        date === getTodayIsoBusinessTz() &&
        isBusinessClosedForToday(schedule)
      ) {
        date = addDaysToIsoDate(date, 7)
      } else if (
        !usedWeekday &&
        isBusinessClosedForToday(schedule) &&
        date === getTodayIsoBusinessTz()
      ) {
        nextState.slots.date = undefined
        return buildResult(
          "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce.",
          nextState,
          getOtherDayOptions(schedule)
        )
      }
      if (usedWeekday && !state.pending_date_confirmation) {
        nextState.pending_date_confirmation = date
        return buildResult(`Voce quis dizer ${formatDatePt(date)}?`, nextState, [
          `Sim, ${formatDatePt(date)}`,
          "Outra data",
        ])
      }
      const blocked = await isDateBlocked(date, {
        holidays_attend: config.holidays_attend,
        closure_periods: config.closure_periods,
      })
      if (blocked.blocked) {
        return buildResult(
          buildDateBlockedMessage(blocked.reason || "Essa data nao esta disponivel."),
          nextState,
          ["Outro dia"]
        )
      }
      nextState.slots.date = date
    }
  }

  if (!nextState.slots.time) {
    const time = parseTime(text)
    if (time) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const start = schedule?.start_time || "09:00"
      const end = schedule?.end_time || "18:00"
      let options: string[] | undefined =
        Array.isArray(state.last_time_options) && state.last_time_options.length > 0
          ? state.last_time_options
          : undefined
      if (!options && nextState.slots.date) {
        const serviceDuration = getServicesTotalDuration(
          config,
          nextState.slots.service || nextState.pending_default_service
        )
        const availability = getMockAvailability(
          nextState.slots.date,
          schedule,
          nextState.booked_slots,
          nextState.slots.staff_name,
          serviceDuration
        )
        if (availability.available.length > 0) options = availability.available.slice(0, 24)
      }
      const minLead = schedule?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
      if (nextState.slots.date === getTodayIsoBusinessTz() && isTimeTooSoonForDate(nextState.slots.date, time, minLead)) {
        const msg =
          `Este horario nao pode ser agendado agora. Trabalhamos com antecedencia minima de ${minLead} minutos. Qual horario voce prefere?`
        return buildResult(msg, nextState, options ? toNumberedOptions(options) : undefined)
      }
      const within = isWithinSchedule(time, schedule)
      if (!within.ok) {
        const msg =
          `Nosso horário de atendimento é das ${start} às ${end}. Só estão disponíveis as opções que te listei. Qual horário você prefere?`
        return buildResult(msg, nextState, options ? toNumberedOptions(options) : undefined)
      }
      nextState.slots.time = time
    }
  }

  if (!nextState.slots.time_period) {
    const period = parseTimePeriod(text)
    if (period) nextState.slots.time_period = period
  }

  if (state.pending_suggested_time && isYes(text)) {
    nextState.slots.time = state.pending_suggested_time
    nextState.pending_suggested_time = undefined
  } else if (state.pending_suggested_time && isNo(text)) {
    nextState.pending_suggested_time = undefined
  }

  if (isAvailabilityQuestion(text)) {
    if (!nextState.slots.date) {
      const dateFromMsg = parseDateOrWeekday(text)
      if (dateFromMsg) {
        const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
        const allowedDays = schedule?.days_of_week
        if (allowedDays && allowedDays.length > 0 && !allowedDays.includes(getWeekdayKey(dateFromMsg))) {
          const { message, action_options } = buildDayNotServedMessage(
            getWeekdayKey(dateFromMsg),
            allowedDays,
            schedule
          )
          return buildResult(message, nextState, action_options)
        }
        const serviceDuration = getServicesTotalDuration(
          config,
          nextState.slots.service || nextState.pending_default_service
        )
        const availability = getMockAvailability(
          dateFromMsg,
          schedule,
          nextState.booked_slots,
          nextState.slots.staff_name,
          serviceDuration
        )
        const todayIso = getTodayIsoBusinessTz()
        const tomorrowIso = addDaysToIsoDate(todayIso, 1)
        const dateLabel =
          dateFromMsg === todayIso
            ? "hoje"
            : dateFromMsg === tomorrowIso
              ? "amanha"
              : `em ${formatDatePt(dateFromMsg)}`
        if (availability.available.length > 0) {
          nextState.slots.date = dateFromMsg
          nextState.last_time_options = availability.available.slice(0, 24)
          nextState.last_time_options_date = dateFromMsg
          nextState.last_time_options_staff = nextState.slots.staff_name
          const msg = buildAvailabilityForDateMessage(dateLabel, availability.available.slice(0, 24), true)
          return buildResult(msg, nextState, toNumberedOptions(availability.available.slice(0, 24)))
        }
        const msg = buildAvailabilityForDateMessage(dateLabel, [], false)
        const dayOpts = allowedDays && allowedDays.length > 0 ? getOtherDayOptions(schedule) : ["Outro dia"]
        return buildResult(msg, nextState, dayOpts)
      }
      return buildResult("Pra eu ver os horarios, pra qual dia voce prefere?", nextState)
    }
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    )
    const availability = getMockAvailability(
      nextState.slots.date,
      schedule,
      nextState.booked_slots,
      nextState.slots.staff_name,
      serviceDuration
    )
    if (availability.available.length === 0) {
      const otherStaff = getOtherStaffOptions(config, nextState.slots.staff_name)
      const closedToday =
        nextState.slots.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
      const msg = closedToday
        ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : otherStaff.length > 0
          ? `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`
          : `Esse dia esta cheio. Quer tentar outro dia?`
      const options = closedToday
        ? [...getOtherDayOptions(schedule), ...otherStaff]
        : otherStaff.length > 0
          ? [...otherStaff, "Outro dia"]
          : ["Outro dia"]
      return buildResult(msg, nextState, options)
    }
    nextState.last_time_options = availability.available.slice(0, 24)
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    return buildResult(
      `Tenho estes horarios livres em ${formatDatePt(nextState.slots.date)}. Qual voce prefere?`,
      nextState,
      toNumberedOptions(availability.available.slice(0, 24))
    )
  }

  if (!nextState.slots.service) {
    const prompt = buildServicePrompt(config, text, {
      date: nextState.slots.date,
      time: nextState.slots.time,
      time_period: nextState.slots.time_period,
      attendee_name: nextState.slots.attendee_name,
    })
    nextState.last_service_options = buildServiceOptions(config.services || [])
    return buildResult(prompt.message, nextState, toNumberedOptions(prompt.action_options))
  }

  if (!nextState.slots.date) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const days = schedule?.days_of_week || []
    const dayOpts = buildStaffDayOptions(days)
    const prefix = nextState.slots.time
      ? `Anotei ${nextState.slots.service} no horario ${nextState.slots.time}. `
      : nextState.slots.time_period
        ? `Anotei ${nextState.slots.service} no periodo ${formatTimePeriod(nextState.slots.time_period)}. `
        : `Certo, ${nextState.slots.service}. `
    return buildResult(
      `${prefix}Qual dia voce prefere? (ex: Hoje, Amanha ou dia da semana)`,
      nextState,
      toNumberedOptions(dayOpts)
    )
  }

  if (!nextState.slots.time) {
    const timeFromNumber =
      Array.isArray(state.last_time_options) && state.last_time_options.length > 0
        ? resolveOptionByNumber(text, state.last_time_options)
        : null
    if (timeFromNumber) {
      // Validar antes de aceitar: não permitir horário passado ou sem buffer mínimo para hoje
      const scheduleForLead = getScheduleForStaff(config, nextState.slots.staff_name)
      const minLead = scheduleForLead?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
      if (nextState.slots.date && isTimeTooSoonForDate(nextState.slots.date, timeFromNumber, minLead)) {
        const schedule = scheduleForLead
        const serviceDuration = getServicesTotalDuration(
          config,
          nextState.slots.service || nextState.pending_default_service
        )
        const availability = getMockAvailability(
          nextState.slots.date,
          schedule,
          nextState.booked_slots,
          nextState.slots.staff_name,
          serviceDuration
        )
        nextState.last_time_options = availability.available.slice(0, 24)
        nextState.last_time_options_date = nextState.slots.date
        nextState.last_time_options_staff = nextState.slots.staff_name
        return buildResult(
          `Este horário não pode ser agendado agora. Trabalhamos com antecedência mínima de ${minLead} minutos. Qual horário você prefere?`,
          nextState,
          toNumberedOptions(availability.available.slice(0, 24))
        )
      }
      nextState.slots.time = timeFromNumber
    }
  }

  if (!nextState.slots.time) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    )
    const availability = getMockAvailability(
      nextState.slots.date,
      schedule,
      nextState.booked_slots,
      nextState.slots.staff_name,
      serviceDuration
    )
    const options = availability.available.slice(0, 24)
    if (availability.available.length === 0) {
      const otherStaff = getOtherStaffOptions(config, nextState.slots.staff_name)
      const closedToday =
        nextState.slots.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
      const msg = closedToday
        ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : otherStaff.length > 0
          ? `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`
          : `Esse dia esta cheio. Quer tentar outro dia?`
      const optionList = closedToday
        ? [...getOtherDayOptions(schedule), ...otherStaff]
        : otherStaff.length > 0
          ? [...otherStaff, "Outro dia"]
          : ["Outro dia"]
      return buildResult(msg, nextState, toNumberedOptions(optionList))
    }
    nextState.last_time_options = options
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    if (nextState.slots.time_period) {
      return buildResult(
        `Perfeito, ${formatTimePeriod(nextState.slots.time_period)}. Qual horario voce prefere?`,
        nextState,
        toNumberedOptions(options)
      )
    }
    return buildResult("Qual horario voce prefere?", nextState, toNumberedOptions(options))
  }

  const dateIso = nextState.slots.date
  const time = nextState.slots.time
  if (dateIso && time) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    )
    const availability = getMockAvailability(
      dateIso,
      schedule,
      nextState.booked_slots,
      nextState.slots.staff_name,
      serviceDuration
    )
    const minLead = schedule?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
    if (isTimeTooSoonForDate(dateIso, time, minLead)) {
      nextState.slots.time = undefined
      nextState.last_time_options = availability.available.slice(0, 24)
      nextState.last_time_options_date = dateIso
      nextState.last_time_options_staff = nextState.slots.staff_name
      return buildResult(
        `Esse horario nao esta disponivel para agora. A antecedencia minima e de ${minLead} minutos. Vou te mostrar os proximos horarios livres.`,
        nextState,
        toNumberedOptions(availability.available.slice(0, 24))
      )
    }
    const isTimeFromLastOptions =
      Array.isArray(state.last_time_options) &&
      state.last_time_options.includes(time) &&
      state.last_time_options_date === dateIso &&
      state.last_time_options_staff === nextState.slots.staff_name
    if (availability.available.includes(time) || isTimeFromLastOptions) {
      if (!nextState.slots.customer_name) {
        nextState.pending_contact_field = "name"
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      const pref = nextState.contact_preference ?? state.contact_preference
      if (!pref) {
        nextState.pending_contact_field = "contact_preference"
        return buildResult(
          "Como prefere ser contatado para confirmar o agendamento?",
          nextState,
          ["Só celular", "Só email", "Celular e email"]
        )
      }
      const needsPhone = pref === "phone" || pref === "both"
      const needsEmail = pref === "email" || pref === "both"
      if (needsPhone && !nextState.slots.customer_phone) {
        nextState.pending_contact_field = "phone"
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      if (needsEmail && !nextState.slots.customer_email) {
        nextState.pending_contact_field = "email"
        return buildResult("Qual seu email?", nextState)
      }
      if (
        nextState.pending_additional_booking ||
        (nextState.pending_additional_count || 0) > 0 ||
        (nextState.expected_additional_count || 0) > 0
      ) {
        const completedService = nextState.slots.service
        const completedDate = nextState.slots.date
        const completedTime = nextState.slots.time
        nextState.last_booking = {
          attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
          service: completedService,
          date: completedDate,
          time: completedTime,
          staff_name: nextState.slots.staff_name,
        }
        if (nextState.pending_default_service_locked && completedService) {
          nextState.pending_default_service = completedService
        }
        nextState.booked_slots = addBookedSlot(
          nextState.booked_slots,
          nextState.slots.staff_name,
          completedDate,
          completedTime
        )
        nextState.completed_bookings?.push({
          attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
          service: completedService,
          date: completedDate,
          time: completedTime,
          staff_name: nextState.slots.staff_name,
        })
        nextState.pending_additional_booking = false
        if ((nextState.pending_additional_count || 0) > 0) {
          nextState.pending_additional_count = Math.max(0, (nextState.pending_additional_count || 0) - 1)
        }
        const expectedTotal =
          (nextState.expected_additional_count || 0) > 0 ? (nextState.expected_additional_count || 0) + 1 : 0
        const completedCount = nextState.completed_bookings?.length || 0
        if ((nextState.pending_additional_count || 0) > 0 || (expectedTotal > 0 && completedCount < expectedTotal)) {
          nextState.slots = resetSlotsForNextBooking(nextState)
          nextState.pending_attendee_name = true
          return buildResult(
            `Perfeito! Agendei ${completedService} para ${formatDatePt(
              completedDate || dateIso
            )} as ${completedTime || time}. Vamos agendar o proximo? De quem sera o proximo agendamento?`,
            nextState
          )
        }
        nextState.pending_final_confirmation = true
        const summary = buildMultiBookingSummary(nextState.completed_bookings || [])
        return buildResult(
          `${summary}\n\nPrecisa de mais alguma coisa?`,
          nextState,
          ["Confirmar agendamento"]
        )
      }
      nextState.booked_slots = addBookedSlot(nextState.booked_slots, nextState.slots.staff_name, dateIso, time)
      if (!nextState.completed_bookings) nextState.completed_bookings = []
      nextState.completed_bookings.push({
        attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
        service: nextState.slots.service,
        date: dateIso,
        time,
        staff_name: nextState.slots.staff_name,
      })
      const finalResult = await buildFinalBookingMessage({
        config,
        service: nextState.slots.service,
        staffName: nextState.slots.staff_name,
        dateIso,
        time,
      })
      nextState.final_thanks_sent = true
      nextState.slots = resetSlotsForNextBooking(nextState)
      return buildResult(finalResult.message, nextState)
    }

    const next = availability.available.find((slot) => slot > time) || availability.available[0]
    if (next) {
      nextState.pending_suggested_time = next
      nextState.slots.time = undefined
      return buildResult(`Esse horario esta ocupado. Posso te oferecer ${next} no mesmo dia?`, nextState)
    }
    const closedToday =
      dateIso === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
    return buildResult(
      closedToday
      ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : "Esse dia esta cheio. Quer tentar outro dia?",
    nextState,
    closedToday ? getOtherDayOptions(schedule) : undefined
    )
  }

  return buildResult("Certo! Me diz o melhor dia e horario para voce.", nextState)
}

function resolveQuote(config: SimulatorConfig, text: string, state: SimulatorState): SimulatorResult {
  const nextState: SimulatorState = {
    ...state,
    step: "quote",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const variables = config.dynamic_variables?.filter((v) => !v.context || v.context === "quote") || []

  if (variables.length === 0) {
    if (state.step !== "quote_free_text") {
      nextState.step = "quote_free_text"
      return buildResult("Me conta os detalhes do que voce precisa para eu preparar o orcamento.", nextState)
    }
    return buildResult("Obrigado! Vou analisar e te retorno com o orcamento o quanto antes.", nextState)
  }

  if (state.pending_quote_key) {
    nextState.slots.quote_answers = {
      ...(nextState.slots.quote_answers || {}),
      [state.pending_quote_key]: text.trim(),
    }
    nextState.pending_quote_key = undefined
  }

  const nextVar = variables.find((v) => !nextState.slots.quote_answers?.[v.key])
  if (nextVar) {
    nextState.pending_quote_key = nextVar.key
    return buildResult(`${nextVar.label}?`, nextState)
  }

  return buildResult("Perfeito, obrigado! Vou analisar e te retorno com o orcamento.", nextState)
}

function isFirstMessage(state: SimulatorState & { _isFirstMessage?: boolean }): boolean {
  // Verifica se é a primeira mensagem usando a flag ou estado vazio
  if (state._isFirstMessage === true) return true
  // Fallback: verifica se é a primeira mensagem: estado vazio ou sem histórico significativo
  const hasNoHistory = !state.mode && !state.step && !state.slots?.service && !state.last_prompt
  const hasEmptySlots = !state.slots || Object.keys(state.slots).length === 0 || 
    (Object.keys(state.slots).length === 1 && state.slots.quote_answers && Object.keys(state.slots.quote_answers).length === 0)
  return hasNoHistory && hasEmptySlots
}

function buildIdentityAndBookingMessage(config: SimulatorConfig): string {
  const name = config.business_name ? `da ${config.business_name}` : "da empresa"
  return `Oi! Sou a assistente virtual ${name}. Se quiser, já te ajudo a agendar um horário.`
}

function buildGuidedClarification(config: SimulatorConfig): string {
  const business = config.business_name || "nossa empresa"
  return `Claro! Somos da ${business}. Pode me contar mais detalhes do que você precisa? Se quiser, já te ajudo a agendar um horário.`
}

type RuleInput = {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
}

type ConversationRule = (input: RuleInput) => SimulatorResult | null

function applyConversationRules(rules: ConversationRule[], input: RuleInput): SimulatorResult | null {
  for (const rule of rules) {
    const result = rule(input)
    if (result) return result
  }
  return null
}

const earlyConversationRules: ConversationRule[] = [
  ({ config, text, nextState }) => {
    if (!shouldBlockByTargetAudience(config, text)) return null
    return buildResult(
      buildTargetAudienceRestrictionMessage(config),
      {
        ...nextState,
        slots: {
          ...nextState.slots,
          attendee_name: undefined,
        },
        step: "qualification",
      },
      ["Quero agendar"]
    )
  },
  // Homens + infantil: quando cliente diz "pra mim e meu filho", esclarecer perfil antes de agendar (opção 2).
  ({ config, text, nextState }) => {
    if (!needsAudienceClarification(config, text)) return null
    return buildResult(
      buildAudienceClarificationMessage(config),
      { ...nextState, step: "qualification" },
      ["Sim, nos encaixamos", "Quero agendar"]
    )
  },
]

const postServiceResolutionRules: ConversationRule[] = [
  ({ config, text, nextState }) => {
    if (!isWhoAreYou(text)) return null
    return buildResult(buildIdentityAndBookingMessage(config), nextState, ["Quero agendar"])
  },
  ({ text, nextState }) => {
    if (!isConfused(text)) return null
    const fallback = nextState.last_prompt || "Como posso te ajudar hoje?"
    return buildResult(`Tudo bem! Posso repetir: ${fallback}`, nextState)
  },
]

type SimulatorHandlerContext = {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
}

type OrchestratorAction =
  | "no_match_fallback"
  | "answer_price"
  | "list_services"
  | "start_booking"
  | "service_detail"
  | "ask_clarification"

type OrchestratorActionHandler = () => Promise<SimulatorResult | null>
type OrchestratorActionHandlers = Partial<Record<OrchestratorAction, OrchestratorActionHandler>>

async function runOrchestratorAction(
  orchestrator: any,
  handlers: OrchestratorActionHandlers
): Promise<SimulatorResult | null> {
  const action = (orchestrator?.suggested_action || "") as OrchestratorAction
  const handler = handlers[action]
  return handler ? await handler() : null
}

async function handleQualificationRejectedOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName } = context

  const handlers: OrchestratorActionHandlers = {
    no_match_fallback: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      return buildResult(buildGenericFallback(config), nextState)
    },
    answer_price: async () => {
      const cordial = getCordialPrefix(config, false)
      const svc = orchestrator.inferred_service
        ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
        : null
      if (orchestrator.inferred_service && !svc) {
        const rejectionMessage = await generateRejectionMessageWithAI(orchestrator.inferred_service, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
      if (svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, {
          has_completed_booking: false,
          history,
        })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        return buildResult(
          cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, {
          has_completed_booking: false,
          history,
        })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildServicesListResult(config, nextState, getCordialPrefix(config, false))
      }
      return null
    },
    list_services: async () => {
      const listMsg = buildListServicesMessage(config, { intro: "after_generic" })
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(listMsg, { ...nextState, step: "qualification", last_service_options: serviceOptions }, serviceOptions)
    },
    start_booking: async () => {
      nextState.mode = "booking"
      nextState.step = undefined
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromOrchestrator = orchestrator.inferred_service ? getServiceWithPrice(config.services || [], orchestrator.inferred_service) : null
      const msgNorm = normalizeText(text)
      const useOrchestratorService =
        serviceFromOrchestrator && msgNorm.includes(normalizeText(serviceFromOrchestrator.name))
      const serviceFromText = findServiceFromText(text, config.services || [])
      const identifiedService =
        (useOrchestratorService ? serviceFromOrchestrator?.name : null) ||
        (serviceFromText ? getServiceWithPrice(config.services || [], serviceFromText)?.name : null) ||
        serviceFromText
      if (identifiedService) {
        nextState.slots.service = identifiedService
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    },
    ask_clarification: async () => {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        return buildResult(
          await generateRejectionMessageWithAI(match.inferred_area, config, false, true),
          nextState
        )
      }
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      if (orchestrator.clarification_question) return buildResult(orchestrator.clarification_question, nextState)
      return null
    },
  }

  return await runOrchestratorAction(orchestrator, handlers)
}

async function handleQualificationOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName, isFirst } = context
  const cordial = getCordialPrefix(config, isFirst)

  const handlers: OrchestratorActionHandlers = {
    no_match_fallback: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      return buildResult(buildGenericFallback(config), nextState)
    },
    answer_price: async () => {
      const svc = orchestrator.inferred_service
        ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
        : null
      if (orchestrator.inferred_service && !svc) {
        const rejectionMessage = await generateRejectionMessageWithAI(orchestrator.inferred_service, config, isFirst, true)
        return buildResult(rejectionMessage, nextState)
      }
      if (!svc && isPriceQuestion(text) && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
          return buildResult(rejectionMessage, nextState)
        }
      }
      if (svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        return buildResult(
          cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildServicesListResult(config, nextState, cordial)
      }
      return null
    },
    list_services: async () => {
      if (isPriceQuestion(text) && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
          return buildResult(rejectionMessage, nextState)
        }
      }
      const listMsg = buildListServicesMessage(config, { intro: "after_generic" })
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(listMsg, { ...nextState, last_service_options: serviceOptions }, serviceOptions)
    },
    start_booking: async () => {
      nextState.mode = "booking"
      nextState.step = undefined
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) || orchestrator?.inferred_attendees === "multiple") {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromOrchestrator = orchestrator.inferred_service ? getServiceWithPrice(config.services || [], orchestrator.inferred_service) : null
      const msgNorm = normalizeText(text)
      const useOrchestratorService =
        serviceFromOrchestrator && msgNorm.includes(normalizeText(serviceFromOrchestrator.name))
      const serviceFromText = findServiceFromText(text, config.services || [])
      const identifiedService =
        (useOrchestratorService ? serviceFromOrchestrator?.name : null) ||
        (serviceFromText ? getServiceWithPrice(config.services || [], serviceFromText)?.name : null) ||
        serviceFromText
      if (identifiedService) {
        nextState.slots.service = identifiedService
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    },
    ask_clarification: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, nextState)
      if (orchestrator.clarification_question) return buildResult(orchestrator.clarification_question, nextState)
      return null
    },
  }

  return await runOrchestratorAction(orchestrator, handlers)
}

async function handleFirstMessageOrchestratorAction(
  orchestrator: any,
  context: SimulatorHandlerContext
): Promise<SimulatorResult | null> {
  const { text, config, nextState, history, senderDisplayName } = context
  const greeting = getGreetingMessage(config)
  const priceIntro = `Obrigado por entrar em contato${config.business_name ? ` com a ${config.business_name}` : ""}.`

  const handlers: OrchestratorActionHandlers = {
    answer_price: async () => {
      const serviceName =
        orchestrator?.inferred_service ?? findServiceFromText(text, config.services || []) ?? (await classifyServiceMatch(text, config)).service
      const svc = serviceName ? getServiceWithPrice(config.services || [], serviceName) : null
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        return buildResult(
          priceIntro + " " + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (serviceName && svc) {
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(priceIntro + " " + noPrice.message, nextState, noPrice.action_options)
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.last_service_options = (config.services || []).map((s) => s.name).filter(Boolean)
        return buildServicesListResult(config, nextState, priceIntro)
      }
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(priceIntro + " " + noPrice.message, nextState, noPrice.action_options)
    },
    list_services: async () => {
      const listMsg = buildServicesListWithPrices(config)
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      return buildResult(
        `${greeting}\n\n${listMsg}`,
        { ...nextState, step: "qualification", last_service_options: serviceOptions },
        serviceOptions
      )
    },
    start_booking: async () => {
      nextState.mode = "booking"
      nextState.step = undefined
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem serÃ¡ o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceName = orchestrator?.inferred_service ?? findServiceFromText(text, config.services || [])
      if (serviceName) {
        nextState.slots.service = serviceName
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState, history, senderDisplayName)
      }
      const prompt = buildServicePrompt(config, text, { attendee_name: nextState.slots.attendee_name })
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    },
    service_detail: async () => {
      const serviceName = orchestrator?.inferred_service ?? findServiceFromText(text, config.services || [])
      const svc = serviceName ? getServiceWithPrice(config.services || [], serviceName) : null
      if (svc?.description) {
        return buildResult(greeting + " " + `${svc.name}: ${svc.description} Quer agendar?`, nextState, ["Quero agendar"])
      }
      if (serviceName) {
        return buildResult(
          greeting + " " + `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`,
          nextState,
          ["Quero agendar"]
        )
      }
      return null
    },
    ask_clarification: async () => {
      const msg = orchestrator?.clarification_question?.trim() || buildClarificationMessage(config)
      return buildResult(msg, { ...nextState, step: "qualification" })
    },
    no_match_fallback: async () => {
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer) return buildResult(aiAnswer, { ...nextState, step: "qualification" })
      return buildResult(buildGenericFallback(config), { ...nextState, step: "qualification" })
    },
  }

  return await runOrchestratorAction(orchestrator, handlers)
}

function ensureConversationMode(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState
): SimulatorResult | null {
  if (nextState.mode) return null

  const canSetMode =
    nextState.slots.service ||
    !config.lead_policy?.reject_unlisted_services ||
    (config.services || []).length === 0

  if (!canSetMode) {
    if (!nextState.step) {
      return buildResult("Para eu te ajudar melhor, qual o assunto ou Ã¡rea que vocÃª precisa?", { ...nextState, step: "qualification" })
    }
    return null
  }

  if (config.context_mode && config.context_mode !== "both") {
    nextState.mode = config.context_mode
    return null
  }

  const detected = detectModeFromText(text)
  if (!detected) {
    return buildResult("Voce prefere agendar um horario ou pedir um orcamento?", { ...nextState, step: "ask_mode" })
  }
  nextState.mode = detected
  return null
}

async function handleBookingModeMessage(context: SimulatorHandlerContext): Promise<SimulatorResult> {
  const { text, config, nextState, history, senderDisplayName, isFirst } = context
  const cordial = getCordialPrefix(config, isFirst)

  if (isPriceQuestion(text)) {
    const serviceName = findServiceFromText(text, config.services || [])
    const svc = getServiceWithPrice(config.services || [], serviceName)
    if (serviceName && svc && svc.base_price != null) {
      nextState.slots.service = svc.name
      nextState.just_identified_service = true
      return buildResult(
        cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
        nextState,
        ["Quero agendar", "Só queria saber"]
      )
    }
    if (serviceName && svc) {
      const noPrice = buildPriceNotAvailableMessage(config, serviceName)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }
    if (!serviceName && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
        return buildResult(rejectionMessage, nextState)
      }
    }
    const withPrice = (config.services || []).filter((s) => s.base_price != null)
    if (withPrice.length > 0) {
      const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
      nextState.last_service_options = serviceOptions
      return buildServicesListResult(config, nextState, cordial)
    }
    const noPrice = buildPriceNotAvailableMessage(config)
    return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
  }

  if (isListServicesQuestion(text)) {
    return buildServicesListResult(config, nextState, cordial)
  }

  if (isServiceDetailQuestion(text)) {
    const serviceName = findServiceFromText(text, config.services || [])
    const svc = getServiceWithPrice(config.services || [], serviceName)
    if (svc?.description) {
      return buildResult(cordial + `${svc.name}: ${svc.description} Quer agendar?`, nextState, ["Quero agendar"])
    }
    if (serviceName) {
      return buildResult(
        cordial + `Os detalhes do ${serviceName} podem ser combinados direto conosco. Quer que eu te ajude a agendar?`,
        nextState,
        ["Quero agendar"]
      )
    }
  }

  if (isFirst && !isGreeting(text)) {
    const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
    return buildResult(result.message, result.state, result.action_options)
  }

  return await resolveBooking(config, text, nextState, history, senderDisplayName)
}

async function processSimulatorMessage(
  input: string,
  config: SimulatorConfig,
  state: SimulatorState,
  history: Array<{ role: string; content: string }> = [],
  senderDisplayName?: string,
  runtime?: ConversationRuntimeContext
): Promise<SimulatorResult> {
  const incomingText = input.trim()
  const numericServiceResolved = tryResolveNumericServiceSelection(incomingText, state)
  let numericActionResolved: string | null = null
  if (/^[1-9]\d*$/.test(incomingText) && Array.isArray(state.last_action_options) && state.last_action_options.length > 0) {
    const idx = parseInt(incomingText, 10) - 1
    if (idx >= 0 && idx < state.last_action_options.length) {
      const raw = String(state.last_action_options[idx] || "").trim()
      numericActionResolved = raw.replace(/^\d+\s*-\s*/, "").trim()
    }
  }
  const text = numericActionResolved || numericServiceResolved || incomingText
  const textNorm = normalizeText(text)
  const hasForcedBookingAction = normalizeText(String(numericActionResolved || "")) === "quero agendar"
  const hasStrongBookingIntent =
    hasForcedBookingAction ||
    isExplicitBookingIntent(text) ||
    /\b(quero|gostaria|preciso|pode|sim)\b.*\b(agendar|marcar)\b/.test(textNorm)

  // Trava mínima: mensagens muito curtas (ex: "O", "a") — mensagem clara respeitando o tom do negócio.
  const MIN_MSG_LENGTH = 2
  const isNumericOption =
    /^[1-9]\d*$/.test(text) && Array.isArray(state.last_action_options) && state.last_action_options.length > 0
  if (text.length > 0 && text.length < MIN_MSG_LENGTH && !isNumericOption) {
    return buildResult(buildClarificationMessage(config), { ...state, step: "qualification" })
  }
  const nextState: SimulatorState = {
    ...state,
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const isFirst = isFirstMessage(state)
  const minOrchestratorConfidence = 0.5
  let orchestratorCached: FlowOrchestratorOutput | null | undefined = undefined
  const getOrchestrator = async (): Promise<FlowOrchestratorOutput | null> => {
    if (orchestratorCached !== undefined) return orchestratorCached
    orchestratorCached = await interpretFlowWithAI(text, history, nextState, config)
    return orchestratorCached
  }

  // Bypass determinístico: opção numérica "Quero agendar" deve iniciar fluxo de booking sempre.
  if (hasForcedBookingAction) {
    nextState.mode = "booking"
    nextState.step = undefined
    return await resolveBooking(config, "quero agendar", nextState, history, senderDisplayName)
  }

  const earlyRuleResult = applyConversationRules(earlyConversationRules, { text, config, nextState })
  if (earlyRuleResult) return earlyRuleResult

  // FASE 7: Cliente consultando agenda (comando interno) → resposta genérica, nunca mostrar agenda real
  if (runtime?.isExternalActor) {
    const agendaQueryPattern =
      /\b(quais?\s+s[aã]o\s+(os\s+)?meus?\s+agendamentos?)\b/i.test(textNorm) ||
      /\b(meus?\s+compromissos?|minha\s+agenda|agenda\s+de\s+hoje|agendamentos?\s+de\s+hoje)\b/i.test(textNorm) ||
      /\b(quero\s+ver\s+(os\s+)?(meus?\s+)?agendamentos?)\b/i.test(textNorm)
    if (agendaQueryPattern) {
      return buildResult(
        "Posso te ajudar a agendar uma visita ou tirar dúvidas sobre nossos serviços. O que você prefere?",
        nextState,
        ["Quero agendar", "Tirar dúvidas"]
      )
    }
  }

  if (runtime) {
    const anytimeCancellationResult = await tryHandleCancellationAnytime(runtime, text, nextState, senderDisplayName)
    if (anytimeCancellationResult) return anytimeCancellationResult
  }

  const anytimePriceResult = tryHandlePriceQuestionAnytime(config, text, nextState)
  if (anytimePriceResult) return anytimePriceResult

  const anytimeServicesResult = tryHandleServicesQuestionAnytime(config, text, nextState)
  if (anytimeServicesResult) return anytimeServicesResult

  const anytimeAvailabilityResult = await tryHandleAvailabilityQuestionAnytime(
    config,
    text,
    nextState,
    history
  )
  if (anytimeAvailabilityResult) return anytimeAvailabilityResult

  // Conversa finalizada: responder só o que foi perguntado (endereço, horários etc.) sem pedir confirmação de novo
  if (isFinalizedState(nextState)) {
    const msg = normalizeText(text)
    const isThanks =
      /^(muito\s+)?(obrigad|valeu|agradec)[oas]?\.?$/.test(msg) ||
      /^(obrigad|valeu)[oas]?,\s*(obrigad|valeu)[oas]?\.?$/.test(msg) ||
      isThanksOrClosingPhrase(text)
    if (isThanks) {
      const company = config.business_name ? `A ${config.business_name}` : "A empresa"
      const saudacao = getGreetingByTime()
      nextState.final_thanks_sent = true
      return buildResult(`Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`, nextState)
    }
    // Primeiro: perguntas sobre a marcação do próprio cliente (ex: "qual dia e horário foi marcado?")
    if (isMyBookingQuestion(msg)) {
      const myBookingAnswer = getMyBookingAnswer(nextState)
      if (myBookingAnswer) {
        nextState.final_thanks_sent = true
        return buildResult(myBookingAnswer, nextState)
      }
    }
    // Prioridade: resposta informativa (endereço, horários, serviços) sem CTA de reagendar — conectar ao fluxo que o cliente acabou de confirmar
    const infoAnswer = tryAnswerInformationalQuestion(config, text)
    if (infoAnswer) {
      nextState.final_thanks_sent = true
      return buildResult(infoAnswer, nextState)
    }
    // Fallback: IA (não deve sugerir novo agendamento aqui; cliente já confirmou)
    const aiAnswer = await answerWithContextualAI(config, text, history, true)
    if (aiAnswer?.trim()) {
      nextState.final_thanks_sent = true
      return buildResult(aiAnswer, nextState)
    }
    nextState.final_thanks_sent = true
    return buildResult("Se precisar de algo no futuro, fico à disposição.", nextState)
  }

  // Regra global: rejeitar pedido de serviço/área que não atendemos (ex.: criminal), em qualquer momento da conversa
  if (
    config.lead_policy?.reject_unlisted_services &&
    (config.services || []).length > 0 &&
    !nextState.slots.service &&
    !isGreeting(text)
  ) {
    const matchUnlisted = await classifyServiceMatch(text, config)
    if (matchUnlisted.reject) {
      const hasContext = hasMatchContext(matchUnlisted)
      const rejectionMessage = await generateRejectionMessageWithAI(
        matchUnlisted.inferred_area,
        config,
        isFirst,
        hasContext
      )
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
    }
  }

  // Primeira interacao: usar IA para responder com linguagem natural e contexto do negocio.
  if (isFirst && isGreeting(text)) {
    const aiGreeting = await answerWithContextualAI(config, text, history)
    if (aiGreeting) return buildResult(aiGreeting, { ...nextState, step: "qualification" }, getEntryActionOptions(config))
    return buildResult(getGreetingMessage(config), { ...nextState, step: "qualification" }, getEntryActionOptions(config))
  }

  // PRIORIDADE: Se é primeira mensagem — IA interpreta intenção e responde com contexto (consierge)
  if (isFirst && !nextState.mode && !nextState.step) {
    const greeting = getGreetingMessage(config)

    // Primeira mensagem com horário específico: checar disponibilidade antes da IA para não inventar "intervalo" em vez de pausa/expediente
    const timeFromFirstMsg = parseTime(text)
    const dateFromFirstMsg = parseDateOrWeekday(text) || addDaysToIsoDate(getTodayIsoBusinessTz(), 1)
    if (timeFromFirstMsg && dateFromFirstMsg) {
      const staffList = getStaffList(config)
      const staffNameFirst = staffList[0]?.name
      const scheduleFirst = getScheduleForStaff(config, staffNameFirst)
      const serviceFirst = findServiceFromText(text, config.services || []) || (config.services || [])[0]?.name
      const durationFirst = getServicesTotalDuration(config, serviceFirst) ?? 30
      const availabilityFirst = getMockAvailability(
        dateFromFirstMsg,
        scheduleFirst,
        nextState.booked_slots,
        staffNameFirst,
        durationFirst
      )
      const normalizedFirstTime =
        timeFromFirstMsg.includes(":") ? timeFromFirstMsg : `${timeFromFirstMsg.padStart(2, "0")}:00`
      const isAvailableFirst = availabilityFirst.available.includes(normalizedFirstTime)
      if (!isAvailableFirst) {
        const withinFirst = isWithinSchedule(normalizedFirstTime, scheduleFirst)
        const unavailableReasonFirst = withinFirst.ok ? undefined : withinFirst.reason
        const fluidFirst = await generateAvailabilityResponseWithAI(
          config,
          {
            requested_time: normalizedFirstTime,
            date_iso: dateFromFirstMsg,
            is_available: false,
            available_slots: availabilityFirst.available.slice(0, 12),
            service: serviceFirst || undefined,
            unavailable_reason: unavailableReasonFirst,
          },
          history
        )
        const stateAfterFirst = { ...nextState, step: "qualification" as const }
        if (serviceFirst) stateAfterFirst.slots = { ...stateAfterFirst.slots, service: serviceFirst }
        stateAfterFirst.slots = { ...stateAfterFirst.slots, date: dateFromFirstMsg }
        if (staffNameFirst) stateAfterFirst.slots = { ...stateAfterFirst.slots, staff_name: staffNameFirst }
        return buildResult(
          `${greeting}\n\n${fluidFirst}`,
          stateAfterFirst,
          availabilityFirst.available.length > 0
            ? availabilityFirst.available.slice(0, 8).map((t, i) => `${i + 1} - ${t}`)
            : ["Quero agendar"]
        )
      }
    }

    // Primeiro: IA responde (horário para amanhã, endereço, serviços, etc.) usando config + histórico
    const firstAiAnswer = await answerWithContextualAI(config, text, history)
    if (firstAiAnswer?.trim()) {
      return buildResult(`${greeting}\n\n${firstAiAnswer}`, { ...nextState, step: "qualification" }, getEntryActionOptions(config))
    }
    // Fallback só se IA indisponível
    const firstInfoAnswer = tryAnswerInformationalQuestion(config, text)
    if (firstInfoAnswer) {
      return buildResult(`${greeting}\n\n${firstInfoAnswer}`, { ...nextState, step: "qualification" }, getEntryActionOptions(config))
    }

    // Em contexto "both", se a mensagem já indica claramente orçamento, não pode cair em booking.
    if (config.context_mode === "both") {
      const detectedMode = detectModeFromText(text)
      if (detectedMode === "quote") {
        nextState.mode = "quote"
        nextState.step = "quote"
        return handleQuoteModeMessage(config, text, nextState)
      }
    }

    const orchestrator = await getOrchestrator()
    const hasConfidentOrchestrator = orchestrator && (orchestrator.confidence ?? 0) >= minOrchestratorConfidence

    if (hasConfidentOrchestrator) {
      const handled = await handleFirstMessageOrchestratorAction(orchestrator, {
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        isFirst,
      })
      if (handled) return handled
    }

    // Baixa confiança ou IA indisponível — tratar como mensagem ambígua (clara, respeitando o tom)
    const aiAnswer = await answerWithContextualAI(config, text, history)
    if (aiAnswer) return buildResult(aiAnswer, { ...nextState, step: "qualification" })
    return buildResult(buildClarificationMessage(config), { ...nextState, step: "qualification" })
  }

  if (!nextState.slots.service) {
    const exactService = findServiceByExactMatch(text, config.services || [])
    if (exactService) {
      nextState.slots.service = exactService
    } else {
      const service = findServiceFromText(text, config.services || [])
      if (service) nextState.slots.service = service
      else if (isVisitRequest(text)) nextState.slots.service = "visita"
    }
  }

  const postServiceRuleResult = applyConversationRules(postServiceResolutionRules, { text, config, nextState })
  if (postServiceRuleResult) return postServiceRuleResult

  // Encerrar conversa após agradecimento final para evitar loop
  if (isFinalizedState(nextState)) {
    const msg = normalizeText(text)
    if (/\b(obrigad|valeu|agradec)\b/.test(msg)) {
      const company = config.business_name ? `A ${config.business_name}` : "A empresa"
      const saudacao = getGreetingByTime()
      nextState.final_thanks_sent = true
      return buildResult(`Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`, nextState)
    }
  }

  if (nextState.step === "qualification_rejected") {
    const n = normalizeText(text)
    const isShortDecline =
      /^(entendi|ok|t[a??] ok|tudo bem|obrigado|obrigada|valeu|nao|n??o)$/.test(n) ||
      /^(entendi|ok|tudo bem)[,\s]+(obrigad|valeu)/.test(n) ||
      isPoliteDecline(text)
    if (isShortDecline) return handleShortDecline(config, nextState)

    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }

    // Prioridade: regex (ágil) ou orquestrador (IA como consierge — qualquer redação)
    let shouldEnterBooking = hasStrongBookingIntent
    const orchForBooking = await getOrchestrator()
    if (
      !shouldEnterBooking &&
      orchForBooking?.suggested_action === "start_booking" &&
      (orchForBooking.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBooking = true
    }
    if (shouldEnterBooking) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBooking?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBooking.inferred_service
        nextState.just_identified_service = true
      }
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState, history, senderDisplayName)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    const orchestrator = await getOrchestrator()
    if (orchestrator && orchestrator.confidence >= minOrchestratorConfidence) {
      const handled = await handleQualificationRejectedOrchestratorAction(orchestrator, {
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        isFirst: false,
      })
      if (handled) return handled
    }

    if (isPriceQuestion(text)) {
      const cordial = getCordialPrefix(config, false)
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        return buildResult(
          cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (!serviceName && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
          return buildResult(rejectionMessage, nextState)
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildServicesListResult(config, nextState, cordial)
      }
    }

    // Regex ou orquestrador (IA como consierge — qualquer estilo)
    let shouldEnterBooking2 = hasStrongBookingIntent
    const orchForBooking2 = await getOrchestrator()
    if (
      !shouldEnterBooking2 &&
      orchForBooking2?.suggested_action === "start_booking" &&
      (orchForBooking2.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBooking2 = true
    }
    if (shouldEnterBooking2) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBooking2?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBooking2.inferred_service
        nextState.just_identified_service = true
      }
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        return resolveBooking(config, text, nextState, history, senderDisplayName)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, true)
        return buildResult(rejectionMessage, nextState)
      }
    }

    const match = await classifyServiceMatch(text, config)
    const hasContext = hasMatchContext(match)
    const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, false, hasContext)
    return buildResult(rejectionMessage, nextState)
  }

  if (nextState.step === "qualification") {
    // NÃO chamar a IA primeiro: priorizar entrada em booking e coleta de slots (nome, contato).
    // A IA só é usada como fallback no final do bloco, para perguntas que não são agendamento.
    const infoAnswer = tryAnswerInformationalQuestion(config, text)
    if (infoAnswer) {
      return buildResult(infoAnswer, nextState)
    }

    // Triagem: SEMPRE verificar contexto da mensagem antes de mostrar menu
    if (
      !isGreeting(text) &&
      (config.services || []).length > 0 &&
      !nextState.slots.service &&
      (config.lead_policy?.reject_unlisted_services || config.lead_policy?.use_ai_matching)
    ) {
      const match = await classifyServiceMatch(text, config)
      const hasContext = hasMatchContext(match)
      if (match.service) {
        nextState.slots.service = match.service
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const areaMatches = areaMatchesServices(match.inferred_area, config.services || [])
      if (match.reject || (hasContext && !match.service && !areaMatches)) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
      }
    }

    const cordial = getCordialPrefix(config, isFirst)
    const n = normalizeText(text)
    const isShortDecline =
      /^(entendi|ok|t[a??] ok|tudo bem|obrigado|obrigada|valeu|nao|n??o)$/.test(n) ||
      /^(entendi|ok|tudo bem)[,\s]+(obrigad|valeu)/.test(n) ||
      isPoliteDecline(text)
    if (isShortDecline) return handleShortDecline(config, nextState)

    if (isDirectServiceInquiry(text) && (config.services || []).length > 0) {
      const match = await classifyServiceMatch(text, config)
      if (hasMatchContext(match) && !match.service) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
        return buildResult(rejectionMessage, nextState)
      }
    }

    // Regex ou orquestrador (IA como consierge — qualquer estilo)
    let shouldEnterBookingQ = hasStrongBookingIntent
    const orchForBookingQ = await getOrchestrator()
    if (
      !shouldEnterBookingQ &&
      orchForBookingQ?.suggested_action === "start_booking" &&
      (orchForBookingQ.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBookingQ = true
    }
    if (shouldEnterBookingQ) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBookingQ?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBookingQ.inferred_service
        nextState.just_identified_service = true
      }
      const sequenceServices = getSequenceServicesFromText(config, text)
      if (sequenceServices.length >= 2) {
        nextState.slots.service = sequenceServices.join(", ")
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const isMultiBookingPrompt = /De quem sera(o)? o primeiro agendamento/i.test(result.message)
        const message = isMultiBookingPrompt ? result.message : `${buildBookingConfirmationIntro(config)} ${result.message}`
        return buildResult(message, result.state, result.action_options)
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    const orchestrator = await getOrchestrator()
    if (orchestrator && orchestrator.confidence >= minOrchestratorConfidence) {
      const handled = await handleQualificationOrchestratorAction(orchestrator, {
        text,
        config,
        nextState,
        history,
        senderDisplayName,
        isFirst,
      })
      if (handled) return handled
    }

    // Última chance: regex ou orquestrador (IA como consierge — qualquer estilo)
    let shouldEnterBookingQ2 = hasStrongBookingIntent
    const orchForBookingQ2 = await getOrchestrator()
    if (
      !shouldEnterBookingQ2 &&
      orchForBookingQ2?.suggested_action === "start_booking" &&
      (orchForBookingQ2.confidence ?? 0) >= minOrchestratorConfidence
    ) {
      shouldEnterBookingQ2 = true
    }
    if (shouldEnterBookingQ2) {
      nextState.mode = "booking"
      nextState.step = undefined
      if (orchForBookingQ2?.inferred_service && !nextState.slots.service) {
        nextState.slots.service = orchForBookingQ2.inferred_service
        nextState.just_identified_service = true
      }
      const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
      if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
        nextState.pending_additional_booking = true
        nextState.pending_attendee_name = true
        nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
        nextState.expected_additional_count = nextState.pending_additional_count
        return buildResult(`${buildMultiBookingIntro()} De quem será o primeiro agendamento?`, nextState)
      }
      if (interpreted?.for_whom) nextState.slots.attendee_name = interpreted.for_whom
      const serviceFromText = nextState.slots.service || findServiceFromText(text, config.services || [])
      if (serviceFromText) {
        nextState.slots.service = serviceFromText
        nextState.just_identified_service = true
        const result = await resolveBooking(config, text, nextState, history, senderDisplayName)
        const intro = buildBookingConfirmationIntro(config)
        return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
      }
      const prompt = buildServicePrompt(config, text)
      nextState.last_service_options = buildServiceOptions(config.services || [])
      return buildResult(prompt.message, nextState, prompt.action_options)
    }

    if (isListServicesQuestion(text)) {
      return buildServicesListResult(config, nextState, cordial)
    }

    if (isPriceQuestion(text)) {
      const serviceName = findServiceFromText(text, config.services || [])
      const svc = getServiceWithPrice(config.services || [], serviceName)
      if (serviceName && svc && svc.base_price != null) {
        nextState.slots.service = svc.name
        nextState.just_identified_service = true
        nextState.step = undefined
        nextState.mode = "booking"
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        return buildResult(
          cordial + `O ${svc.name} está R$ ${Number(svc.base_price).toFixed(2).replace(".", ",")}. Gostaria de agendar?`,
          nextState,
          ["Quero agendar", "Só queria saber"]
        )
      }
      if (serviceName && svc) {
        const aiAnswer = await answerWithContextualAI(config, text, history)
        if (aiAnswer && /R\$\s*\d/.test(aiAnswer)) return buildResult(aiAnswer, nextState, ["Quero agendar", "Só queria saber"])
        const noPrice = buildPriceNotAvailableMessage(config, serviceName)
        return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
      }
      if (!serviceName && (config.services || []).length > 0) {
        const match = await classifyServiceMatch(text, config)
        if (hasMatchContext(match) && !match.service) {
          const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, true)
          return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
        }
      }
      const withPrice = (config.services || []).filter((s) => s.base_price != null)
      if (withPrice.length > 0) {
        nextState.mode = "booking"
        nextState.step = undefined
        const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false, history })
        if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0)) {
          nextState.pending_additional_booking = true
          nextState.pending_attendee_name = true
          nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
          nextState.expected_additional_count = nextState.pending_additional_count
        } else if (interpreted?.for_whom) {
          nextState.slots.attendee_name = interpreted.for_whom
        }
        const serviceOptions = (config.services || []).map((s) => s.name).filter(Boolean)
        nextState.last_service_options = serviceOptions
        return buildServicesListResult(config, nextState, cordial)
      }
      const aiAnswer = await answerWithContextualAI(config, text, history)
      if (aiAnswer && /R\$\s*\d/.test(aiAnswer)) return buildResult(aiAnswer, nextState, ["Quero agendar", "Só queria saber"])
      const noPrice = buildPriceNotAvailableMessage(config)
      return buildResult(cordial + noPrice.message, nextState, noPrice.action_options)
    }

    // Fallback: IA consierge só quando não entrou em booking nem em nenhum fluxo acima
    const qualAiAnswer = await answerWithContextualAI(config, text, history)
    if (qualAiAnswer?.trim()) {
      return buildResult(qualAiAnswer, nextState)
    }

    const match = await classifyServiceMatch(text, config)
    if (match.service) {
      nextState.slots.service = match.service
      nextState.just_identified_service = true
      nextState.step = undefined
    } else if (match.reject || config.lead_policy?.reject_unlisted_services) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      if (match.reject) return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
      if (hasContext && (config.services || []).length > 0) {
        return buildResult(rejectionMessage, nextState)
      }
      return buildResult(buildGuidedClarification(config), nextState)
    } else {
      const hasContext = hasMatchContext(match)
      if (hasContext && (config.services || []).length > 0) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, nextState)
      }
      return buildResult(buildGuidedClarification(config), nextState)
    }
  }

  // Se é primeira mensagem, SEMPRE verificar contexto primeiro (mesmo que comece com "oi")
  // Isso garante que mensagens como "oi, prenderam meu filho" sejam processadas corretamente

  if (
    config.lead_policy?.reject_unlisted_services &&
    (config.services || []).length > 0 &&
    !nextState.slots.service &&
    !isGreeting(text) &&
    !isFirst
  ) {
    const match = await classifyServiceMatch(text, config)
    if (match.service) {
      nextState.slots.service = match.service
      nextState.just_identified_service = true
    } else if (match.reject) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
    } else {
      // Verificar se há contexto suficiente
      const hasContext = hasMatchContext(match)
      if (hasContext) {
        const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, { ...nextState, step: "qualification" })
      }
      return buildResult(buildGuidedClarification(config), {
        ...nextState,
        step: "qualification",
      })
    }
  }

  if (!nextState.mode && isGreeting(text)) {
    const greeting = getGreetingMessage(config)
    return buildResult(greeting, { ...nextState, step: "qualification" })
  }

  const modeResult = ensureConversationMode(text, config, nextState)
  if (modeResult) return modeResult

  if (nextState.step === "ask_mode" && !nextState.mode) {
    const detected = detectModeFromText(text)
    if (!detected) {
      return buildResult("Entendi. Voce quer agendar um horario ou pedir um orcamento?", nextState)
    }
    nextState.mode = detected
  }

  // Verificar se o serviço existe ANTES de entrar no modo booking
  // Isso previne que o bot tente agendar serviços que não existem
  if (nextState.mode === "booking" && 
      !nextState.slots.service && 
      config.lead_policy?.reject_unlisted_services &&
      (config.services || []).length > 0 &&
      !isGreeting(text)) {
    const match = await classifyServiceMatch(text, config)
    if (match.reject || (match.inferred_area && match.inferred_area !== "indefinido" && !match.service)) {
      const hasContext = hasMatchContext(match)
      const rejectionMessage = await generateRejectionMessageWithAI(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected", mode: undefined })
    }
  }

  if (nextState.mode === "booking") {
    return await handleBookingModeMessage({
      text,
      config,
      nextState,
      history,
      senderDisplayName,
      isFirst,
    })
  }

  return resolveQuote(config, text, nextState)
}

async function getTenantById(supabaseAdmin: any, tenantId: string) {
  const { data, error } = await supabaseAdmin.from("tenant").select("id, name, slug").eq("id", tenantId).single()
  if (error || !data) return null
  return data
}

async function getOrCreateTenant(supabaseAdmin: any, sessionId: string, businessName?: string) {
  const slug = `sim-${sessionId}`
  const { data: existing } = await supabaseAdmin.from("tenant").select("*").eq("slug", slug).maybeSingle()
  if (existing) return existing

  const { data, error } = await supabaseAdmin
    .from("tenant")
    .insert({ name: businessName || `Simulador ${sessionId}`, slug })
    .select()
    .single()
  if (error) throw error
  return data
}

/** Cria um agente default para tenant de simulador (onboarding) que ainda não tem agente. */
async function getOrCreateAgentForSimTenant(supabaseAdmin: any, tenantId: string, tenantName?: string) {
  const { data: existing } = await supabaseAdmin
    .from("agent")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const { data: newAgent, error } = await supabaseAdmin
    .from("agent")
    .insert({
      tenant_id: tenantId,
      name: tenantName || "Agente Simulador",
      status: "active",
      channel_primary: "web",
    })
    .select("id")
    .single()
  if (error) throw error

  await supabaseAdmin.from("agent_setting").insert({
    agent_id: newAgent.id,
    tone: "professional",
    language: "pt-BR",
    handoff_mode: "conditional",
    business_config: {},
    when_client_asks_price_no_value: "offer_handoff_or_booking",
  })
  return newAgent.id
}

type ChannelType = "web_simulator" | "whatsapp"

async function getOrCreateChannel(supabaseAdmin: any, tenantId: string, agentId: string, channelType: ChannelType = "web_simulator") {
  const dbType = channelType === "whatsapp" ? "whatsapp" : "web_chat"
  const simSlug = `sim-${tenantId}-${agentId}`
  let existing: any = null
  if (dbType === "web_chat") {
    const { data } = await supabaseAdmin
      .from("channel")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .eq("type", "web_chat")
      .eq("chat_slug", simSlug)
      .maybeSingle()
    existing = data
  } else {
    const { data } = await supabaseAdmin
      .from("channel")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .eq("type", "whatsapp")
      .maybeSingle()
    existing = data
  }
  if (existing) return existing

  const insertPayload =
    channelType === "whatsapp"
      ? { tenant_id: tenantId, agent_id: agentId, type: "whatsapp", provider: "twilio", provider_config: {}, is_active: true }
      : { tenant_id: tenantId, agent_id: agentId, type: "web_chat", chat_slug: simSlug, is_active: true }
  const { data, error } = await supabaseAdmin
    .from("channel")
    .insert(insertPayload)
    .select()
    .single()
  if (error) throw error
  return data
}

async function getOrCreateContact(supabaseAdmin: any, tenantId: string, channelId: string, sessionId: string, businessName?: string) {
  const { data: existing } = await supabaseAdmin
    .from("contact")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("external_id", sessionId)
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabaseAdmin
    .from("contact")
    .insert({
      tenant_id: tenantId,
      channel_id: channelId,
      external_id: sessionId,
      phone: sessionId,
      display_name: businessName || "Cliente",
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function getOrCreateConversation(
  supabaseAdmin: any,
  tenantId: string,
  channelId: string,
  contactId: string,
  agentId: string,
  conversationId?: string
) {
  if (conversationId) {
    const { data: existing } = await supabaseAdmin
      .from("conversation")
      .select("*")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (existing) return existing
  }

  // Sem conversation_id (ex.: WhatsApp): reutilizar conversa aberta do mesmo contato/canal para manter estado igual ao simulador
  const { data: existingRows } = await supabaseAdmin
    .from("conversation")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1)
  const existingByContact = Array.isArray(existingRows) ? existingRows[0] : null
  if (existingByContact) return existingByContact

  const { data, error } = await supabaseAdmin
    .from("conversation")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      channel_id: channelId,
      contact_id: contactId,
      status: "open",
      context: {},
      state_json: {},
    })
    .select()
    .single()
  if (error) throw error
  return data
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Max-Age": "86400",
      },
    })
  }

  try {
    const body = (await req.json()) as ConversationTurnRequest
    if (!body?.message) {
      return json({ error: "message e obrigatorio" }, 400)
    }
    const isWhatsApp = (body as { channel?: string }).channel === "whatsapp"
    if (isWhatsApp && !(body as { from?: string }).from) {
      return json({ error: "para channel whatsapp, from (numero do remetente) e obrigatorio" }, 400)
    }
    if (!isWhatsApp && !body?.session_id) {
      return json({ error: "session_id e obrigatorio para web_simulator" }, 400)
    }

    const { supabaseAdmin, envError } = createSupabaseAdmin()
    if (envError) return json({ error: envError }, 500)

    const ctxLead = body.context?.lead_policy
    const leadPolicy =
      typeof ctxLead === "object" && ctxLead !== null
        ? { reject_unlisted_services: true, use_ai_matching: true, ...ctxLead }
        : { reject_unlisted_services: true, use_ai_matching: true }

    const incomingCatalogServices = normalizeIncomingServices((body.context as any)?.catalog_services)
    const incomingBookingServices = normalizeIncomingServices((body.context as any)?.booking_services)
    const incomingLegacyServices = normalizeIncomingServices(body.context?.services)
    const resolvedBookingServices = incomingBookingServices.length > 0 ? incomingBookingServices : incomingLegacyServices
    const resolvedCatalogServices = incomingCatalogServices.length > 0 ? incomingCatalogServices : resolvedBookingServices

    const config: SimulatorConfig = {
      business_name: body.context?.business_name,
      business_type: body.context?.business_type,
      context_mode: body.context?.context_mode,
      establishment_address: body.context?.establishment_address,
      tone: body.context?.tone,
      catalog_services: resolvedCatalogServices,
      booking_services: resolvedBookingServices,
      // Compat legado: enquanto houver código antigo, services aponta para booking_services.
      services: resolvedBookingServices,
      when_client_asks_price_no_value: body.context?.when_client_asks_price_no_value || "offer_handoff_or_booking",
      schedule: body.context?.schedule,
      staff: body.context?.staff || [],
      dynamic_variables: body.context?.dynamic_variables || [],
      lead_policy: leadPolicy,
      holidays_attend: body.context?.holidays_attend,
      closure_periods: body.context?.closure_periods,
      allow_sequence_booking: body.context?.allow_sequence_booking ?? false,
      sequence_eligible_services: body.context?.sequence_eligible_services ?? [],
      target_audience: body.context?.target_audience,
      interaction_style: body.context?.interaction_style ?? "hybrid",
      branding: body.context?.branding,
    }

    const tenant = (body as { tenant_id?: string }).tenant_id
      ? await getTenantById(supabaseAdmin, (body as { tenant_id: string }).tenant_id)
      : await getOrCreateTenant(supabaseAdmin, body.session_id, config.business_name)
    if (!tenant) {
      return json({ error: "tenant_id invalido ou nao encontrado" }, 400)
    }

    let agentId = (body as { agent_id?: string }).agent_id
    if (!agentId) {
      const { data: firstAgent } = await supabaseAdmin
        .from("agent")
        .select("id")
        .eq("tenant_id", tenant.id)
        .limit(1)
        .maybeSingle()
      agentId = firstAgent?.id ?? undefined
    }
    if (!agentId) {
      agentId = await getOrCreateAgentForSimTenant(supabaseAdmin, tenant.id, config.business_name)
    }
    if (!agentId) {
      return json({ error: "tenant sem agente configurado; agent_id obrigatorio para conversation/channel" }, 400)
    }

    if (!config.services?.length || !hasAnyConfiguredPrice(config.services)) {
      const servicesFromSettings = await loadServicesFromSettings(supabaseAdmin, tenant.id, agentId)
      if (servicesFromSettings.length > 0) {
        config.services = mergeServicesPreferIncoming(config.services || [], servicesFromSettings)
      }
    }
    if (!config.services?.length || !hasAnyConfiguredPrice(config.services)) {
      const servicesFromOnboarding = await loadServicesFromOnboardingSession(supabaseAdmin, body.session_id)
      if (servicesFromOnboarding.length > 0) {
        config.services = mergeServicesPreferIncoming(config.services || [], servicesFromOnboarding)
      }
    }

    const channelType: ChannelType = (body as { channel?: string }).channel === "whatsapp" ? "whatsapp" : "web_simulator"
    const sessionIdForContact =
      channelType === "whatsapp" && (body as { from?: string }).from
        ? (body as { from: string }).from
        : body.session_id
    const channel = await getOrCreateChannel(supabaseAdmin, tenant.id, agentId, channelType)
    const contact = await getOrCreateContact(supabaseAdmin, tenant.id, channel.id, sessionIdForContact, config.business_name)
    const conversation = await getOrCreateConversation(supabaseAdmin, tenant.id, channel.id, contact.id, agentId, body.conversation_id)

        // Comando para encerrar/reiniciar: fecha a conversa atual e abre uma nova para limpar estado + historico.
    if (isEndTestCommand(body.message)) {
      const nowIso = new Date().toISOString()
      const replyText = "Conversa encerrada. Quando quiser, e so mandar uma mensagem para comecar de novo."
      await supabaseAdmin.from("conversation_messages").insert([
        { tenant_id: tenant.id, conversation_id: conversation.id, role: "user", content_text: body.message, metadata: { channel: channelType } },
        { tenant_id: tenant.id, conversation_id: conversation.id, role: "assistant", content_text: replyText, metadata: { channel: channelType } },
      ])
      await supabaseAdmin
        .from("conversation")
        .update({
          status: "closed",
          state_json: { state: createSimulatorState(), channel: channelType },
          last_message_at: nowIso,
        })
        .eq("id", conversation.id)
        .eq("tenant_id", tenant.id)

      const { data: freshConversation, error: freshConversationError } = await supabaseAdmin
        .from("conversation")
        .insert({
          tenant_id: tenant.id,
          agent_id: agentId,
          channel_id: channel.id,
          contact_id: contact.id,
          status: "open",
          context: {},
          state_json: {},
          last_message_at: nowIso,
        })
        .select()
        .single()
      if (freshConversationError) throw freshConversationError

      return json({
        conversation_id: freshConversation.id,
        messages: [{ role: "assistant", content: replyText, created_at: nowIso, action_options: undefined }],
      })
    }

    // Verificar se é a primeira mensagem da conversa
    const { count: messageCount } = await supabaseAdmin
      .from("conversation_messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("role", "user")
    const isFirstMessage = (messageCount || 0) === 0

    const stateFromConversation = (conversation.state_json?.state as SimulatorState) || createSimulatorState()

    const mergeBookedSlots = (
      base?: Record<string, Record<string, string[]>>,
      extra?: Record<string, Record<string, string[]>>
    ): Record<string, Record<string, string[]>> => {
      const merged: Record<string, Record<string, string[]>> = {}
      const sources = [base || {}, extra || {}]
      for (const src of sources) {
        for (const staffKey of Object.keys(src)) {
          if (!merged[staffKey]) merged[staffKey] = {}
          const byDate = src[staffKey] || {}
          for (const dateIso of Object.keys(byDate)) {
            const existing = new Set(merged[staffKey][dateIso] || [])
            for (const t of byDate[dateIso] || []) existing.add(t)
            merged[staffKey][dateIso] = Array.from(existing).sort()
          }
        }
      }
      return merged
    }

    const toBusinessDateTime = (value: string): { dateIso: string; time: string } => {
      const dt = new Date(value)
      return {
        dateIso: dt.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
        time: dt.toLocaleTimeString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      }
    }

    // Hidrata agenda ocupada real para filtrar horários indisponíveis (além dos slots deste turno).
    let persistedBookedSlots: Record<string, Record<string, string[]>> = {}
    try {
      const todayIso = getTodayIsoBusinessTz()
      const { data: appointmentRows, error: appointmentRowsError } = await supabaseAdmin
        .from("appointment")
        .select("staff_name, start_at, status")
        .eq("tenant_id", tenant.id)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .gte("start_at", `${todayIso}T00:00:00.000-03:00`)
        .limit(3000)
      if (appointmentRowsError) {
        console.error("appointment hydration error:", appointmentRowsError)
      } else {
        for (const row of (appointmentRows || []) as Array<{ staff_name?: string | null; start_at?: string | null }>) {
          if (!row?.staff_name || !row?.start_at) continue
          const { dateIso, time } = toBusinessDateTime(row.start_at)
          persistedBookedSlots = addBookedSlot(persistedBookedSlots, row.staff_name, dateIso, time)
        }
      }
    } catch (hydrationErr) {
      console.error("appointment hydration exception:", hydrationErr)
      // Continua com slots vazios para não bloquear o simulador
    }

    const currentState: SimulatorState = {
      ...stateFromConversation,
      booked_slots: mergeBookedSlots(persistedBookedSlots, stateFromConversation.booked_slots),
    }
    const stateWithFirstFlag = { ...currentState, _isFirstMessage: isFirstMessage }

    const { data: recentMessages } = await supabaseAdmin
      .from("conversation_messages")
      .select("role, content_text")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(12)
    const history = (recentMessages || []).map((m) => ({
      role: m.role || "user",
      content: (m.content_text || "").trim(),
    }))

    // WhatsApp: janela de 24h sem interação encerra (só templates depois). Avisar se inatividade próxima do limite.
    const SESSION_WARN_HOURS = 18
    const SESSION_WINDOW_HOURS = 24
    let sessionExpiryWarning: string | null = null
    if (channelType === "whatsapp") {
      const { data: lastUserRows } = await supabaseAdmin
        .from("conversation_messages")
        .select("created_at")
        .eq("conversation_id", conversation.id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
      const lastUserMsg = Array.isArray(lastUserRows) ? lastUserRows[0] : null
      const lastAt = lastUserMsg?.created_at
      if (lastAt) {
        const lastMs = new Date(lastAt).getTime()
        const nowMs = Date.now()
        const hoursSince = (nowMs - lastMs) / (60 * 60 * 1000)
        if (hoursSince >= SESSION_WARN_HOURS && hoursSince < SESSION_WINDOW_HOURS) {
          const hoursLeft = Math.max(0.5, Math.floor((SESSION_WINDOW_HOURS - hoursSince) * 10) / 10)
          const nome = (currentState as SimulatorState).slots?.customer_name
            || (currentState as SimulatorState).slots?.attendee_name
            || contact?.display_name
            || ""
          const nomePart = nome ? `Oi ${nome}, ` : "Oi, "
          sessionExpiryWarning =
            `${nomePart}ainda está aí? Esta conversa vai encerrar em cerca de ${hoursLeft} hora(s) se não houver mais interação.`
        }
      }
    }

    const senderDisplayName = (body as { sender_display_name?: string }).sender_display_name?.trim() || undefined
    let result: SimulatorResult

    // Intents internas (modo internal, owner/admin): consulta/cancelamento de agenda.
    const incomingMode = (body as { mode?: string }).mode
    const incomingActorType = (body as { actor_type?: string }).actor_type
    const isInternalActor =
      incomingMode === "internal" &&
      (incomingActorType === "owner" || incomingActorType === "admin")

    if (isInternalActor) {
      // FASE 6: Rate limit configurável via ENV (default 20/min)
      const RATE_LIMIT_WINDOW_SEC = 60
      const RATE_LIMIT_MAX = Math.max(1, parseInt(Deno.env.get("INTERNAL_RATE_LIMIT_PER_MINUTE") || "20", 10) || 20)
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString()
      const { count: recentCount, error: countErr } = await supabaseAdmin
        .from("internal_action_log")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .gte("created_at", windowStart)
      if (!countErr && (recentCount ?? 0) >= RATE_LIMIT_MAX) {
        result = {
          message: "Você enviou muitos comandos. Tenta em 30 segundos.",
          state: stateWithFirstFlag,
          action_options: undefined,
        }
      } else {
        await supabaseAdmin.from("internal_action_log").insert({
          tenant_id: tenant.id,
          action: "internal_command",
          payload: { message: body.message },
        })
        const internalResult = await handleInternalIntent({
          supabaseAdmin,
          tenantId: tenant.id,
          agentId,
          message: body.message,
          config: {
            business_name: config.business_name,
            branding: config.branding,
            schedule: config.schedule,
            services: config.services,
          },
          state: stateWithFirstFlag,
          conversationId: conversation.id,
          channelId: channel.id,
        })
        if (internalResult.handled) {
          result = {
            message: internalResult.message,
            state: internalResult.state ?? stateWithFirstFlag,
            action_options: internalResult.action_options,
          }
        } else {
          // Não classificou como intent interna; segue fluxo normal.
          try {
            result = await processSimulatorMessage(body.message, config, stateWithFirstFlag, history, senderDisplayName, {
              supabaseAdmin,
              tenantId: tenant.id,
              agentId,
              contactId: contact.id,
              contact,
              senderDisplayName,
              history,
              config,
            })
          } catch (err) {
            console.error("processSimulatorMessage error:", err)
            result = {
              message: "Desculpe, tive um problema ao processar. Pode repetir?",
              state: stateWithFirstFlag,
              action_options: undefined,
            }
          }
        }
      }
    } else {
      // FASE 5: Orçamento externo (cliente pergunta preço com medidas → faixa + CTA)
      const externalQuoteResult = await tryHandleExternalQuote({
        supabaseAdmin,
        tenantId: tenant.id,
        agentId,
        conversationId: conversation.id,
        message: body.message,
      })
      if (externalQuoteResult.handled) {
        result = {
          message: externalQuoteResult.message || "",
          state: stateWithFirstFlag,
          action_options: externalQuoteResult.action_options,
        }
      } else {
        try {
          result = await processSimulatorMessage(body.message, config, stateWithFirstFlag, history, senderDisplayName, {
            supabaseAdmin,
            tenantId: tenant.id,
            agentId,
            isExternalActor: true,
            contactId: contact.id,
            contact,
            senderDisplayName,
            history,
            config,
          })
        } catch (err) {
          console.error("processSimulatorMessage error:", err)
          result = {
            message: "Desculpe, tive um problema ao processar. Pode repetir?",
            state: stateWithFirstFlag,
            action_options: undefined,
          }
        }
      }
    }

    // Estilo conversacional: nao prefixar opcoes com "1 -", "2 -", etc.
    if (config.interaction_style === "conversational" && Array.isArray(result.action_options)) {
      const denumberedOptions = result.action_options.map((opt) => String(opt || "").replace(/^\d+\s*-\s*/, "").trim())
      result = {
        ...result,
        action_options: denumberedOptions,
        state: {
          ...result.state,
          last_action_options: denumberedOptions,
        },
      }
    }

    const rewritten = await rewriteWithTone(result.message, config.tone)
    const finalMessage = sessionExpiryWarning
      ? `${sessionExpiryWarning}\n\n${rewritten.message}`
      : rewritten.message

    const nowIso = new Date().toISOString()

    await supabaseAdmin.from("conversation_messages").insert([
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "user",
        content_text: body.message,
        metadata: { channel: channelType },
      },
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "assistant",
        content_text: finalMessage,
        metadata: {
          channel: channelType,
          tone: config.tone,
          base_message: result.message,
          used_ai: rewritten.used_ai,
          action_options: result.action_options || null,
        },
      },
    ])

    // Remover flag temporária do estado antes de salvar
    const { _isFirstMessage, ...stateToSave } = result.state as SimulatorState & { _isFirstMessage?: boolean }
    
    const contextUpdate: Record<string, unknown> = {
      ...(conversation.context || {}),
      session_id: sessionIdForContact,
      business_name: config.business_name,
      business_type: config.business_type,
      context_mode: config.context_mode,
      tone: config.tone,
    }
    if (incomingMode === "internal" || incomingMode === "external") {
      contextUpdate.mode = incomingMode
    }
    if (incomingActorType != null && typeof incomingActorType === "string") {
      contextUpdate.actor_type = incomingActorType
    }

    await supabaseAdmin
      .from("conversation")
      .update({
        state_json: { state: stateToSave, channel: channelType },
        context: contextUpdate,
        last_message_at: nowIso,
      })
      .eq("id", conversation.id)
      .eq("tenant_id", tenant.id)

    const tenantIdForAppointment = (body as { tenant_id?: string }).tenant_id
    if (tenantIdForAppointment) {
      const prevLen = (currentState.completed_bookings?.length ?? 0)
      const completed = (stateToSave as SimulatorState).completed_bookings ?? []
      const newBookings = completed.slice(prevLen)
      for (const b of newBookings) {
        const staffName = (b as { staff_name?: string }).staff_name ?? null
        const date = (b as { date?: string }).date
        const time = (b as { time?: string }).time
        const service = (b as { service?: string }).service
        if (!date || !time || !staffName) continue
        // Horário é em hora local do negócio (Brasil). Usar -03:00 para que 15:30 local = 18:30 UTC
        // (evita bug onde 15:30 era armazenado como UTC e exibia 12:30 no calendário)
        const startAt = `${date}T${time}:00.000-03:00`
        const duration = getServicesTotalDuration(config, service) ?? getServiceDurationMinutes(config, service) ?? 30
        const endAt = new Date(Date.parse(startAt) + duration * 60 * 1000).toISOString()
        const serviceNames = parseServiceNames(service)
        const { error: insErr } = await supabaseAdmin.from("appointment").insert({
          tenant_id: tenantIdForAppointment,
          agent_id: agentId,
          contact_id: contact.id,
          attendee_name: (b as { attendee_name?: string }).attendee_name ?? null,
          staff_name: staffName,
          service_names: serviceNames.length > 0 ? serviceNames : service ? [service] : [],
          start_at: startAt,
          end_at: endAt,
          status: "confirmed",
        })
        if (insErr && insErr.code !== "23505") console.error("appointment insert error:", insErr)
      }
    }

    const response: ConversationTurnResponse = {
      conversation_id: conversation.id,
      messages: [
        {
          role: "assistant",
          content: finalMessage,
          created_at: nowIso,
          action_options: result.action_options,
        },
      ],
    }

    return json(response)
  } catch (error: any) {
    console.error("Error na Edge Function:", error)
    return json({ error: error?.message || error?.toString() || "Erro desconhecido" }, 500)
  }
})


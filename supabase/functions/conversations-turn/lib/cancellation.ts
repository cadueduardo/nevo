// @ts-nocheck
/** Fluxo de cancelamento de agendamento (owner/admin). */
import { normalizeText } from "./utils.ts"
import { parseDateOrWeekday, parseTime } from "./utils.ts"
import { resolveOptionByNumber } from "./utils.ts"
import { getTodayIsoBusinessTz } from "./utils.ts"
import { buildResult } from "./state.ts"
import { isYes, isNo } from "./detection.ts"
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "./types.ts"

export type CancelableAppointment = {
  id: string
  attendee_name?: string | null
  staff_name?: string | null
  service_names?: string[] | null
  start_at?: string | null
  status?: string | null
}

/** Runtime mínimo para cancelamento; resolveBooking é injetado pelo index. */
export type CancellationRuntime = {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  isExternalActor?: boolean
  contactId?: string
  contact?: { display_name?: string | null }
  senderDisplayName?: string
  history: Array<{ role: string; content: string }>
  config: SimulatorConfig
  resolveBooking: (
    config: SimulatorConfig,
    text: string,
    state: SimulatorState,
    history: Array<{ role: string; content: string }>,
    senderDisplayName?: string
  ) => Promise<SimulatorResult>
}

export const CANCEL_REASON_OPTIONS = [
  "Mudou de planos",
  "Não poderá comparecer no horário",
  "Encontrou outro horário melhor",
  "Quero reagendar para outro dia",
  "Outro motivo",
  "Prefiro não responder",
]

export function isCancellationIntent(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /(cancel|cancelar|cancelamento|desmarc|desmarcar|desmarca|nao vou poder|nao poderei|nao consigo ir|nao vou conseguir)/.test(msg) ||
    /(quero cancelar|preciso cancelar|gostaria de cancelar)/.test(msg)
  )
}

export function cleanupCancellationState(state: SimulatorState): SimulatorState {
  const next = { ...state }
  ;(next as any).pending_cancel_selection = undefined
  ;(next as any).pending_cancel_confirm = undefined
  ;(next as any).pending_cancel_reason = undefined
  ;(next as any).pending_cancel_reason_custom = undefined
  ;(next as any).pending_cancel_reschedule = undefined
  ;(next as any).cancel_candidates = undefined
  ;(next as any).cancel_target_id = undefined
  ;(next as any).cancel_target_snapshot = undefined
  ;(next as any).cancel_reason = undefined
  return next
}

export function getCancellationIdentityHints(
  state: SimulatorState,
  runtime: CancellationRuntime
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
  maybePush((state as any).last_booking?.attendee_name)
  maybePush(runtime.senderDisplayName)
  maybePush(runtime.contact?.display_name)
  for (const booking of state.completed_bookings || []) maybePush((booking as any).attendee_name)
  return Array.from(hints)
}

export function formatAppointmentOption(appt: CancelableAppointment): string {
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
  const service =
    Array.isArray(appt.service_names) && appt.service_names.length > 0
      ? appt.service_names.join(", ")
      : "serviço"
  const staff = appt.staff_name ? ` com ${appt.staff_name}` : ""
  return `${service} em ${date} às ${time}${staff}`
}

export function filterAppointmentsByText(
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

export async function findCancelableAppointments(
  runtime: CancellationRuntime,
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

export function buildCancellationSuccessMessage(snapshot?: CancelableAppointment | null): string {
  if (!snapshot) return "Pronto, seu agendamento foi cancelado com sucesso."
  return `Pronto, cancelei ${formatAppointmentOption(snapshot)}.`
}

export function prefillRescheduleStateFromCancelledAppointment(
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

export async function tryHandleCancellationAnytime(
  runtime: CancellationRuntime,
  text: string,
  state: SimulatorState,
  senderDisplayName?: string
): Promise<SimulatorResult | null> {
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
      return buildResult(
        "Não consegui identificar qual agendamento você quer cancelar. Escolha uma opção da lista.",
        nextState,
        options
      )
    }
    ;(nextState as any).cancel_target_id = selected.id
    ;(nextState as any).cancel_target_snapshot = selected
    ;(nextState as any).pending_cancel_selection = undefined
    ;(nextState as any).pending_cancel_confirm = true
    return buildResult(
      `Confirma o cancelamento de ${formatAppointmentOption(selected)}?`,
      nextState,
      ["Sim, cancelar", "Não, manter"]
    )
  }

  if ((nextState as any).pending_cancel_confirm) {
    if (isNo(msg)) {
      return buildResult("Perfeito, mantive seu agendamento como está.", cleanupCancellationState(nextState))
    }
    if (!isYes(msg) && !/(cancelar|confirmar)/.test(msg)) {
      return buildResult(
        "Posso cancelar agora. Você confirma o cancelamento?",
        nextState,
        ["Sim, cancelar", "Não, manter"]
      )
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
    const reschedule = await runtime.resolveBooking(
      runtime.config,
      "quero reagendar",
      cleanState,
      runtime.history,
      senderDisplayName
    )
    return buildResult(
      `Perfeito, vamos reagendar. ${reschedule.message}`,
      reschedule.state,
      reschedule.action_options
    )
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
    return buildResult(`Você quer cancelar ${formatAppointmentOption(one)}?`, nextState, [
      "Sim, cancelar",
      "Não, manter",
    ])
  }
  ;(nextState as any).cancel_candidates = candidates.slice(0, 6)
  ;(nextState as any).pending_cancel_selection = true
  const options = ((nextState as any).cancel_candidates as CancelableAppointment[]).map((a) =>
    formatAppointmentOption(a)
  )
  return buildResult(
    "Encontrei estes agendamentos. Qual deles você quer cancelar?",
    nextState,
    options
  )
}

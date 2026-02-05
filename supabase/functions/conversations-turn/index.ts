// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "supabase"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ConversationTurnRequest {
  session_id: string
  conversation_id?: string
  message: string
  channel?: "web_simulator"
  context?: {
    business_name?: string
    business_type?: string
    context_mode?: "booking" | "quote" | "both"
    tone?: "formal" | "amigavel" | "profissional" | "engracado"
    services?: Array<{ name: string; duration_minutes?: number }>
    schedule?: {
      days_of_week?: string[]
      start_time?: string
      end_time?: string
      breaks?: Array<{ start: string; end: string }>
      interval_minutes?: number
    }
    staff?: Array<{
      name: string
      use_business_schedule?: boolean
      schedule?: {
        days_of_week?: string[]
        start_time?: string
        end_time?: string
        breaks?: Array<{ start: string; end: string }>
        interval_minutes?: number
      }
    }>
    dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
    lead_policy?: {
      reject_unlisted_services?: boolean
      rejection_message?: string
      use_ai_matching?: boolean
      min_confidence?: number
    }
  }
}

interface ConversationTurnResponse {
  conversation_id: string
  messages: Array<{
    role: "assistant"
    content: string
    created_at: string
    action_options?: string[]
  }>
}

type SimulatorContextMode = "booking" | "quote" | "both"

interface LeadPolicyConfig {
  reject_unlisted_services?: boolean
  rejection_message?: string
  use_ai_matching?: boolean
  min_confidence?: number
}

interface SimulatorConfig {
  business_name?: string
  business_type?: string
  context_mode?: SimulatorContextMode
  tone?: "formal" | "amigavel" | "profissional" | "engracado"
  services?: Array<{ name: string; duration_minutes?: number }>
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
  }
  staff?: Array<{
    name: string
    use_business_schedule?: boolean
    schedule?: {
      days_of_week?: string[]
      start_time?: string
      end_time?: string
      breaks?: Array<{ start: string; end: string }>
      interval_minutes?: number
    }
  }>
  dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
  lead_policy?: LeadPolicyConfig
}

interface SimulatorState {
  mode?: "booking" | "quote"
  step?: "ask_mode" | "booking" | "quote" | "quote_free_text" | "qualification" | "qualification_rejected"
  just_identified_service?: boolean
  pending_quote_key?: string
  pending_suggested_time?: string
  pending_date_confirmation?: string
  pending_additional_booking?: boolean
  pending_additional_count?: number
  pending_attendee_name?: boolean
  pending_template_choice?: boolean
  pending_default_service?: string
  pending_default_service_locked?: boolean
  expected_additional_count?: number
  pending_final_confirmation?: boolean
  final_thanks_sent?: boolean
  completed_bookings?: Array<{ attendee_name?: string; service?: string; date?: string; time?: string }>
  last_booking?: { service?: string; date?: string; time?: string; staff_name?: string }
  pending_contact_field?: "name" | "phone" | "email"
  last_prompt?: string
  last_time_options?: string[]
  last_time_options_date?: string
  last_time_options_staff?: string
  booked_slots?: Record<string, Record<string, string[]>>
  slots: {
    staff_name?: string
    attendee_name?: string
    service?: string
    date?: string
    time?: string
    time_period?: "morning" | "afternoon" | "evening"
    customer_name?: string
    customer_phone?: string
    customer_email?: string
    quote_answers?: Record<string, string>
  }
}

interface SimulatorResult {
  message: string
  state: SimulatorState
  action_options?: string[]
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function createSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return { supabaseAdmin: null, envError: "Configuracao do servidor incompleta" }
  }
  return { supabaseAdmin: createClient(supabaseUrl, serviceRoleKey), envError: null }
}

function normalizeTone(tone?: string): "formal" | "amigavel" | "profissional" | "engracado" | null {
  if (!tone) return null
  const t = normalizeText(tone)
  if (t.includes("formal")) return "formal"
  if (t.includes("amig") || t.includes("friendly")) return "amigavel"
  if (t.includes("prof")) return "profissional"
  if (t.includes("engra") || t.includes("fun")) return "engracado"
  return null
}

async function rewriteWithTone(baseMessage: string, tone?: "formal" | "amigavel" | "profissional" | "engracado") {
  const chosenTone = normalizeTone(tone)
  if (!chosenTone) return { message: baseMessage, used_ai: false }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return { message: baseMessage, used_ai: false }

  const closingPattern =
    /(fico à disposição|fico a disposicao|estamos à disposição|estamos a disposicao|se precisar|qualquer necessidade|agendamento|agendado|agendei)/i
  if (closingPattern.test(baseMessage)) {
    return { message: baseMessage, used_ai: false }
  }

  const systemPrompt =
    "Voce reescreve mensagens de atendimento humano via WhatsApp/chat. " +
    "A mensagem base e deterministica. Reescreva sem mudar a intencao, " +
    "sem inventar informacoes, com frases curtas e naturais, uma pergunta por vez. " +
    "Nao adicione saudacoes nem despedidas novas. " +
    "Retorne apenas uma unica mensagem textual, sem markdown."

  const userPrompt =
    `Mensagem base: "${baseMessage}"\n` +
    `Tom: "${chosenTone}"\n` +
    "Reescreva mantendo exatamente a intencao e os dados."

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 120,
        temperature: 0.4,
      }),
    })

    if (!response.ok) {
      return { message: baseMessage, used_ai: false }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return { message: baseMessage, used_ai: false }

    return { message: content, used_ai: true }
  } catch {
    return { message: baseMessage, used_ai: false }
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
}

function isGreeting(text: string): boolean {
  const msg = normalizeText(text)
  const cleaned = msg.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim()
  const words = cleaned ? cleaned.split(" ").filter(w => w.length > 0) : []
  
  // Se tem mais de 3 palavras, provavelmente tem contexto - deixar IA processar
  if (words.length > 3) return false
  
  // Verificar se é apenas greeting puro (sem contexto)
  // Apenas greetings simples e comuns, sem outras informações
  const greetingPatterns = [
    /^(oi|ola|olá|oii)$/,
    /^(bom dia)$/,
    /^(boa tarde)$/,
    /^(boa noite)$/,
    /^(e ai|e aí)$/,
  ]
  
  const isOnlyGreeting = greetingPatterns.some(pattern => pattern.test(cleaned))
  
  // Se tem mais de 1 palavra e não é um padrão de greeting conhecido,
  // provavelmente tem contexto - deixar IA processar
  if (words.length > 1 && !isOnlyGreeting) return false
  
  return isOnlyGreeting
}

function isWhoAreYou(text: string): boolean {
  const msg = normalizeText(text)
  return /(com quem estou falando|quem fala|quem e voce|quem é voce|voce e quem|quem voce e)/.test(msg)
}

function getGreetingByTime(date = new Date()): string {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return "bom dia"
  if (hour >= 12 && hour < 18) return "boa tarde"
  return "boa noite"
}

function isConfused(text: string): boolean {
  const msg = normalizeText(text)
  return /(nao entendi|não entendi|nao compreendi|não compreendi|como assim|nao entendo|não entendo)/.test(msg)
}

function isFinalizedState(state: SimulatorState): boolean {
  if (state.final_thanks_sent) return true
  const last = normalizeText(state.last_prompt || "")
  return last.includes("agendamento") && last.includes("confirmad")
}

function isPriceQuestion(text: string): boolean {
  const msg = normalizeText(text)
  return /(quanto custa|preco|valor|quanto fica|orcamento|orçamento|cotacao|cotação)/.test(msg)
}

function detectModeFromText(text: string): "booking" | "quote" | null {
  const msg = normalizeText(text)
  const booking = /(agendar|agenda|horario|marcar|consulta|atendimento)/.test(msg)
  const quote = /(orcamento|orcar|preco|valor|cotacao|cotar)/.test(msg)
  if (booking && !quote) return "booking"
  if (quote && !booking) return "quote"
  if (booking && quote) return "booking"
  return null
}

function parseTime(text: string): string | null {
  const msg = normalizeText(text)
  if (hasExplicitDate(text)) return null
  const match = msg.match(/(?:as|a|às)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\b/)
  if (!match) return null
  const hh = String(parseInt(match[1], 10)).padStart(2, "0")
  const mm = match[2] ? String(parseInt(match[2], 10)).padStart(2, "0") : "00"
  return `${hh}:${mm}`
}

function parseEmail(text: string): string | null {
  const match = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)
  return match ? match[0] : null
}

function parsePhone(text: string): string | null {
  const digits = text.replace(/\D/g, "")
  if (digits.length < 10 || digits.length > 13) return null
  return digits
}

function parseDate(text: string, now = new Date()): string | null {
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

function hasExplicitDate(text: string): boolean {
  return /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.test(text)
}

function parseWeekdayDate(text: string, now = new Date()): string | null {
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

function parseTimePeriod(text: string): "morning" | "afternoon" | "evening" | null {
  const msg = normalizeText(text)
  if (/(de\s+manha|manha|manhã)/.test(msg)) return "morning"
  if (/(de\s+tarde|tarde)/.test(msg)) return "afternoon"
  if (/(de\s+noite|noite)/.test(msg)) return "evening"
  return null
}

function formatTimePeriod(period: "morning" | "afternoon" | "evening"): string {
  if (period === "morning") return "de manha"
  if (period === "afternoon") return "a tarde"
  return "a noite"
}

function parseDateOrWeekday(text: string, now = new Date()): string | null {
  return parseDate(text, now) || parseWeekdayDate(text, now)
}

function isVisitRequest(text: string): boolean {
  const msg = normalizeText(text)
  return /(visita|visitar|vistoria|avaliacao)/.test(msg)
}

function isAvailabilityQuestion(text: string): boolean {
  const msg = normalizeText(text)
  return /(tem\s+horario|tem\s+horarios|horarios\s+livres|horarios\s+disponiveis|disponibilidade)/.test(msg)
}

function isAdditionalBookingRequest(text: string): boolean {
  const msg = normalizeText(text)
  return /(meu filho|minha filha|meu filho|minha filha|meu marido|minha esposa|para mim e|pra mim e|tambem|também|mais um|outro horario|outro atendimento)/.test(
    msg
  )
}

function extractCountFromText(text: string): number | null {
  const msg = normalizeText(text)
  const match = msg.match(/(\d{1,2})\s*(agendamento|atendimento|horarios|horários)/)
  if (!match) return null
  const value = parseInt(match[1], 10)
  if (Number.isNaN(value) || value < 2) return null
  return value
}

function buildMultiBookingIntro(): string {
  return "Ah que legal! Vai ser um prazer receber voces por aqui. Vamos fazer um agendamento por vez, tudo bem?"
}

function buildAdditionalBookingAfterCompletePrompt(): string {
  return "Que otimo! Ficaremos felizes em receber voces. Qual o nome da pessoa que vamos agendar agora?"
}

function buildSingleAdditionalPrompt(): string {
  return "Que otimo! Qual o nome da pessoa que vamos agendar agora?"
}

function resetSlotsForNextBooking(state: SimulatorState): SimulatorState["slots"] {
  return {
    quote_answers: {},
    customer_name: state.slots.customer_name,
    customer_phone: state.slots.customer_phone,
    customer_email: state.slots.customer_email,
  }
}

function addBookedSlot(
  booked: Record<string, Record<string, string[]>> | undefined,
  staffName: string | undefined,
  date?: string,
  time?: string
): Record<string, Record<string, string[]>> {
  if (!date || !time) return booked || {}
  const key = staffName ? normalizeText(staffName) : "default"
  const next = { ...(booked || {}) }
  const staffSlots = next[key] || {}
  const list = Array.isArray(staffSlots[date]) ? [...staffSlots[date]] : []
  if (!list.includes(time)) list.push(time)
  staffSlots[date] = list
  next[key] = staffSlots
  return next
}

function getStaffList(config: SimulatorConfig): Array<{ name: string; use_business_schedule?: boolean; schedule?: any }> {
  return Array.isArray(config.staff) ? config.staff.filter((s) => s?.name) : []
}

function resolveStaffFromText(text: string, staffList: Array<{ name: string }>): string | null {
  const msg = normalizeText(text)
  for (const staff of staffList) {
    const name = normalizeText(staff.name)
    if (name && (msg === name || msg.includes(name))) return staff.name
  }
  return null
}

function isAnyStaffRequest(text: string): boolean {
  const msg = normalizeText(text)
  return /(qualquer|tanto faz|indiferente|nao importa)/.test(msg)
}

function getScheduleForStaff(config: SimulatorConfig, staffName?: string) {
  if (!staffName) return config.schedule
  const staff = getStaffList(config).find((s) => normalizeText(s.name) === normalizeText(staffName))
  if (!staff) return config.schedule
  if (staff.use_business_schedule) return config.schedule
  return staff.schedule || config.schedule
}

function getOtherStaffOptions(config: SimulatorConfig, staffName?: string): string[] {
  const key = staffName ? normalizeText(staffName) : ""
  return getStaffList(config)
    .filter((s) => normalizeText(s.name) !== key)
    .map((s) => s.name)
}

function buildStaffDayOptions(days: string[] = []): string[] {
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

function getNextAvailableSlot(
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

function parseTemplateChoice(text: string): "same_next" | "same_day" | "other_day" | "other_staff" | null {
  const msg = normalizeText(text)
  if (msg.includes("proximo horario") || msg.includes("próximo horario") || msg.includes("mesmo dia e colaborador")) return "same_next"
  if (msg.includes("mesmo dia") || msg.includes("outro horario no mesmo dia") || msg.includes("outro horário no mesmo dia"))
    return "same_day"
  if (msg.includes("outro dia") || msg.includes("outra data")) return "other_day"
  if (msg.includes("trocar colaborador") || msg.includes("outro colaborador")) return "other_staff"
  return null
}

async function interpretAdditionalBookingsWithAI(
  text: string,
  context?: { has_completed_booking?: boolean }
): Promise<{ count?: number; has_additional?: boolean } | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY")
  if (!openaiKey) return null

  const systemPrompt =
    "Voce interpreta pedidos de agendamento em linguagem natural. " +
    "Retorne apenas JSON valido com os campos: count (numero de agendamentos adicionais, inteiro >=0) " +
    "e has_additional (true/false). Nao invente dados."
  const userPrompt =
    `Mensagem: "${text}"\n` +
    `Contexto: ${context?.has_completed_booking ? "ja existe um agendamento finalizado" : "nao ha agendamento finalizado"}\n` +
    "Se o cliente pedir mais de um agendamento (ex.: 'pra mim e meu primo', '2 agendamentos'), " +
    "retorne count com a quantidade de agendamentos adicionais alem do principal. " +
    "Se o cliente disser que quer agendar para outra pessoa (ex.: 'para meu filho', 'para minha esposa'), " +
    "isso conta como adicional. " +
    "Se nao houver adicional, retorne count 0 e has_additional false."

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 80,
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    })

    if (!response.ok) return null
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()
    if (!content) return null
    const parsed = JSON.parse(content)
    const count = typeof parsed.count === "number" ? parsed.count : null
    const hasAdditional = typeof parsed.has_additional === "boolean" ? parsed.has_additional : null
    if (count === null && hasAdditional === null) return null
    return { count: count ?? undefined, has_additional: hasAdditional ?? undefined }
  } catch {
    return null
  }
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map((v) => parseInt(v, 10))
  return h * 60 + (Number.isNaN(m) ? 0 : m)
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

function isWithinSchedule(time: string, schedule?: SimulatorConfig["schedule"]): { ok: boolean; reason?: string } {
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

function toIsoDate(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function formatDatePt(dateIso: string): string {
  const [yyyy, mm, dd] = dateIso.split("-")
  return `${dd}/${mm}/${yyyy}`
}

function findServiceFromText(text: string, services: Array<{ name: string }> = []): string | null {
  const msg = normalizeText(text)
  for (const service of services) {
    const name = normalizeText(service.name || "")
    if (name && msg.includes(name)) return service.name
  }
  return null
}

function getWeekdayKey(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00`)
  const day = date.getDay()
  const map = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  return map[day]
}

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 100000
  }
  return hash
}

function pickVariant(seed: string, variants: string[]): string {
  if (variants.length === 0) return ""
  const idx = Math.abs(hashString(seed || "0")) % variants.length
  return variants[idx]
}

function buildServiceOptions(services: Array<{ name: string }> = []): string[] {
  const opts = services.map((s) => s.name).filter(Boolean)
  opts.push("Quero agendar uma visita")
  return opts
}

function getServiceDurationMinutes(config: SimulatorConfig, serviceName?: string): number | null {
  if (!serviceName) return null
  const match = (config.services || []).find((s) => normalizeText(s.name || "") === normalizeText(serviceName))
  if (!match) return null
  const minutes = match.duration_minutes
  if (!minutes || Number.isNaN(minutes) || minutes < 5 || minutes > 600) return null
  return minutes
}

function buildServicePrompt(
  config: SimulatorConfig,
  seed: string,
  context?: { date?: string; time?: string; time_period?: "morning" | "afternoon" | "evening"; attendee_name?: string }
): { message: string; action_options: string[] } {
  const parts: string[] = []
  if (!context?.attendee_name) {
    const intro = pickVariant(seed, [
      "Em que eu posso te ajudar?",
      "Como posso te ajudar hoje?",
      "O que voce precisa hoje?",
    ])
    parts.push(intro)
  }
  if (context?.date) {
    parts.push(`Para ${formatDatePt(context.date)}.`)
  }
  if (context?.time) {
    parts.push(`No horario ${context.time}.`)
  } else if (context?.time_period) {
    parts.push(`No periodo ${formatTimePeriod(context.time_period)}.`)
  }
  if (context?.attendee_name) {
    parts.push(`Certo, qual servico voce quer agendar para ${context.attendee_name}?`)
  } else {
    parts.push("Qual servico voce quer agendar?")
  }
  return {
    message: parts.join(" "),
    action_options: buildServiceOptions(config.services || []),
  }
}

function buildDailySlots(start = "09:00", end = "18:00", intervalMinutes = 60): string[] {
  const s = toMinutes(start)
  const e = toMinutes(end)
  const step = Math.max(5, intervalMinutes || 60)
  const slots: string[] = []
  for (let t = s; t + step <= e; t += step) {
    slots.push(fromMinutes(t))
  }
  return slots
}

function applyBreaks(slots: string[], breaks: Array<{ start: string; end: string }> = []): string[] {
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

function getMockAvailability(
  dateIso: string,
  schedule?: SimulatorConfig["schedule"],
  bookedSlots?: Record<string, Record<string, string[]>>,
  staffName?: string,
  serviceDurationMinutes?: number | null
) {
  const start = schedule?.start_time || "09:00"
  const end = schedule?.end_time || "18:00"
  const interval = serviceDurationMinutes || schedule?.interval_minutes || 60
  const slots = applyBreaks(buildDailySlots(start, end, interval), schedule?.breaks || [])
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

function isYes(text: string): boolean {
  const msg = normalizeText(text)
  return /^(sim|pode|ok|claro|isso|tudo bem|beleza|ta bom)/.test(msg)
}

function isNo(text: string): boolean {
  const msg = normalizeText(text)
  return /^(nao|não|agora nao|agora não|depois|nao quero)/.test(msg)
}

function isPoliteDecline(text: string): boolean {
  const msg = normalizeText(text)
  // Ex.: "infelizmente não, obrigado", "não obrigado", "valeu, mas não"
  const hasNo = /\b(nao|não)\b/.test(msg)
  const hasThanks = /\b(obrigad|valeu|agradec)\b/.test(msg)
  const startsWithUnfortunately = msg.startsWith("infelizmente")
  return (hasNo && hasThanks) || startsWithUnfortunately
}

function createSimulatorState(): SimulatorState {
  return { slots: { quote_answers: {} } }
}

function buildResult(message: string, state: SimulatorState, actionOptions?: string[]): SimulatorResult {
  return { message, state: { ...state, last_prompt: message }, action_options: actionOptions }
}

function areaMatchesServices(inferredArea: string | undefined, services: Array<{ name: string }> = []): boolean {
  if (!inferredArea) return false
  const normalize = (value: string) =>
    normalizeText(value)
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  const stop = new Set(["direito", "area", "servico", "servico", "atendimento", "consulta"])
  const areaTokens = normalize(inferredArea)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !stop.has(t))
  if (areaTokens.length === 0) return false

  return services.some((s) => {
    const serviceTokens = normalize(s.name || "")
      .split(" ")
      .filter(Boolean)
      .filter((t) => !stop.has(t))
    if (serviceTokens.length === 0) return false
    return areaTokens.some((t) => serviceTokens.includes(t))
  })
}

function pickServiceByArea(inferredArea: string | undefined, services: Array<{ name: string }> = []): string | null {
  if (!inferredArea) return null
  const normalize = (value: string) =>
    normalizeText(value)
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  const stop = new Set(["direito", "area", "servico", "servico", "atendimento", "consulta"])
  const areaTokens = normalize(inferredArea)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !stop.has(t))
  if (areaTokens.length === 0) return null

  let best: { name: string; score: number } | null = null
  for (const service of services) {
    const serviceTokens = normalize(service.name || "")
      .split(" ")
      .filter(Boolean)
      .filter((t) => !stop.has(t))
    // Calcular score baseado em matches, mas exigir pelo menos 2 tokens em comum
    // ou que todos os tokens principais da área estejam no serviço
    const matches = areaTokens.filter((t) => serviceTokens.includes(t))
    const score = matches.length
    
    // Só considerar match se houver pelo menos 1 token em comum E
    // se a maioria dos tokens da área estiver no serviço (para evitar matches fracos)
    if (score > 0) {
      const matchRatio = score / areaTokens.length
      // Exigir pelo menos 50% de match ou pelo menos 2 tokens
      if ((matchRatio >= 0.5 || score >= 2) && (!best || score > best.score)) {
        best = { name: service.name, score }
      }
    }
  }
  return best?.name || null
}

async function classifyServiceMatch(
  message: string,
  config: SimulatorConfig
): Promise<{ service?: string; reject?: boolean; confidence?: number; inferred_area?: string }> {
  const direct = findServiceFromText(message, config.services || [])
  if (direct) return { service: direct }

  const policy = config.lead_policy || {}
  const rejectEnabled = Boolean(policy.reject_unlisted_services)
  const useAi = policy.use_ai_matching ?? true
  if (!useAi) return {}

  const ai = await inferAreaWithAI(message, config)
  if (!ai) return {}

  const minConfidence = typeof policy.min_confidence === "number" ? policy.min_confidence : 0.6
  const inferred = ai.inferred_area
  if (!inferred) return {}
  if (normalizeText(inferred) === "indefinido") {
    // Se a IA retornou "indefinido", significa que não conseguiu identificar ou não corresponde aos serviços
    // Se rejectEnabled, podemos rejeitar com confidence baixa
    if (rejectEnabled && (ai.confidence ?? 0) <= 0.3) {
      return { reject: true, confidence: ai.confidence, inferred_area: inferred }
    }
    return { inferred_area: inferred, confidence: ai.confidence }
  }

  const matchedService = pickServiceByArea(inferred, config.services || [])
  if (matchedService && (ai.confidence ?? 0) >= minConfidence) {
    return { service: matchedService, confidence: ai.confidence, inferred_area: inferred }
  }
  
  // Verifica se a área inferida corresponde aos serviços disponíveis
  const areaMatches = areaMatchesServices(inferred, config.services || [])
  
  // Se não corresponde e tem confidence alta, rejeita (mas mantém a área inferida para resposta personalizada)
  if (rejectEnabled && (ai.confidence ?? 0) >= minConfidence && !areaMatches) {
    return { reject: true, confidence: ai.confidence, inferred_area: inferred }
  }
  
  // Se não corresponde mas tem confidence baixa, ainda retorna a área inferida para possível uso
  // (mesmo que baixa, pode ser útil para resposta personalizada)
  if (!areaMatches) {
    return { inferred_area: inferred, confidence: ai.confidence }
  }
  
  return { inferred_area: inferred, confidence: ai.confidence }
}

async function inferAreaWithAI(
  message: string,
  config: SimulatorConfig
): Promise<{ inferred_area?: string; confidence?: number } | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const business = config.business_name ? `Nome: ${config.business_name}` : ""
  const businessType = config.business_type ? `Ramo: ${config.business_type}` : ""
  
  const prompt = `Você é um classificador de intenção. Sua tarefa é identificar o assunto principal ou necessidade do cliente a partir da mensagem.

${business}
${businessType}

Mensagem do cliente:
"${message}"

Instruções CRÍTICAS:
- Retorne APENAS JSON válido.
- Analise APENAS a mensagem do cliente e identifique o assunto/área/necessidade mencionada, SEMPRE baseado no conteúdo real da mensagem.
- IMPORTANTE: IGNORE completamente o ramo de atividade informado acima. Identifique o contexto baseado SOMENTE na mensagem do cliente.
- Identifique o contexto CORRETO baseado nas palavras-chave da mensagem. Exemplos precisos:
  * "prenderam meu filho" ou "meu primo foi preso" ou "foi preso" → "direito criminal" (NÃO "direito de família")
  * "quero divorciar" ou "guarda dos filhos" ou "pensão alimentícia" → "direito de família"
  * "dor de dente" ou "tratamento dentário" → "odontologia" ou "tratamento dental"
  * "cortar cabelo" ou "corte" → "corte de cabelo" ou "serviço de beleza"
  * "consertar carro" ou "reparo automotivo" → "mecânica automotiva" ou "reparo de veículos"
- "inferred_area" deve ser um resumo curto e preciso do assunto mencionado pelo cliente.
- Use SOMENTE pistas claras do texto do cliente. Seja preciso na identificação.
- NÃO assuma que o assunto está relacionado ao ramo informado. Se a mensagem menciona "preso", "prisão", "criminal", identifique como "direito criminal", mesmo que o ramo seja "advocacia".
- Tente SEMPRE identificar algo, mesmo que com confidence baixa. Só retorne "indefinido" se a mensagem for extremamente vaga (ex: apenas "oi", "olá", "bom dia" sem contexto).
- "confidence" é de 0 a 1, baseado na clareza das pistas na mensagem. Use confidence baixa (< 0.4) apenas para mensagens muito vagas ou genéricas.

Formato:
{
  "inferred_area": "string",
  "confidence": 0.0
}`

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Retorne apenas JSON válido. Sem markdown ou texto adicional.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 300,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim() || "{}"
    const parsed = JSON.parse(content)
    if (!parsed || typeof parsed.inferred_area !== "string") return null
    return {
      inferred_area: typeof parsed.inferred_area === "string" ? parsed.inferred_area : undefined,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
    }
  } catch {
    return null
  }
}

function buildMultiBookingSummary(
  bookings: Array<{ attendee_name?: string; service?: string; date?: string; time?: string }>
): string {
  const lines = bookings
    .filter((b) => b?.attendee_name && b?.service && b?.date && b?.time)
    .map((b) => `${b.attendee_name} - ${formatDatePt(b.date || "")}, às ${b.time} - ${b.service}`)
  if (lines.length === 0) {
    return "Otimo! Os agendamentos foram preparados."
  }
  if (lines.length === 2) {
    return `Otimo! Os dois estao agendados:\n${lines.join(" e \n")}.`
  }
  return `Otimo! Agendamentos preparados:\n${lines.join(" e \n")}.`
}

function isConfirmAction(text: string): boolean {
  const msg = normalizeText(text)
  return msg.includes("confirmar") || msg.includes("confirmo") || msg.includes("confirmar agendamento")
}

function isDonePhrase(text: string): boolean {
  const msg = normalizeText(text)
  return /^(so isso|só isso|isso|ta ok|t[aá] ok|tudo certo|tudo ok|ok|beleza|nao|não)/.test(msg)
}

function buildFinalThanksMessage(
  businessName: string | undefined,
  bookings: Array<{ attendee_name?: string }>
): string {
  const names = bookings.map((b) => b.attendee_name).filter(Boolean) as string[]
  const unique = Array.from(new Set(names))
  const first = unique[0] || "vocês"
  const second = unique[1]
  const company = businessName ? `da ${businessName}` : "da nossa empresa"
  if (second) {
    return `Obrigado ${first} por agendar conosco ${company}, espero que você e o ${second} sejam bem atendidos! Faz um esforço para chegar uns 5 minutos mais cedo, ok? Até mais!`
  }
  return `Obrigado ${first} por agendar conosco ${company}! Faz um esforço para chegar uns 5 minutos mais cedo, ok? Até mais!`
}

function formatIcsDateTime(dateIso: string, time: string): string {
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

function buildCalendarIcs(options: {
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

async function uploadCalendarIcs(ics: string): Promise<string | null> {
  const { supabaseAdmin, envError } = createSupabaseAdmin()
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

async function buildFinalBookingMessage(options: {
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
  const duration = getServiceDurationMinutes(config, finalService) || 60
  const summary = `${finalService}${staff}`
  const description = config.business_name ? `Agendamento na ${config.business_name}` : "Agendamento confirmado"
  const location = config.business_name || undefined
  const calendarIcs = dateIso && time ? buildCalendarIcs({
    summary,
    description,
    location,
    dateIso,
    time,
    durationMinutes: duration,
  }) : null
  const calendarUrl = calendarIcs ? await uploadCalendarIcs(calendarIcs) : null
  const baseMessage =
    `Perfeito! Seu agendamento de ${finalService}${staff} ficou confirmado para ${date} às ${hour}. ` +
    "Se precisar de algo, estou à disposição."
  return { message: baseMessage, calendar_url: calendarUrl }
}

function buildRejectionMessage(
  inferredArea: string | undefined,
  config: SimulatorConfig,
  isFirst: boolean,
  hasContext: boolean = true
): string {
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  const hasServices = servicesList.length > 0
  
  // Se temos uma área identificada, criar mensagem personalizada e natural
  if (inferredArea && inferredArea !== "indefinido") {
    // Só usar "Obrigado pelo contato!" na primeira mensagem E quando há contexto claro
    const empathyPrefix = (isFirst && hasContext) ? "Obrigado pelo contato! " : ""
    
    if (hasServices) {
      const list = servicesList.join(", ")
      return `${empathyPrefix}Entendi, você precisa de ajuda com ${inferredArea}. Infelizmente não atendemos essa área. Trabalhamos com: ${list}. Posso te ajudar com alguma dessas áreas?`
    } else {
      return `${empathyPrefix}Entendi, você precisa de ajuda com ${inferredArea}. Infelizmente não atendemos essa área. Posso te ajudar com mais alguma coisa?`
    }
  }
  
  // Se não identificou área específica, pedir mais detalhes de forma natural
  // Nunca usar "Obrigado pelo contato!" quando não há contexto
  const customMessage = config.lead_policy?.rejection_message
  
  if (customMessage && hasContext) {
    const empathyPrefix = isFirst ? "Obrigado pelo contato! " : ""
    return `${empathyPrefix}${customMessage}`
  }
  
  // Quando não há contexto suficiente, pedir mais detalhes de forma natural
  if (!hasContext) {
    return "Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor."
  }
  
  // Mensagem genérica quando há contexto mas não identificou área
  if (hasServices) {
    const list = servicesList.join(", ")
    const empathyPrefix = isFirst ? "Obrigado pelo contato! " : ""
    return `${empathyPrefix}Entendi. No momento não atendemos esse tipo de caso. Trabalhamos com: ${list}. Posso te ajudar com alguma dessas áreas?`
  }
  
  const empathyPrefix = isFirst ? "Obrigado pelo contato! " : ""
  return `${empathyPrefix}Entendi. No momento não atendemos esse tipo de caso. Se precisar de algo dentro das nossas áreas, fico à disposição.`
}

async function resolveBooking(config: SimulatorConfig, text: string, state: SimulatorState): Promise<SimulatorResult> {
  const nextState: SimulatorState = {
    ...state,
    step: "booking",
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
    completed_bookings: state.completed_bookings ? [...state.completed_bookings] : [],
  }
  const bookingComplete =
    Boolean(nextState.slots.service) &&
    Boolean(nextState.slots.date) &&
    Boolean(nextState.slots.time) &&
    Boolean(nextState.slots.customer_name) &&
    Boolean(nextState.slots.customer_phone) &&
    Boolean(nextState.slots.customer_email)
  if (!state.pending_final_confirmation && !state.final_thanks_sent && isDonePhrase(text) && bookingComplete) {
    const finalResult = await buildFinalBookingMessage({
      config,
      service: nextState.slots.service,
      staffName: nextState.slots.staff_name,
      dateIso: nextState.slots.date,
      time: nextState.slots.time,
    })
    nextState.final_thanks_sent = true
    nextState.slots = resetSlotsForNextBooking(nextState)
    const actionOptions = finalResult.calendar_url
      ? [`open_url|Adicionar ao calendário|${finalResult.calendar_url}`]
      : undefined
    return buildResult(finalResult.message, nextState, actionOptions)
  }
  if (!state.pending_final_confirmation && !state.final_thanks_sent && isDonePhrase(text)) {
    const bookings = nextState.completed_bookings || []
    if (bookings.length > 0) {
      nextState.final_thanks_sent = true
      nextState.completed_bookings = []
      return buildResult(buildFinalThanksMessage(config.business_name, bookings), nextState)
    }
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
  const hasCompletedBooking =
    Boolean(state.slots?.service) &&
    Boolean(state.slots?.date) &&
    Boolean(state.slots?.time) &&
    Boolean(state.slots?.customer_name) &&
    Boolean(state.slots?.customer_phone) &&
    Boolean(state.slots?.customer_email)
  const interpretedAdditional = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: hasCompletedBooking })
  const interpretedCountRaw = typeof interpretedAdditional?.count === "number" ? interpretedAdditional.count : null
  const interpretedCount = interpretedCountRaw !== null ? Math.max(0, interpretedCountRaw) : null
  const interpretedHasAdditional =
    interpretedAdditional?.has_additional === true || (interpretedCount !== null && interpretedCount > 0)

  if (!nextState.slots.service) {
    if (explicitService) nextState.slots.service = explicitService
    else if (isVisitRequest(text)) nextState.slots.service = "visita"
    else if (nextState.pending_default_service && nextState.pending_default_service_locked)
      nextState.slots.service = nextState.pending_default_service
  }

  if (!nextState.pending_additional_count && !nextState.pending_additional_booking && interpretedHasAdditional) {
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
    const name = text.trim()
    if (!name || interpretedHasAdditional) {
      return buildResult(`${buildMultiBookingIntro()} De quem sera o primeiro agendamento?`, nextState)
    }
    nextState.slots.attendee_name = name
    if (!nextState.slots.customer_name) nextState.slots.customer_name = name
    nextState.pending_attendee_name = false
    if (nextState.last_booking && !nextState.pending_template_choice) {
      nextState.pending_template_choice = true
      const staffLabel = nextState.last_booking.staff_name ? ` da ${nextState.last_booking.staff_name}` : ""
      const dateLabel = nextState.last_booking.date ? formatDatePt(nextState.last_booking.date) : "esse dia"
      const options = [
        "Mesmo dia e colaborador (proximo horario)",
        "Outro horario no mesmo dia",
        "Outro dia",
        ...(getOtherStaffOptions(config, nextState.last_booking.staff_name).length > 0 ? ["Trocar colaborador"] : []),
      ]
      return buildResult(
        `Certo, para ${name}. Quer agendar tambem em ${dateLabel}${staffLabel}? Prefere o proximo horario, outro horario no mesmo dia, outro dia ou trocar colaborador?`,
        nextState,
        options
      )
    }
    const staffList = getStaffList(config)
    if (staffList.length > 1) {
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...staffList.map((s) => s.name),
        "Tanto faz",
      ])
    }
    const prompt = buildServicePrompt(config, text, { attendee_name: nextState.slots.attendee_name })
    return buildResult(`Vamos la, ${name}. ${prompt.message}`, nextState, prompt.action_options)
  }

  if (nextState.pending_template_choice) {
    const choice = parseTemplateChoice(text)
    const last = nextState.last_booking
    if (choice && last) {
      nextState.pending_template_choice = false
      if (choice === "same_next") {
        const dateIso = last.date
        const staffName = last.staff_name
        const serviceForSlots = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceDuration = getServiceDurationMinutes(config, serviceForSlots)
        const next = dateIso
          ? getNextAvailableSlot(dateIso, config, nextState.booked_slots, staffName, last.time, serviceDuration)
          : null
        if (!dateIso || !next) {
          return buildResult("Nao encontrei um proximo horario nesse dia. Quer escolher outro dia ou outro colaborador?", nextState, [
            "Outro dia",
            ...(getOtherStaffOptions(config, staffName).length > 0 ? ["Trocar colaborador"] : []),
          ])
        }
        nextState.slots.date = dateIso
        nextState.slots.time = next
        nextState.slots.staff_name = staffName
        return buildResult(`Perfeito. Sugeri ${next} em ${formatDatePt(dateIso)}. Posso confirmar?`, nextState, [
          `Sim, ${next}`,
          "Outro horario no mesmo dia",
          "Outro dia",
          ...(getOtherStaffOptions(config, staffName).length > 0 ? ["Trocar colaborador"] : []),
        ])
      }
      if (choice === "same_day") {
        if (last.date) nextState.slots.date = last.date
        nextState.slots.staff_name = last.staff_name
        const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
        const serviceForSlots = nextState.slots.service || nextState.pending_default_service || last.service
        const serviceDuration = getServiceDurationMinutes(config, serviceForSlots)
        const availability = last.date
          ? getMockAvailability(last.date, schedule, nextState.booked_slots, nextState.slots.staff_name, serviceDuration)
          : { available: [], occupied: [] }
        if (!availability.available.length) {
          return buildResult("Esse dia esta cheio. Quer tentar outro dia ou trocar colaborador?", nextState, [
            "Outro dia",
            ...(getOtherStaffOptions(config, nextState.slots.staff_name).length > 0 ? ["Trocar colaborador"] : []),
          ])
        }
        nextState.last_time_options = availability.available.slice(0, 8)
        nextState.last_time_options_date = nextState.slots.date
        nextState.last_time_options_staff = nextState.slots.staff_name
        return buildResult("Qual horario voce prefere no mesmo dia?", nextState, availability.available.slice(0, 8))
      }
      if (choice === "other_day") {
        nextState.slots.date = undefined
        nextState.slots.time = undefined
        return buildResult("Qual dia voce prefere?", nextState)
      }
      if (choice === "other_staff") {
        nextState.slots.staff_name = undefined
        return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
          ...getStaffList(config).map((s) => s.name),
          "Tanto faz",
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
      const selected = resolveStaffFromText(text, staffList)
      if (selected) {
        nextState.slots.staff_name = selected
      } else if (isAnyStaffRequest(text)) {
        nextState.slots.staff_name = staffList[0].name
      }
    }

    if (!nextState.slots.staff_name) {
      return buildResult("Com qual colaborador voce prefere agendar?", nextState, [
        ...staffList.map((s) => s.name),
        "Tanto faz",
      ])
    }

    if (!state.slots?.staff_name && nextState.slots.staff_name && nextState.slots.service && !nextState.slots.date) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const days = schedule?.days_of_week || []
      if (days.length > 0) {
        const daysLabel = days.map((d) => buildStaffDayOptions([d])[0]).join(", ")
        const intro =
          nextState.just_identified_service && nextState.slots.service
            ? `Entendi, voce precisa de ${nextState.slots.service}. `
            : ""
        nextState.just_identified_service = false
        return buildResult(
          `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel para atendimento de ${daysLabel}. Em qual dia voce gostaria de agendar?`,
          nextState,
          buildStaffDayOptions(days)
        )
      }
    }
  }

  if (bookingComplete && (interpretedHasAdditional || (nextState.pending_additional_count || 0) > 0)) {
    let extraCount = interpretedCount && interpretedCount > 0 ? interpretedCount : 0
    if (!extraCount && interpretedHasAdditional) extraCount = 1
    nextState.last_booking = {
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
    if (isYes(text)) {
      nextState.slots.date = state.pending_date_confirmation
      nextState.pending_date_confirmation = undefined
    } else if (isNo(text) || normalizeText(text).includes("outra")) {
      nextState.pending_date_confirmation = undefined
      return buildResult("Qual dia voce prefere?", nextState)
    }
  }

  if (normalizeText(text).includes("outro dia") || normalizeText(text).includes("outra data")) {
    nextState.slots.date = undefined
    nextState.slots.time = undefined
    return buildResult("Qual dia voce prefere?", nextState)
  }

  const dateCandidate = !nextState.slots.date ? parseDateOrWeekday(text) : null
  if (!nextState.slots.date && !dateCandidate && nextState.slots.staff_name && nextState.slots.service) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const days = schedule?.days_of_week || []
    if (days.length > 0) {
      const daysLabel = days.map((d) => buildStaffDayOptions([d])[0]).join(", ")
      const intro =
        nextState.just_identified_service && nextState.slots.service
          ? `Entendi, voce precisa de ${nextState.slots.service}. `
          : ""
      nextState.just_identified_service = false
      return buildResult(
        `${intro}Temos agenda com ${nextState.slots.staff_name} que esta disponivel para atendimento de ${daysLabel}. Em qual dia voce gostaria de agendar?`,
        nextState,
        buildStaffDayOptions(days)
      )
    }
  }

  if (state.pending_contact_field) {
    if (state.pending_contact_field === "name") {
      const name = text.trim()
      if (!name) {
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      nextState.slots.customer_name = name
      nextState.pending_contact_field = undefined
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

  if (!nextState.slots.service) {
    if (isVisitRequest(text)) {
      nextState.slots.service = "Visita"
    } else if (config.services && config.services.length === 1) {
      nextState.slots.service = config.services[0].name
    } else {
      const service = findServiceFromText(text, config.services || [])
      if (service) nextState.slots.service = service
    }
  }

  if (!nextState.slots.date) {
    const date = parseDateOrWeekday(text)
    if (date) {
      if (!hasExplicitDate(text) && parseWeekdayDate(text) && !state.pending_date_confirmation) {
        nextState.pending_date_confirmation = date
        return buildResult(`Voce quis dizer ${formatDatePt(date)}?`, nextState, [
          `Sim, ${formatDatePt(date)}`,
          "Outra data",
        ])
      }
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const allowedDays = schedule?.days_of_week
      if (allowedDays && allowedDays.length > 0) {
        const weekday = getWeekdayKey(date)
        if (!allowedDays.includes(weekday)) {
          return buildResult("Nesse dia eu nao atendo. Qual outro dia voce prefere?", nextState)
        }
      }
      nextState.slots.date = date
    }
  }

  if (!nextState.slots.time) {
    const time = parseTime(text)
    if (time) {
      const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const within = isWithinSchedule(time, schedule)
      if (!within.ok) {
        return buildResult(
          `Poxa, infelizmente nao consigo te atender nesse horario. ${within.reason} Qual horario voce prefere?`,
          nextState
        )
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
      return buildResult("Pra eu ver os horarios, pra qual dia voce prefere?", nextState)
    }
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServiceDurationMinutes(
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
      const options = otherStaff.length > 0 ? [...otherStaff, "Outro dia"] : ["Outro dia"]
      return buildResult(
        `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`,
        nextState,
        options
      )
    }
    nextState.last_time_options = availability.available.slice(0, 8)
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    return buildResult(
      `Tenho estes horarios livres em ${formatDatePt(nextState.slots.date)}. Qual voce prefere?`,
      nextState,
      availability.available.slice(0, 8)
    )
  }

  if (!nextState.slots.service) {
    const prompt = buildServicePrompt(config, text, {
      date: nextState.slots.date,
      time: nextState.slots.time,
      time_period: nextState.slots.time_period,
      attendee_name: nextState.slots.attendee_name,
    })
    return buildResult(prompt.message, nextState, prompt.action_options)
  }

  if (!nextState.slots.date) {
    const prefix = nextState.slots.time
      ? `Anotei ${nextState.slots.service} no horario ${nextState.slots.time}. `
      : nextState.slots.time_period
        ? `Anotei ${nextState.slots.service} no periodo ${formatTimePeriod(nextState.slots.time_period)}. `
        : `Certo, ${nextState.slots.service}. `
    return buildResult(`${prefix}Qual dia voce prefere?`, nextState)
  }

  if (!nextState.slots.time) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServiceDurationMinutes(
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
    const options = availability.available.slice(0, 8)
    if (availability.available.length === 0) {
      const otherStaff = getOtherStaffOptions(config, nextState.slots.staff_name)
      const optionList = otherStaff.length > 0 ? [...otherStaff, "Outro dia"] : ["Outro dia"]
      return buildResult(
        `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`,
        nextState,
        optionList
      )
    }
    nextState.last_time_options = options
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    if (nextState.slots.time_period) {
      return buildResult(
        `Perfeito, ${formatTimePeriod(nextState.slots.time_period)}. Qual horario voce prefere?`,
        nextState,
        options
      )
    }
    return buildResult("Qual horario voce prefere?", nextState, options)
  }

  const dateIso = nextState.slots.date
  const time = nextState.slots.time
  if (dateIso && time) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServiceDurationMinutes(
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
      if (!nextState.slots.customer_phone) {
        nextState.pending_contact_field = "phone"
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      if (!nextState.slots.customer_email) {
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
      const finalResult = await buildFinalBookingMessage({
        config,
        service: nextState.slots.service,
        staffName: nextState.slots.staff_name,
        dateIso,
        time,
      })
      nextState.final_thanks_sent = true
      nextState.slots = resetSlotsForNextBooking(nextState)
      const actionOptions = finalResult.calendar_url
        ? [`open_url|Adicionar ao calendário|${finalResult.calendar_url}`]
        : undefined
      return buildResult(finalResult.message, nextState, actionOptions)
    }

    const next = availability.available.find((slot) => slot > time) || availability.available[0]
    if (next) {
      nextState.pending_suggested_time = next
      nextState.slots.time = undefined
      return buildResult(`Esse horario esta ocupado. Posso te oferecer ${next} no mesmo dia?`, nextState)
    }
    return buildResult("Esse dia esta cheio. Quer tentar outro dia?", nextState)
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

async function processSimulatorMessage(input: string, config: SimulatorConfig, state: SimulatorState): Promise<SimulatorResult> {
  const text = input.trim()
  const nextState: SimulatorState = {
    ...state,
    slots: { ...(state.slots || {}), quote_answers: state.slots?.quote_answers || {} },
  }

  const isFirst = isFirstMessage(state)

  // Se a conversa já foi finalizada, não reiniciar o fluxo
  if (isFinalizedState(nextState)) {
    const msg = normalizeText(text)
    if (/\b(obrigad|valeu|agradec)\b/.test(msg)) {
      const company = config.business_name ? `A ${config.business_name}` : "A empresa"
      const saudacao = getGreetingByTime()
      nextState.final_thanks_sent = true
      return buildResult(`Disponha! Foi um prazer te atender. ${company} agradece o seu contato, tenha um(a) ${saudacao}.`, nextState)
    }
    // Mantem encerrado para qualquer outra mensagem
    nextState.final_thanks_sent = true
    return buildResult("Se precisar de algo no futuro, fico à disposição.", nextState)
  }

  // PRIORIDADE: Se é primeira mensagem, processar contexto ANTES de qualquer outra coisa
  // Isso garante que mensagens como "oi, prenderam meu filho" sejam processadas corretamente
  if (isFirst && !nextState.mode && !nextState.step) {
    const business = config.business_name ? `da ${config.business_name}` : "da empresa"
    const greeting = `Oi! Sou a assistente ${business}.`

    const shouldClassify =
      (config.services || []).length > 0 &&
      !nextState.slots.service &&
      (config.lead_policy?.use_ai_matching ?? true)

    if (shouldClassify && !isGreeting(text)) {
      const match = await classifyServiceMatch(text, config)
      const hasContext =
        Boolean(match.inferred_area) &&
        match.inferred_area !== "indefinido" &&
        (match.confidence ?? 0) >= 0.3

      if (match.service) {
        nextState.slots.service = match.service
        nextState.just_identified_service = true
        const thanks = config.business_name ? `Obrigado por escolher a ${config.business_name}.` : "Obrigado por entrar em contato."
        const intro = `${greeting} ${thanks} Entendi, você precisa de ajuda com ${match.service}.`
        if (config.context_mode === "booking") {
          const result = await resolveBooking(config, text, nextState)
          return buildResult(`${intro} ${result.message}`, result.state, result.action_options)
        }
        if (config.context_mode === "quote") {
          return buildResult(`${intro} O que você precisa orçar?`, nextState)
        }
        return buildResult(`${intro} Você prefere agendar um horário ou pedir um orçamento?`, nextState)
      } else if (hasContext) {
        const rejectionMessage = buildRejectionMessage(match.inferred_area, config, true, hasContext)
        return buildResult(`${greeting} ${rejectionMessage}`, { ...nextState, step: "qualification_rejected" })
      } else {
        return buildResult(`${greeting} Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
      }
    }

    // Se não houver classificação (ou sem política), tratar greeting puro
    if (isGreeting(text)) {
      return buildResult(`${greeting} Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
    }

    return buildResult(`${greeting} Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
  }

  if (!nextState.slots.service) {
    const service = findServiceFromText(text, config.services || [])
    if (service) nextState.slots.service = service
    else if (isVisitRequest(text)) nextState.slots.service = "visita"
  }

  if (isWhoAreYou(text)) {
    const name = config.business_name ? `da ${config.business_name}` : "da empresa"
    return buildResult(`Oi! Sou a assistente virtual ${name}. Como posso te ajudar hoje?`, nextState)
  }

  if (isConfused(text)) {
    const fallback = nextState.last_prompt || "Como posso te ajudar hoje?"
    return buildResult(`Tudo bem! Posso repetir: ${fallback}`, nextState)
  }

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
    const done =
      /^(entendi|ok|t[aá] ok|tudo bem|obrigado|obrigada|valeu|nao|não)/.test(normalizeText(text)) ||
      isPoliteDecline(text)
    if (done) {
      const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
      if (servicesList.length > 0) {
        const list = servicesList.join(", ")
        return buildResult(`Tudo bem! Se precisar, atendemos: ${list}. Fico à disposição.`, nextState)
      }
      return buildResult("Tudo bem! Se precisar de algo dentro das nossas áreas, fico à disposição.", nextState)
    }
    // Re-inferir a área para manter contexto na resposta
    const match = await classifyServiceMatch(text, config)
    const hasContext = match.inferred_area && 
                      match.inferred_area !== "indefinido" && 
                      (match.confidence ?? 0) >= 0.3
    const rejectionMessage = buildRejectionMessage(match.inferred_area, config, false, hasContext)
    return buildResult(rejectionMessage, nextState)
  }

  if (nextState.step === "qualification") {
    const match = await classifyServiceMatch(text, config)
    if (match.service) {
      nextState.slots.service = match.service
      nextState.just_identified_service = true
      nextState.step = undefined
    } else if (match.reject || config.lead_policy?.reject_unlisted_services) {
      // Verificar se há contexto suficiente (não é indefinido e tem confidence razoável)
      const hasContext = match.inferred_area && 
                        match.inferred_area !== "indefinido" && 
                        (match.confidence ?? 0) >= 0.3
      
      const rejectionMessage = buildRejectionMessage(match.inferred_area, config, isFirst, hasContext)
      if (match.reject) return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
      if (hasContext && (config.services || []).length > 0) {
        return buildResult(rejectionMessage, nextState)
      }
      // Sem contexto suficiente, pedir mais detalhes de forma natural
      return buildResult("Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor.", nextState)
    } else {
      // Verificar se há contexto suficiente
      const hasContext = match.inferred_area && 
                        match.inferred_area !== "indefinido" && 
                        (match.confidence ?? 0) >= 0.3
      
      if (hasContext && (config.services || []).length > 0) {
        const rejectionMessage = buildRejectionMessage(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, nextState)
      }
      // Sem contexto suficiente, pedir mais detalhes de forma natural
      return buildResult("Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor.", nextState)
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
      const hasContext = match.inferred_area && 
                        match.inferred_area !== "indefinido" && 
                        (match.confidence ?? 0) >= 0.3
      const rejectionMessage = buildRejectionMessage(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected" })
    } else {
      // Verificar se há contexto suficiente
      const hasContext = match.inferred_area && 
                        match.inferred_area !== "indefinido" && 
                        (match.confidence ?? 0) >= 0.3
      
      if (hasContext) {
        const rejectionMessage = buildRejectionMessage(match.inferred_area, config, isFirst, hasContext)
        return buildResult(rejectionMessage, { ...nextState, step: "qualification" })
      }
      // Sem contexto suficiente, pedir mais detalhes de forma natural
      return buildResult("Claro! Pode me contar mais detalhes do que você precisa? Assim consigo te ajudar melhor.", {
        ...nextState,
        step: "qualification",
      })
    }
  }

  if (!nextState.mode && isGreeting(text)) {
    const business = config.business_name ? `da ${config.business_name}` : "da empresa"
    const greeting = pickVariant(text, [
      `Oi! Sou a assistente ${business}.`,
      `Oi! Aqui e a assistente ${business}.`,
      `Oi! Sou a assistente virtual ${business}.`,
    ])
    
    // Se é greeting puro (sem contexto), apenas saudar e perguntar
    // Se tem contexto na mensagem, já foi processado acima no bloco isFirst
    return buildResult(`${greeting} Como posso te ajudar hoje?`, { ...nextState, step: "qualification" })
  }

  if (!nextState.mode) {
    // Só definir mode se tiver serviço válido ou se não houver política de rejeição
    const canSetMode = nextState.slots.service || 
                      !config.lead_policy?.reject_unlisted_services ||
                      (config.services || []).length === 0
    
    if (canSetMode) {
      if (config.context_mode && config.context_mode !== "both") {
        nextState.mode = config.context_mode
      } else {
        const detected = detectModeFromText(text)
        if (!detected) {
          // Sem contexto suficiente, perguntar de forma natural
          return buildResult("Voce prefere agendar um horario ou pedir um orcamento?", { ...nextState, step: "ask_mode" })
        }
        nextState.mode = detected
      }
    } else {
      // Não tem serviço e há política de rejeição, não definir mode ainda
      // Deixar no step "qualification" para continuar a qualificação
      if (!nextState.step) {
        return buildResult("Para eu te ajudar melhor, qual o assunto ou área que você precisa?", { ...nextState, step: "qualification" })
      }
    }
  }

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
      const hasContext = match.inferred_area && 
                        match.inferred_area !== "indefinido" && 
                        (match.confidence ?? 0) >= 0.3
      const rejectionMessage = buildRejectionMessage(match.inferred_area, config, isFirst, hasContext)
      return buildResult(rejectionMessage, { ...nextState, step: "qualification_rejected", mode: undefined })
    }
  }

  if (nextState.mode === "booking") {
    if (isPriceQuestion(text)) {
      const service = findServiceFromText(text, config.services || [])
      if (service) {
        const empathy = pickVariant(text, [
          "Poxa, que chato! Acontece mesmo.",
          "Poxa, sinto muito por isso.",
          "Que pena! Isso acontece.",
        ])
        // Só usar "Obrigado pelo contato!" se for primeira mensagem E houver contexto claro
        const hasContext = text.trim().length > 10 && !isGreeting(text)
        const empathyPrefix = (isFirst && hasContext) ? "Obrigado pelo contato! " : ""
        return buildResult(`${empathyPrefix}${empathy} A gente faz ${service}. Voce quer agendar uma visita?`, nextState)
      }
    }
    // Se é primeira mensagem e não é greeting, processar normalmente
    // (a empatia já será adicionada nas respostas específicas quando necessário)
    if (isFirst && !isGreeting(text)) {
      const result = await resolveBooking(config, text, nextState)
      return buildResult(result.message, result.state, result.action_options)
    }
    return await resolveBooking(config, text, nextState)
  }

  return resolveQuote(config, text, nextState)
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

async function getOrCreateChannel(supabaseAdmin: any, tenantId: string) {
  const { data: existing } = await supabaseAdmin
    .from("channel")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("type", "web_simulator")
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabaseAdmin
    .from("channel")
    .insert({ tenant_id: tenantId, type: "web_simulator", is_active: true })
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

  const { data, error } = await supabaseAdmin
    .from("conversation")
    .insert({
      tenant_id: tenantId,
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
    if (!body?.session_id || !body?.message) {
      return json({ error: "session_id e message sao obrigatorios" }, 400)
    }

    const { supabaseAdmin, envError } = createSupabaseAdmin()
    if (envError) return json({ error: envError }, 500)

    const config: SimulatorConfig = {
      business_name: body.context?.business_name,
      business_type: body.context?.business_type,
      context_mode: body.context?.context_mode,
      tone: body.context?.tone,
      services: body.context?.services || [],
      schedule: body.context?.schedule,
      staff: body.context?.staff || [],
      dynamic_variables: body.context?.dynamic_variables || [],
      lead_policy: body.context?.lead_policy,
    }

    const tenant = await getOrCreateTenant(supabaseAdmin, body.session_id, config.business_name)
    const channel = await getOrCreateChannel(supabaseAdmin, tenant.id)
    const contact = await getOrCreateContact(supabaseAdmin, tenant.id, channel.id, body.session_id, config.business_name)
    const conversation = await getOrCreateConversation(supabaseAdmin, tenant.id, channel.id, contact.id, body.conversation_id)

    // Verificar se é a primeira mensagem da conversa
    const { count: messageCount } = await supabaseAdmin
      .from("conversation_messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("role", "user")
    const isFirstMessage = (messageCount || 0) === 0

    const currentState = (conversation.state_json?.state as SimulatorState) || createSimulatorState()
    // Adicionar flag de primeira mensagem ao estado para uso na função processSimulatorMessage
    const stateWithFirstFlag = { ...currentState, _isFirstMessage: isFirstMessage }
    const result = await processSimulatorMessage(body.message, config, stateWithFirstFlag)
    const rewritten = await rewriteWithTone(result.message, config.tone)

    const nowIso = new Date().toISOString()

    await supabaseAdmin.from("conversation_messages").insert([
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "user",
        content_text: body.message,
        metadata: { channel: "web_simulator" },
      },
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "assistant",
        content_text: rewritten.message,
        metadata: {
          channel: "web_simulator",
          tone: config.tone,
          base_message: result.message,
          used_ai: rewritten.used_ai,
          action_options: result.action_options || null,
        },
      },
    ])

    // Remover flag temporária do estado antes de salvar
    const { _isFirstMessage, ...stateToSave } = result.state as SimulatorState & { _isFirstMessage?: boolean }
    
    await supabaseAdmin
      .from("conversation")
      .update({
        state_json: { state: stateToSave, channel: "web_simulator" },
        context: {
          ...(conversation.context || {}),
          session_id: body.session_id,
          business_name: config.business_name,
          business_type: config.business_type,
          context_mode: config.context_mode,
          tone: config.tone,
        },
        last_message_at: nowIso,
      })
      .eq("id", conversation.id)
      .eq("tenant_id", tenant.id)

    const response: ConversationTurnResponse = {
      conversation_id: conversation.id,
      messages: [
        {
          role: "assistant",
          content: rewritten.message,
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

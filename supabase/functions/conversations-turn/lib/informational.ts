// @ts-nocheck
/** Detecção e resposta para perguntas informativas (endereço, horários, ramos/serviços).
 * Permite que o usuário pergunte dados do cadastro mesmo após a conversa finalizada. */
import { normalizeText } from "./utils.ts"
import { buildServicesListWithPrices } from "./builders.ts"
import type { SimulatorConfig, EstablishmentAddress } from "./types.ts"

const DAY_NAMES: Record<string, string> = {
  sunday: "domingo",
  monday: "segunda",
  tuesday: "terça",
  wednesday: "quarta",
  thursday: "quinta",
  friday: "sexta",
  saturday: "sábado",
}

function formatAddress(addr: EstablishmentAddress): string {
  const parts: string[] = []
  if (addr.logradouro) parts.push(addr.logradouro)
  if (addr.numero) parts.push(addr.numero)
  if (addr.complemento) parts.push(addr.complemento)
  if (addr.bairro) parts.push(addr.bairro)
  if (addr.localidade) parts.push(addr.localidade)
  if (addr.uf) parts.push(addr.uf)
  return parts.filter(Boolean).join(", ")
}

/** Detecta perguntas sobre endereço/localização. */
export function isAddressQuestion(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /\b(endereco|endereço|onde ficam|onde ficam voces|qual endereco|qual o endereco)\b/.test(msg) ||
    /\b(rua|avenida|localizacao|localização|como chego|como chegar)\b/.test(msg) ||
    /(qual o endereco de voces|qual endereco de voces|endereco de voces|onde voces ficam)/.test(msg)
  )
}

/** Detecta perguntas sobre horários de funcionamento. */
export function isScheduleQuestion(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /\b(horario|horários|horarios|funcionamento|funcionam|atendem)\b/.test(msg) ||
    /\b(quais dias|qual dia|que dias|em que dias)\b/.test(msg) ||
    /\b(aberto|abertura|fechado|fecha|abre)\b/.test(msg) ||
    /(tem algum dia que atendem|atendem as |atendem às |ate que horas)/.test(msg)
  )
}

/** Detecta se a pergunta menciona um horário específico (ex: "atendem às 20"). */
function parseRequestedTime(text: string): string | null {
  const msg = normalizeText(text)
  const match = msg.match(/(?:as|a|às|ate|até)\s*(\d{1,2})(?::(\d{2}))?\s*(?:h|hs)?\b/)
  if (!match) return null
  const hh = String(parseInt(match[1], 10)).padStart(2, "0")
  const mm = match[2] ? String(parseInt(match[2], 10)).padStart(2, "0") : "00"
  return `${hh}:${mm}`
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map((v) => parseInt(v, 10))
  return h * 60 + (Number.isNaN(m) ? 0 : m)
}

/** Verifica se o horário solicitado está dentro do schedule. */
function scheduleIncludesTime(
  schedule: { days_of_week?: string[]; start_time?: string; end_time?: string } | undefined,
  requestedTime: string
): boolean {
  if (!schedule?.start_time || !schedule?.end_time) return false
  const req = toMinutes(requestedTime)
  const start = toMinutes(schedule.start_time)
  const end = toMinutes(schedule.end_time)
  return req >= start && req <= end
}

function buildScheduleResponse(config: SimulatorConfig, requestedTime: string | null): string {
  const sched = config.schedule
  if (!sched?.days_of_week?.length || !sched.start_time || !sched.end_time) {
    return "No momento não temos o horário de funcionamento cadastrado. Se precisar de algo mais, estou à disposição."
  }
  const days = sched.days_of_week
    .map((d) => DAY_NAMES[d] || d)
    .filter(Boolean)
    .join(", ")
  const timeRange = `${sched.start_time} às ${sched.end_time}`

  if (requestedTime) {
    const inRange = scheduleIncludesTime(sched, requestedTime)
    if (inRange) {
      return `Sim! Atendemos ${days}, das ${timeRange}. O horário que você mencionou (${requestedTime}) está dentro do nosso atendimento.`
    }
    return `Nosso horário de atendimento é ${days}, das ${timeRange}. No momento não atendemos no horário que você mencionou. Posso ajudar em algo mais?`
  }

  return `Nosso horário de atendimento é ${days}, das ${timeRange}.`
}

/** Detecta perguntas sobre lista de serviços/ramos que atendem. */
export function isListServicesInformational(text: string): boolean {
  const msg = normalizeText(text)
  return (
    /\b(quais (os )?ramos|quais (os )?servicos|quais (os )?serviços|o que voces fazem|o que vocês fazem)\b/.test(msg) ||
    /\b(que ramos|que servicos|ramos que atendem|servicos que oferecem)\b/.test(msg) ||
    /(trabalham com que|atendem em que areas)/.test(msg) ||
    /\b(quais areas|quais areas vc atendem|areas vc atende|areas que atendem|areas voces atendem)\b/.test(msg) ||
    /(atende quais|atendem quais|o que atendem|que areas)/.test(msg)
  )
}

/**
 * Tenta responder perguntas informativas com base nos dados do cadastro.
 * Retorna a mensagem de resposta ou null se não for pergunta informativa ou não houver dados.
 */
export function tryAnswerInformationalQuestion(config: SimulatorConfig, text: string): string | null {
  const msg = normalizeText(text)

  // Endereço
  if (isAddressQuestion(msg)) {
    const addr = config.establishment_address
    const hasRealAddress =
      addr?.logradouro &&
      !/\[.*\]|inserir|placeholder|cadastre|preencha/i.test(addr.logradouro)
    if (hasRealAddress) {
      return `Nosso endereço é: ${formatAddress(addr)}. Se precisar de algo mais, estou à disposição.`
    }
    return "Não temos local físico para atendimento. Atendemos no endereço do cliente ou podemos combinar o local. Posso ajudar com algo mais?"
  }

  // Horários
  if (isScheduleQuestion(msg)) {
    const requestedTime = parseRequestedTime(msg)
    return buildScheduleResponse(config, requestedTime)
  }

  // Lista de serviços/ramos
  if (isListServicesInformational(msg)) {
    const services = config.services || []
    if (services.length > 0) {
      const list = buildServicesListWithPrices(config)
      return `${list} Se precisar de algo mais, estou à disposição.`
    }
    return "No momento não temos a lista de serviços cadastrada. Posso ajudar com algo mais?"
  }

  return null
}

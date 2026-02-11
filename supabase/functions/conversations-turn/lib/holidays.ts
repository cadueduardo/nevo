// @ts-nocheck
/** Integração com Brasil API para feriados nacionais e lógica de bloqueio de agenda. */

export interface NationalHoliday {
  date: string
  name: string
  type?: string
}

const CACHE: Record<number, NationalHoliday[]> = {}

/** Busca feriados nacionais do ano via Brasil API. Cache em memória por ano. */
export async function fetchNationalHolidays(year: number): Promise<NationalHoliday[]> {
  if (CACHE[year]) return CACHE[year]
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`)
    if (!res.ok) return []
    const data = (await res.json()) as NationalHoliday[]
    const national = data.filter((h) => h.type === "national" || !h.type)
    CACHE[year] = national
    return national
  } catch {
    return []
  }
}

export interface HolidaysConfig {
  /** Datas de feriados em que o estabelecimento ATENDE (ex: ["2026-12-25"]). Se vazio, não atende em feriados. */
  holidays_attend?: string[]
  /** Períodos de fechamento (férias, etc.). */
  closure_periods?: Array<{ start: string; end: string; reason?: string }>
}

/** Verifica se uma data está bloqueada para agendamento (feriado não atendido ou período de férias). */
export async function isDateBlocked(
  dateIso: string,
  config?: HolidaysConfig
): Promise<{ blocked: boolean; reason?: string }> {
  if (!config) return { blocked: false }

  const date = dateIso.trim()

  for (const period of config.closure_periods || []) {
    if (date >= period.start && date <= period.end) {
      return {
        blocked: true,
        reason: period.reason || "Estaremos em recesso neste período.",
      }
    }
  }

  const year = parseInt(date.slice(0, 4), 10)
  const holidays = await fetchNationalHolidays(year)
  const isHoliday = holidays.some((h) => h.date === date)
  const attends = (config.holidays_attend || []).includes(date)

  if (isHoliday && !attends) {
    const holiday = holidays.find((h) => h.date === date)
    return {
      blocked: true,
      reason: holiday
        ? `Nao atendemos no feriado de ${holiday.name}.`
        : "Nao atendemos neste feriado.",
    }
  }

  return { blocked: false }
}

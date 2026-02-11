/**
 * Brasil API - Feriados nacionais.
 * Mesma fonte usada no onboarding (onboarding-chat): https://brasilapi.com.br/api/feriados/v1/{ano}
 */

export interface FeriadoBrasil {
  date: string // YYYY-MM-DD
  name: string
  type?: string
}

/**
 * Busca feriados nacionais do ano via Brasil API.
 * Filtra por type === 'national' ou sem type (igual ao onboarding).
 */
export async function fetchFeriadosNacionais(
  year: number
): Promise<Array<{ date: string; name: string }>> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as FeriadoBrasil[]
    const national = (data || []).filter((h) => h.type === 'national' || !h.type)
    return national.map((h) => ({ date: h.date, name: h.name }))
  } catch {
    return []
  }
}

/**
 * Persistência do agente ativo no client (localStorage).
 * SSR-safe: leitura/escrita apenas no client (typeof window).
 */

export const ACTIVE_AGENT_STORAGE_KEY = 'nevo_active_agent_id'

export function getActiveAgentId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACTIVE_AGENT_STORAGE_KEY)
}

export function setActiveAgentId(agentId: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACTIVE_AGENT_STORAGE_KEY, agentId)
}

export function clearActiveAgentId(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ACTIVE_AGENT_STORAGE_KEY)
}

'use client'

import * as React from 'react'
import { getActiveAgentId, setActiveAgentId as persistActiveAgentId } from '@/lib/agents/active-agent'
import type { Agent } from '@/types/agent'

export interface AgentContextValue {
  agents: Agent[]
  activeAgent: Agent | null
  activeAgentId: string | null
  setActiveAgentId: (id: string) => void
  notifyAgentConfigUpdated: (reason?: string) => void
  lastConfigUpdateAt: number | null
  lastConfigUpdateReason: string | null
  lastAppliedAt: number | null
  markConfigApplied: () => void
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

const AgentContext = React.createContext<AgentContextValue | null>(null)

export function useAgentContext(): AgentContextValue {
  const ctx = React.useContext(AgentContext)
  if (!ctx) {
    throw new Error('useAgentContext must be used within AgentProvider')
  }
  return ctx
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = React.useState<Agent[]>([])
  const [activeAgentId, setActiveAgentIdState] = React.useState<string | null>(null)
  const [lastConfigUpdateAt, setLastConfigUpdateAt] = React.useState<number | null>(null)
  const [lastConfigUpdateReason, setLastConfigUpdateReason] = React.useState<string | null>(null)
  const [lastAppliedAt, setLastAppliedAt] = React.useState<number | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchAgents = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/app/agents')
      if (!res.ok) {
        if (res.status === 401 || res.status === 404) {
          setAgents([])
          return
        }
        throw new Error(await res.json().then((d) => d.error ?? 'Erro ao carregar agentes'))
      }
      const data: Agent[] = await res.json()
      setAgents(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar agentes')
      setAgents([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  // Sempre um agente ativo quando o tenant tem agentes: 1 agente = esse; N agentes = último consultado (localStorage) ou primeiro da lista.
  React.useEffect(() => {
    if (agents.length === 0) return
    const stored = getActiveAgentId()
    const found = stored && agents.some((a) => a.id === stored)
    if (found) {
      setActiveAgentIdState(stored)
    } else {
      const firstId = agents[0].id
      setActiveAgentIdState(firstId)
      persistActiveAgentId(firstId)
    }
  }, [agents])

  const setActiveAgentId = React.useCallback((id: string) => {
    setActiveAgentIdState(id)
    persistActiveAgentId(id)
  }, [])

  const activeAgent = React.useMemo(() => {
    if (!activeAgentId) return null
    return agents.find((a) => a.id === activeAgentId) ?? null
  }, [agents, activeAgentId])

  const notifyAgentConfigUpdated = React.useCallback((reason?: string) => {
    setLastConfigUpdateAt(Date.now())
    setLastConfigUpdateReason(reason ?? null)
  }, [])

  const markConfigApplied = React.useCallback(() => {
    setLastAppliedAt(Date.now())
  }, [])

  const value: AgentContextValue = React.useMemo(
    () => ({
      agents,
      activeAgent,
      activeAgentId,
      setActiveAgentId,
      notifyAgentConfigUpdated,
      lastConfigUpdateAt,
      lastConfigUpdateReason,
      lastAppliedAt,
      markConfigApplied,
      isLoading,
      error,
      refetch: fetchAgents,
    }),
    [
      agents,
      activeAgent,
      activeAgentId,
      setActiveAgentId,
      notifyAgentConfigUpdated,
      lastConfigUpdateAt,
      lastConfigUpdateReason,
      lastAppliedAt,
      markConfigApplied,
      isLoading,
      error,
      fetchAgents,
    ]
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}

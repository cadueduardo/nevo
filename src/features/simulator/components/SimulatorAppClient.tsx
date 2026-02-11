'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { SimulatorPanel } from '@/features/simulator/components/SimulatorPanel'
import { useAgentContext } from '@/components/providers/AgentProvider'
import type { Message } from '@/components/shared/ChatShell'

/**
 * Cliente do simulador: estado (messages, conversation_id), onSend (POST /api/app/simulator).
 * Reutilizado na página /app/simulator, no SimulatorDock e na aba Simulador do detalhe do agente.
 * agentIdOverride: quando informado, usa este agente nas chamadas em vez do agente ativo do contexto.
 */
export interface SimulatorAppClientProps {
  onClose?: () => void
  /** Quando informado, o simulador usa este agente (ex.: aba Simulador no detalhe do agente). */
  agentIdOverride?: string
}

export function SimulatorAppClient({ onClose, agentIdOverride }: SimulatorAppClientProps = {}) {
  const router = useRouter()
  const { activeAgentId } = useAgentContext()
  const effectiveAgentId = agentIdOverride ?? activeAgentId ?? undefined
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [focusTrigger, setFocusTrigger] = useState(0)

  const handleClose = useCallback(() => {
    if (onClose) onClose()
    else router.push('/app')
  }, [onClose, router])

  const onSend = useCallback(async (content: string) => {
    setLoading(true)
    const userMessage: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      kind: 'text',
      content,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])

    try {
      const res = await fetch('/api/app/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          conversation_id: conversationId ?? undefined,
          agent_id: effectiveAgentId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || res.statusText)
      }
      if (data.conversation_id) setConversationId(data.conversation_id)
      const list = Array.isArray(data.messages) ? data.messages : []
      const assistantMessages: Message[] = list.map(
        (m: { content?: string; action_options?: string[] }, idx: number) => ({
          id: `a-${Date.now()}-${idx}`,
          role: 'assistant',
          kind: 'text',
          content: m.content ?? '',
          timestamp: new Date(),
          actionOptions: m.action_options,
        })
      )
      setMessages((prev) => [...prev, ...assistantMessages])
      setFocusTrigger((t) => t + 1)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Erro ao enviar'
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          kind: 'text',
          content: `Desculpe: ${errMsg}`,
          timestamp: new Date(),
        },
      ])
      setFocusTrigger((t) => t + 1)
    } finally {
      setLoading(false)
    }
  }, [conversationId, effectiveAgentId])

  const onReset = useCallback(() => {
    setMessages([])
    setConversationId(null)
  }, [])

  return (
    <SimulatorPanel
      messages={messages}
      isLoading={loading}
      onSend={onSend}
      onReset={onReset}
      onClose={handleClose}
      focusTrigger={focusTrigger}
    />
  )
}

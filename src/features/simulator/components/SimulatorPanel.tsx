'use client'

import { useEffect, useRef } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { ChatComposer } from '@/components/shared/ChatComposer'
import { ChatMessage } from '@/components/shared/ChatMessage'
import type { Message } from '@/components/shared/ChatShell'
import { Button } from '@/components/ui/button'

interface SimulatorPanelProps {
  messages: Message[]
  isLoading?: boolean
  onSend: (message: string) => void
  onReset: () => void
  onClose: () => void
}

export function SimulatorPanel({ messages, isLoading, onSend, onReset, onClose }: SimulatorPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="text-sm font-medium">Simulador de atendimento</div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReset} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reiniciar simulação
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar simulador">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Envie uma mensagem para iniciar a simulação.
          </div>
        )}
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            role={message.role}
            content={message.content}
            timestamp={message.timestamp}
            actionOptions={message.actionOptions}
            selectableOptions={message.selectableOptions}
            onActionClick={(action) => onSend(action)}
          />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-150" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 border-t border-border px-4 py-4">
        <ChatComposer onSend={onSend} disabled={isLoading} placeholder="Digite como se fosse o cliente final..." />
      </div>
    </div>
  )
}

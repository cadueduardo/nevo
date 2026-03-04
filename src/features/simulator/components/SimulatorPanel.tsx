'use client'

import { useEffect, useRef } from 'react'
import { X, RotateCcw, User, Building2 } from 'lucide-react'
import { ChatComposer } from '@/components/shared/ChatComposer'
import { ChatMessage } from '@/components/shared/ChatMessage'
import type { Message } from '@/components/shared/ChatShell'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type SimulatorRole = 'client' | 'owner'

interface SimulatorPanelProps {
  messages: Message[]
  isLoading?: boolean
  onSend: (message: string) => void
  onReset: () => void
  onClose: () => void
  /** Papel atual: client = cliente final; owner = dono/admin. */
  role?: SimulatorRole
  onRoleChange?: (role: SimulatorRole) => void
  /** Incrementa após resposta do agente para manter foco no textarea. */
  focusTrigger?: number
}

export function SimulatorPanel({
  messages,
  isLoading,
  onSend,
  onReset,
  onClose,
  role = 'client',
  onRoleChange,
  focusTrigger,
}: SimulatorPanelProps) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const placeholder =
    role === 'client'
      ? 'Digite como se fosse o cliente final...'
      : 'Digite como dono (ex: consultar agenda, orçamentos)...'

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex flex-col gap-2 px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
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
        {onRoleChange && (
          <Tabs value={role} onValueChange={(v) => onRoleChange(v as SimulatorRole)}>
            <TabsList className="h-8">
              <TabsTrigger value="client" className="gap-1.5 text-xs">
                <User className="h-3.5 w-3.5" />
                Como cliente
              </TabsTrigger>
              <TabsTrigger value="owner" className="gap-1.5 text-xs">
                <Building2 className="h-3.5 w-3.5" />
                Como dono
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
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
            actionOptionsMultiSelect={message.serviceMultiSelect}
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
        <ChatComposer onSend={onSend} disabled={isLoading} placeholder={placeholder} focusTrigger={focusTrigger} />
      </div>
    </div>
  )
}

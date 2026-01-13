'use client'

import { ReactNode } from 'react'
import { ChatThread } from './ChatThread'
import { ChatComposer } from './ChatComposer'
import { cn } from '@/lib/utils'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
  actionOptions?: string[]
}

interface ChatShellProps {
  messages: Message[]
  onSend: (message: string) => void
  isLoading?: boolean
  placeholder?: string
  typingPlaceholders?: string[] // Array de placeholders para animação
  showExamples?: boolean
  examples?: string[]
  onExampleClick?: (example: string) => void
  onActionClick?: (action: string) => void
  header?: ReactNode
  footer?: ReactNode
}

export function ChatShell({
  messages,
  onSend,
  isLoading = false,
  placeholder,
  typingPlaceholders,
  showExamples = false,
  examples = [],
  onExampleClick,
  onActionClick,
  header,
  footer,
}: ChatShellProps) {
  const showEmptyState = messages.length === 0 && !isLoading

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header - Estilo ChatGPT (logo no topo, sem borda) */}
      {header && (
        <div className="flex-shrink-0">
          {header}
        </div>
      )}

      {/* Messages Area */}
      {showEmptyState ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-full max-w-3xl mx-auto px-4 text-center space-y-8">
            <div className="space-y-2">
              <h1 className="text-4xl sm:text-5xl font-normal text-foreground leading-tight">
                Como posso ajudar?
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground font-normal">
                Vamos montar seu atendimento inteligente.
              </p>
            </div>
            {/* Input no mesmo bloco centralizado */}
            <div className="w-full">
              <ChatComposer
                onSend={onSend}
                disabled={isLoading}
                placeholder={placeholder}
                typingPlaceholders={typingPlaceholders}
                showExamples={showExamples && showEmptyState}
                examples={examples}
                onExampleClick={onExampleClick}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <ChatThread 
            messages={messages} 
            isLoading={isLoading}
            onActionClick={onActionClick}
          />
          {/* Input Area - Fixo na parte inferior quando há mensagens */}
          <div className="flex-shrink-0 bg-background px-4 py-4">
            <div className="w-full max-w-3xl mx-auto">
              <ChatComposer
                onSend={onSend}
                disabled={isLoading}
                placeholder={placeholder}
                typingPlaceholders={typingPlaceholders}
                showExamples={false}
                examples={examples}
                onExampleClick={onExampleClick}
              />
            </div>
          </div>
        </>
      )}

      {/* Footer - Sem borda */}
      {footer && (
        <div className="flex-shrink-0">
          {footer}
        </div>
      )}
    </div>
  )
}

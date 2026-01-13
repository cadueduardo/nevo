'use client'

import { cn } from '@/lib/utils'

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
  actionOptions?: string[]
  onActionClick?: (action: string) => void
}

export function ChatMessage({ 
  role, 
  content, 
  timestamp,
  actionOptions,
  onActionClick,
}: ChatMessageProps) {
  const isUser = role === 'user'

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        <p className="text-sm sm:text-base whitespace-pre-wrap break-words font-normal leading-relaxed">
          {content}
        </p>
        
        {/* Botões de ação */}
        {!isUser && actionOptions && actionOptions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {actionOptions.map((option, index) => (
              <button
                key={index}
                onClick={() => onActionClick?.(option)}
                className={cn(
                  'px-4 py-2',
                  'rounded-lg',
                  'text-sm font-normal',
                  'bg-background dark:bg-foreground/10',
                  'text-foreground',
                  'border border-border',
                  'hover:bg-muted',
                  'transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-primary/20'
                )}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {timestamp && (
          <p className="text-xs mt-1 opacity-70">
            {timestamp.toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  )
}

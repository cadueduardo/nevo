'use client'

import { useEffect, useRef } from 'react'
import { ChatMessage } from './ChatMessage'
import type { Message } from './ChatShell'

interface ChatThreadProps {
  messages: Message[]
  isLoading?: boolean
  onActionClick?: (action: string) => void
}

export function ChatThread({ messages, isLoading, onActionClick }: ChatThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full max-w-3xl mx-auto px-4 py-6 space-y-6">
        {messages.map((message) => (
          <ChatMessage
            key={message.id}
            role={message.role}
            content={message.content}
            timestamp={message.timestamp}
            actionOptions={message.actionOptions}
            onActionClick={onActionClick}
          />
        ))}
        
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-150" />
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}

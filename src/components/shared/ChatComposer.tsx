'use client'

import { useState, KeyboardEvent, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TypingPlaceholder } from './TypingPlaceholder'
import { cn } from '@/lib/utils'

interface ChatComposerProps {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
  typingPlaceholders?: string[] // Array de placeholders para animação
  showExamples?: boolean
  examples?: string[]
  onExampleClick?: (example: string) => void
}

export function ChatComposer({
  onSend,
  disabled = false,
  placeholder,
  typingPlaceholders = [],
  showExamples = false,
  examples = [],
  onExampleClick,
}: ChatComposerProps) {
  const [message, setMessage] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [showTyping, setShowTyping] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [message])

  // Parar animação quando focar ou digitar
  useEffect(() => {
    if (isFocused || message.length > 0) {
      setShowTyping(false)
    } else if (typingPlaceholders.length > 0) {
      setShowTyping(true)
    }
  }, [isFocused, message, typingPlaceholders.length])

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim())
      setMessage('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      setShowTyping(true)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFocus = () => {
    setIsFocused(true)
  }

  const handleBlur = () => {
    setIsFocused(false)
  }

  // Placeholder estático ou animado
  const displayPlaceholder = placeholder || (typingPlaceholders.length > 0 ? '' : 'Pergunte alguma coisa...')

  const hasText = message.trim().length > 0

  return (
    <div className="w-full">
      {/* Input Area - Estilo ChatGPT (centralizado e destacado) */}
      <div className="relative w-full">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={displayPlaceholder}
          disabled={disabled}
          className={cn(
            'min-h-[52px] max-h-[200px]',
            'resize-none',
            'text-base',
            'w-full',
            'rounded-2xl',
            'px-4 py-3',
            hasText ? 'pr-14' : 'pr-4',
            'bg-background',
            'border border-border/50',
            'shadow-sm',
            'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50',
            'transition-all',
            'font-normal',
            message.length === 0 && !isFocused && typingPlaceholders.length > 0
              ? 'text-transparent' // Esconder placeholder nativo quando animado
              : 'placeholder:text-muted-foreground/60'
          )}
          rows={1}
        />
        {/* Placeholder animado sobreposto */}
        {showTyping && typingPlaceholders.length > 0 && message.length === 0 && !isFocused && (
          <div
            ref={placeholderRef}
            className="absolute inset-0 pointer-events-none flex items-center px-4 py-3 text-muted-foreground/60 text-base font-normal"
          >
            <TypingPlaceholder texts={typingPlaceholders} />
          </div>
        )}
        {/* Botão de envio - aparece apenas quando há texto */}
        {hasText && (
          <button
            onClick={handleSend}
            disabled={disabled}
            className={cn(
              'absolute right-2 bottom-2',
              'h-8 w-8',
              'flex items-center justify-center',
              'rounded-full',
              'bg-black dark:bg-white',
              'text-white dark:text-black',
              'hover:bg-black/80 dark:hover:bg-white/80',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-all',
              'shadow-sm',
              'focus:outline-none focus:ring-2 focus:ring-primary/20'
            )}
            aria-label="Enviar mensagem"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

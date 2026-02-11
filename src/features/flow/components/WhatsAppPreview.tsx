'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface WhatsAppPreviewUI {
  kind?: 'buttons' | 'list' | 'text'
  options?: string[]
}

interface WhatsAppPreviewProps {
  /** Texto da mensagem (ex.: "Olá! Como posso ajudar?") */
  message: string
  /** Tipo de UI e opções (botões, lista). */
  ui?: WhatsAppPreviewUI | null
  className?: string
}

/**
 * Preview estilo balão WhatsApp para nós message/question.
 * Reutilizável no inspector e nos cards do canvas.
 */
export function WhatsAppPreview({ message, ui, className }: WhatsAppPreviewProps) {
  const kind = ui?.kind ?? 'text'
  const options = ui?.options ?? []

  return (
    <div
      className={cn(
        'max-w-[85%] rounded-lg px-3 py-2 shadow-sm',
        'bg-[#dcf8c6] text-[#111b21]',
        'border border-[#e1e3e2]',
        className
      )}
    >
      <p className="whitespace-pre-wrap break-words text-sm">{message || '(vazio)'}</p>
      {kind === 'buttons' && options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {options.slice(0, 6).map((opt, i) => (
            <span
              key={i}
              className="inline-flex rounded-md border border-[#00a884] bg-white px-2 py-1 text-xs text-[#00a884]"
            >
              {opt}
            </span>
          ))}
          {options.length > 6 && (
            <span className="text-xs text-muted-foreground">+{options.length - 6}</span>
          )}
        </div>
      )}
      {kind === 'list' && options.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
          {options.slice(0, 5).map((opt, i) => (
            <li key={i}>{opt}</li>
          ))}
          {options.length > 5 && <li>… +{options.length - 5}</li>}
        </ul>
      )}
    </div>
  )
}

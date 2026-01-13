'use client'

import { useTypingPlaceholder } from '@/hooks/useTypingPlaceholder'

interface TypingPlaceholderProps {
  texts: string[]
  className?: string
}

export function TypingPlaceholder({ texts, className = '' }: TypingPlaceholderProps) {
  const displayText = useTypingPlaceholder({
    texts,
    typingSpeed: 50,
    deletingSpeed: 30,
    pauseTime: 2000,
    startDelay: 1000,
  })

  return (
    <span className={className}>
      {displayText}
      <span className="animate-pulse">|</span>
    </span>
  )
}

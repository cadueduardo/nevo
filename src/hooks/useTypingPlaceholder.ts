'use client'

import { useState, useEffect, useRef } from 'react'

interface UseTypingPlaceholderOptions {
  texts: string[]
  typingSpeed?: number // ms por caractere
  deletingSpeed?: number // ms por caractere
  pauseTime?: number // ms de pausa entre textos
  startDelay?: number // ms antes de começar
}

export function useTypingPlaceholder({
  texts,
  typingSpeed = 50,
  deletingSpeed = 30,
  pauseTime = 2000,
  startDelay = 1000,
}: UseTypingPlaceholderOptions) {
  const [displayText, setDisplayText] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout>()
  const startedRef = useRef(false)

  useEffect(() => {
    if (texts.length === 0) return

    let timeoutId: NodeJS.Timeout

    const typeText = () => {
      const currentText = texts[currentIndex]
      
      if (!isDeleting && displayText.length < currentText.length) {
        // Digitando
        timeoutId = setTimeout(() => {
          setDisplayText(currentText.slice(0, displayText.length + 1))
        }, typingSpeed)
      } else if (!isDeleting && displayText.length === currentText.length) {
        // Pausa após completar
        timeoutId = setTimeout(() => {
          setIsDeleting(true)
        }, pauseTime)
      } else if (isDeleting && displayText.length > 0) {
        // Apagando
        timeoutId = setTimeout(() => {
          setDisplayText((prev) => prev.slice(0, -1))
        }, deletingSpeed)
      } else if (isDeleting && displayText.length === 0) {
        // Próximo texto
        setIsDeleting(false)
        setCurrentIndex((prev) => (prev + 1) % texts.length)
      }
    }

    if (!startedRef.current) {
      startedRef.current = true
      timeoutId = setTimeout(() => {
        typeText()
      }, startDelay)
    } else {
      typeText()
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [displayText, currentIndex, isDeleting, texts, typingSpeed, deletingSpeed, pauseTime, startDelay])

  return displayText
}

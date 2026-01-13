'use client'

import { useState, useEffect } from 'react'
import { ChatShell, type Message } from '@/components/shared/ChatShell'
import { getOrCreateSessionId } from '@/lib/onboarding/session'
import { sendOnboardingMessage } from '@/lib/onboarding/api'
import type { OnboardingStep } from '@/types/onboarding'

const TYPING_PLACEHOLDERS = [
  'Ex: Tenho um escritório de advocacia e recebo muitos contatos no WhatsApp',
  'Ex: Tenho uma empresa de cortinas e perco tempo fazendo orçamentos',
  'Ex: Sou personal chef e quero automatizar agendamentos e preços',
]

export function LandingChat() {
  const [sessionId, setSessionId] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome')

  // Inicializar session
  useEffect(() => {
    const id = getOrCreateSessionId()
    setSessionId(id)
  }, [])

  const handleSend = async (content: string) => {
    if (!content.trim() || isLoading || !sessionId) return

    // Adicionar mensagem do usuário
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    try {
      // Chamar Edge Function - passar step atual ou undefined para primeira mensagem
      const stepToSend = messages.length === 0 ? undefined : currentStep
      const response = await sendOnboardingMessage(sessionId, content, stepToSend)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.assistant_message,
        timestamp: new Date(),
        actionOptions: response.action_options,
      }

      setMessages((prev) => [...prev, assistantMessage])
      setCurrentStep(response.next_step as OnboardingStep)

      // Redirecionar após cadastro completo
      if (response.next_step === 'completed' && currentStep !== 'completed') {
        // Primeira vez que completa - aguardar alguns segundos e redirecionar
        setTimeout(() => {
          // TODO: Implementar migração de dados e redirecionamento real
          // Por enquanto, apenas mostra mensagem
          console.log('Onboarding completo! Redirecionar para dashboard em breve.')
        }, 3000)
      }
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: 'Desculpe, ocorreu um erro. Pode tentar novamente?',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleActionClick = (action: string) => {
    // Enviar ação como mensagem
    handleSend(action)
  }

  return (
    <ChatShell
      messages={messages}
      onSend={handleSend}
      isLoading={isLoading}
      typingPlaceholders={TYPING_PLACEHOLDERS}
      onActionClick={handleActionClick}
      header={
        <div className="px-4 py-3 flex items-center justify-center">
          <h1 className="text-lg sm:text-xl font-semibold">Nevo</h1>
        </div>
      }
      footer={
        <div className="px-4 py-3 text-xs text-center text-muted-foreground">
          Ao usar o Nevo, você aceita nossos{' '}
          <a href="/terms" className="underline hover:text-foreground">
            Termos
          </a>{' '}
          e{' '}
          <a href="/privacy" className="underline hover:text-foreground">
            Política de Privacidade
          </a>
          .
        </div>
      }
    />
  )
}

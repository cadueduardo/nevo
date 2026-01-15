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

function parseSummaryEditableItemsFromText(text: string) {
  const lines = (text || '').split('\n').map((l) => l.trim())
  const items: Array<{ id: string; label: string; value: string; type: any }> = []

  const bulletLines = lines.filter((l) => l.startsWith('•') || l.startsWith('-'))
  const getValue = (prefix: string) => {
    const line = bulletLines.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()))
    if (!line) return null
    const parts = line.split(':')
    if (parts.length < 2) return null
    return parts.slice(1).join(':').trim()
  }

  const businessName = getValue('• Negócio') || getValue('- Negócio')
  if (businessName) items.push({ id: 'business_name', label: 'Nome do negócio', value: businessName, type: 'business_name' })

  const businessType = getValue('• Tipo') || getValue('- Tipo')
  if (businessType) items.push({ id: 'business_type', label: 'Tipo de negócio', value: businessType, type: 'business_type' })

  const services = getValue('• Serviços') || getValue('- Serviços')
  if (services) {
    const parts = services.split(',').map((s) => s.trim()).filter(Boolean)
    parts.forEach((name, i) => items.push({ id: `service_${i}`, label: 'Serviço', value: name, type: 'service' }))
  }

  const schedule = getValue('• Agenda') || getValue('- Agenda')
  if (schedule) items.push({ id: 'schedule', label: 'Horário de funcionamento', value: schedule, type: 'schedule' })

  const region = getValue('• Região') || getValue('- Região')
  if (region) items.push({ id: 'service_area', label: 'Região', value: region, type: 'service_area' })

  const tone = getValue('• Tom') || getValue('- Tom')
  if (tone) items.push({ id: 'tone_of_voice', label: 'Tom', value: tone, type: 'tone_of_voice' })

  return items
}

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

      // Fallback: quando o backend não envia editable_items no resumo, inferir do próprio texto.
      const inferredEditableItems =
        !response.editable_items && response.requires_action === 'summary_confirmation'
          ? parseSummaryEditableItemsFromText(response.assistant_message)
          : undefined

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        kind: 'text',
        content: response.assistant_message,
        timestamp: new Date(),
        actionOptions: response.action_options,
        editableItems: response.editable_items || (inferredEditableItems && inferredEditableItems.length > 0 ? inferredEditableItems : undefined),
        selectableOptions: response.selectable_options,
        requiresAction: response.requires_action,
      }

      setMessages((prev) => [...prev, assistantMessage])
      setCurrentStep(response.next_step as OnboardingStep)

      // Se backend pedir signup, mostrar card de cadastro (form padrão) em vez de conversa.
      if (response.requires_action === 'signup') {
        const signupCard: Message = {
          id: (Date.now() + 1.5).toString(),
          role: 'assistant',
          kind: 'signup',
          content: '',
          timestamp: new Date(),
          requiresAction: 'signup',
        }
        setMessages((prev) => [...prev, signupCard])
      }

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

  const appendAssistant = (assistant_message: string, payload?: Partial<Message>) => {
    const m: Message = {
      id: (Date.now() + Math.random()).toString(),
      role: 'assistant',
      kind: 'text',
      content: assistant_message,
      timestamp: new Date(),
      ...payload,
    }
    setMessages((prev) => [...prev, m])
  }

  const handleSignupSubmit = async (payload: { email: string; password: string }) => {
    if (isLoading || !sessionId) return
    setIsLoading(true)
    try {
      // Não adicionar email/senha como mensagem do usuário no chat.
      // Orquestrar o fluxo de signup do backend “por trás”.
      const r1 = await sendOnboardingMessage(sessionId, payload.email, 'signup_email')
      appendAssistant(r1.assistant_message, {
        actionOptions: r1.action_options,
        editableItems: r1.editable_items,
        selectableOptions: r1.selectable_options,
        requiresAction: r1.requires_action,
      })
      setCurrentStep(r1.next_step as OnboardingStep)

      const r2 = await sendOnboardingMessage(sessionId, payload.password, 'signup_password')
      appendAssistant(r2.assistant_message, {
        actionOptions: r2.action_options,
        editableItems: r2.editable_items,
        selectableOptions: r2.selectable_options,
        requiresAction: r2.requires_action,
      })
      setCurrentStep(r2.next_step as OnboardingStep)

      if (r2.next_step === 'signup_confirm_password') {
        const r3 = await sendOnboardingMessage(sessionId, payload.password, 'signup_confirm_password')
        appendAssistant(r3.assistant_message, {
          actionOptions: r3.action_options,
          editableItems: r3.editable_items,
          selectableOptions: r3.selectable_options,
          requiresAction: r3.requires_action,
        })
        setCurrentStep(r3.next_step as OnboardingStep)
      }

      // Remover o card de signup após submit (evita duplicação na thread)
      setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
    } catch (e) {
      appendAssistant('Desculpe, não consegui criar sua conta agora. Pode tentar novamente?')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignupCancel = () => {
    setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
    // manter o step atual; usuário pode continuar depois
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
      onSignupSubmit={handleSignupSubmit}
      onSignupCancel={handleSignupCancel}
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

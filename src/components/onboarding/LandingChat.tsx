'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { ChatShell, type Message } from '@/components/shared/ChatShell'
import { clearSessionId, getOrCreateSessionId } from '@/lib/onboarding/session'
import { sendOnboardingMessage } from '@/lib/onboarding/api'
import type { OnboardingStep } from '@/types/onboarding'
import { Button } from '@/components/ui/button'
import { SimulatorPanel } from '@/features/simulator/components/SimulatorPanel'
import { cn } from '@/lib/utils'
import { sendSimulatorMessage, type SimulatorRequest } from '@/lib/simulator/api'
import { createClient } from '@/lib/supabase/client'

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
  const [onboardingData, setOnboardingData] = useState<Record<string, any>>({})
  const [isSimulatorAvailable, setIsSimulatorAvailable] = useState(false)
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false)
  const [simulatorMessages, setSimulatorMessages] = useState<Message[]>([])
  const [isSimulatorLoading, setIsSimulatorLoading] = useState(false)
  const [simulatorConversationId, setSimulatorConversationId] = useState<string | null>(null)
  const [authChoicePending, setAuthChoicePending] = useState(false)
  const supabase = useMemo(() => createClient(), [])
  const retriedCompletedSessionRef = useRef(false)

  const simulatorStorageKey = useMemo(() => {
    if (!sessionId) return null
    return `nevo_simulator_available:${sessionId}`
  }, [sessionId])

  // Inicializar session
  useEffect(() => {
    const id = getOrCreateSessionId()
    setSessionId(id)
  }, [])

  useEffect(() => {
    if (!simulatorStorageKey) return
    const stored = localStorage.getItem(simulatorStorageKey)
    if (stored === 'true') setIsSimulatorAvailable(true)
  }, [simulatorStorageKey])

  const enableSimulator = () => {
    if (!isSimulatorAvailable) {
      setIsSimulatorAvailable(true)
      if (simulatorStorageKey) localStorage.setItem(simulatorStorageKey, 'true')
    }
  }

  const maybeEnableSimulator = (response: { next_step?: string; requires_action?: string | null }) => {
    if (response?.requires_action === 'signup' || response?.next_step === 'signup_request') {
      enableSimulator()
    }
  }

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
      // Se a sessão estiver marcada como "completed" logo na 1a mensagem, reiniciar automaticamente.
      if (
        response.next_step === 'completed' &&
        currentStep === 'welcome' &&
        messages.length === 0 &&
        !retriedCompletedSessionRef.current
      ) {
        retriedCompletedSessionRef.current = true
        clearSessionId()
        const freshSessionId = getOrCreateSessionId()
        setSessionId(freshSessionId)
        setMessages([])
        setOnboardingData({})
        setCurrentStep('welcome')
        setIsSimulatorAvailable(false)
        setIsSimulatorOpen(false)
        setSimulatorMessages([])
        setSimulatorConversationId(null)
        setIsLoading(false)
        await handleSend(content)
        return
      }
      maybeEnableSimulator(response)
      if (response.extracted_data) {
        setOnboardingData((prev) => ({
          ...prev,
          ...response.extracted_data,
          schedule: response.extracted_data.schedule
            ? { ...(prev.schedule || {}), ...response.extracted_data.schedule }
            : prev.schedule,
          service_area: response.extracted_data.service_area
            ? { ...(prev.service_area || {}), ...response.extracted_data.service_area }
            : prev.service_area,
          policies: response.extracted_data.policies
            ? { ...(prev.policies || {}), ...response.extracted_data.policies }
            : prev.policies,
        }))
      }

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
        appendAssistant('Você já tem uma conta ou quer criar uma agora?', {
          actionOptions: ['Tenho conta', 'Quero criar agora', 'Continuar depois'],
        })
        setAuthChoicePending(true)
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
      maybeEnableSimulator(r1)
      if (r1.extracted_data) {
        setOnboardingData((prev) => ({
          ...prev,
          ...r1.extracted_data,
          schedule: r1.extracted_data.schedule
            ? { ...(prev.schedule || {}), ...r1.extracted_data.schedule }
            : prev.schedule,
          service_area: r1.extracted_data.service_area
            ? { ...(prev.service_area || {}), ...r1.extracted_data.service_area }
            : prev.service_area,
          policies: r1.extracted_data.policies
            ? { ...(prev.policies || {}), ...r1.extracted_data.policies }
            : prev.policies,
        }))
      }
      setCurrentStep(r1.next_step as OnboardingStep)
      if (r1.next_step !== 'signup_password') {
        appendAssistant(r1.assistant_message, {
          actionOptions: r1.action_options,
          editableItems: r1.editable_items,
          selectableOptions: r1.selectable_options,
          requiresAction: r1.requires_action,
        })
        return
      }

      const r2 = await sendOnboardingMessage(sessionId, payload.password, 'signup_password')
      maybeEnableSimulator(r2)
      if (r2.extracted_data) {
        setOnboardingData((prev) => ({
          ...prev,
          ...r2.extracted_data,
          schedule: r2.extracted_data.schedule
            ? { ...(prev.schedule || {}), ...r2.extracted_data.schedule }
            : prev.schedule,
          service_area: r2.extracted_data.service_area
            ? { ...(prev.service_area || {}), ...r2.extracted_data.service_area }
            : prev.service_area,
          policies: r2.extracted_data.policies
            ? { ...(prev.policies || {}), ...r2.extracted_data.policies }
            : prev.policies,
        }))
      }
      setCurrentStep(r2.next_step as OnboardingStep)
      if (r2.next_step !== 'signup_confirm_password') {
        appendAssistant(r2.assistant_message, {
          actionOptions: r2.action_options,
          editableItems: r2.editable_items,
          selectableOptions: r2.selectable_options,
          requiresAction: r2.requires_action,
        })
        return
      }

      if (r2.next_step === 'signup_confirm_password') {
        const r3 = await sendOnboardingMessage(sessionId, payload.password, 'signup_confirm_password')
        maybeEnableSimulator(r3)
        if (r3.extracted_data) {
          setOnboardingData((prev) => ({
            ...prev,
            ...r3.extracted_data,
            schedule: r3.extracted_data.schedule
              ? { ...(prev.schedule || {}), ...r3.extracted_data.schedule }
              : prev.schedule,
            service_area: r3.extracted_data.service_area
              ? { ...(prev.service_area || {}), ...r3.extracted_data.service_area }
              : prev.service_area,
            policies: r3.extracted_data.policies
              ? { ...(prev.policies || {}), ...r3.extracted_data.policies }
              : prev.policies,
          }))
        }
        appendAssistant(r3.assistant_message, {
          actionOptions: r3.action_options,
          editableItems: r3.editable_items,
          selectableOptions: r3.selectable_options,
          requiresAction: r3.requires_action,
        })
        setCurrentStep(r3.next_step as OnboardingStep)
        if (r3.next_step === 'completed') {
          // Remover o card de signup apenas quando concluir
          setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
        }
      }
    } catch (e: any) {
      const rawMessage = (e?.message || '').toString()
      const normalized = rawMessage.toLowerCase()
      if (normalized.includes('already') || normalized.includes('registrad')) {
        setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
        appendAssistant('Esse email já tem conta. Quer entrar para continuar?', {
          actionOptions: ['Tenho conta', 'Continuar depois'],
        })
        setAuthChoicePending(true)
        return
      }
      appendAssistant('Desculpe, não consegui criar sua conta agora. Pode tentar novamente?')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignupCancel = () => {
    setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
    // manter o step atual; usuário pode continuar depois
  }

  const handleLoginSubmit = async (payload: { email: string; password: string }) => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: payload.email,
        password: payload.password,
      })
      if (error) {
        appendAssistant('Nao consegui entrar com esses dados. Confira e tente de novo.')
        return
      }
      const migrateResponse = await fetch('/api/onboarding/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!migrateResponse.ok) {
        const err = await migrateResponse.json()
        appendAssistant(err.error || 'Entrei na sua conta, mas não consegui salvar o onboarding agora.')
        return
      }
      setMessages((prev) => prev.filter((m) => m.kind !== 'login'))
      appendAssistant('Pronto! Conta conectada e onboarding salvo.')
      setAuthChoicePending(false)
    } catch {
      appendAssistant('Nao consegui entrar agora. Pode tentar novamente?')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoginCancel = () => {
    setMessages((prev) => prev.filter((m) => m.kind !== 'login'))
    setAuthChoicePending(false)
  }

  const handleActionClick = (action: string) => {
    if (authChoicePending) {
      if (action === 'Tenho conta') {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 3).toString(),
            role: 'assistant',
            kind: 'login',
            content: '',
            timestamp: new Date(),
          },
        ])
        return
      }
      if (action === 'Quero criar agora') {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 3).toString(),
            role: 'assistant',
            kind: 'signup',
            content: '',
            timestamp: new Date(),
            requiresAction: 'signup',
          },
        ])
        return
      }
      if (action === 'Continuar depois') {
        appendAssistant('Sem problemas. Quando quiser, é só criar sua conta por aqui.')
        setAuthChoicePending(false)
        return
      }
    }
    // Enviar ação como mensagem
    handleSend(action)
  }

  const simulatorRequestBase: Omit<SimulatorRequest, 'message'> = useMemo(
    () => ({
      session_id: sessionId,
      conversation_id: simulatorConversationId || undefined,
      channel: 'web_simulator',
      context: {
        business_name: onboardingData.business_name,
        business_type: onboardingData.business_type,
        context_mode: onboardingData.context,
        tone:
          onboardingData.tone_of_voice === 'formal'
            ? 'formal'
            : onboardingData.tone_of_voice === 'friendly'
              ? 'amigavel'
              : onboardingData.tone_of_voice === 'professional'
                ? 'profissional'
                : onboardingData.tone_of_voice === 'funny'
                  ? 'engracado'
                  : onboardingData.tone,
        services: onboardingData.services,
        schedule: onboardingData.schedule,
        staff: onboardingData.staff,
        dynamic_variables: onboardingData.dynamic_variables,
        lead_policy: onboardingData.lead_policy,
      },
    }),
    [onboardingData, sessionId, simulatorConversationId]
  )

  const handleSimulatorSend = async (content: string) => {
    if (!content.trim() || !sessionId) return
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setSimulatorMessages((prev) => [...prev, userMessage])
    setIsSimulatorLoading(true)
    try {
      const response = await sendSimulatorMessage({
        ...simulatorRequestBase,
        message: content,
      })
      setSimulatorConversationId(response.conversation_id)
      const assistantMessages = response.messages.map((m, idx) => ({
        id: `${Date.now() + idx + 1}`,
        role: 'assistant' as const,
        content: m.content,
        timestamp: new Date(m.created_at),
        actionOptions: m.action_options,
      }))
      if (assistantMessages.length > 0) {
        setSimulatorMessages((prev) => [...prev, ...assistantMessages])
      }
    } catch (error: any) {
      setSimulatorMessages((prev) => [
        ...prev,
        {
          id: `${Date.now() + 99}`,
          role: 'assistant',
          content: 'Nao consegui responder agora. Pode tentar de novo?',
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsSimulatorLoading(false)
    }
  }

  const handleSimulatorReset = () => {
    setSimulatorMessages([])
    setIsSimulatorLoading(false)
    setSimulatorConversationId(null)
  }

  const simulatorButton = isSimulatorAvailable ? (
    <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setIsSimulatorOpen(true)}>
      Simular atendimento
    </Button>
  ) : null

  return (
    <div className="h-screen w-full bg-background">
      <div className={cn('h-full', isSimulatorOpen ? 'lg:flex' : 'block')}>
        <div className={cn('h-full', isSimulatorOpen ? 'lg:flex-1 lg:border-r lg:border-border' : 'w-full')}>
          <ChatShell
            messages={messages}
            onSend={handleSend}
            isLoading={isLoading}
            typingPlaceholders={TYPING_PLACEHOLDERS}
            onActionClick={handleActionClick}
            onSignupSubmit={handleSignupSubmit}
            onSignupCancel={handleSignupCancel}
            composerFooter={simulatorButton}
            header={
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <h1 className="text-lg sm:text-xl font-semibold">Nevo</h1>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <a href="/login">Entrar</a>
                  </Button>
                  <Button size="sm" asChild>
                    <a href="/signup">Cadastre-se gratuitamente</a>
                  </Button>
                </div>
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
        </div>

        {isSimulatorOpen && (
          <div className="fixed inset-0 z-50 bg-background lg:static lg:z-auto lg:w-[420px] lg:h-full">
            <SimulatorPanel
              messages={simulatorMessages}
              isLoading={isSimulatorLoading}
              onSend={handleSimulatorSend}
              onReset={handleSimulatorReset}
              onClose={() => setIsSimulatorOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

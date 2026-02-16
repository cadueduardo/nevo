'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatShell, type Message } from '@/components/shared/ChatShell'
import { clearSessionId, getOrCreateSessionId } from '@/lib/onboarding/session'
import { restoreOnboardingSession } from '@/lib/onboarding/restore'
import { sendOnboardingMessage } from '@/lib/onboarding/api'
import type { OnboardingStep } from '@/types/onboarding'
import { Button } from '@/components/ui/button'
import { SimulatorPanel } from '@/features/simulator/components/SimulatorPanel'
import { cn } from '@/lib/utils'
import { sendSimulatorMessage, type SimulatorRequest } from '@/lib/simulator/api'
import { createClient } from '@/lib/supabase/client'
import { AuthenticatedHeaderUserMenu } from '@/components/shared/AuthenticatedHeaderUserMenu'
import Link from 'next/link'

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
  const router = useRouter()
  const searchParams = useSearchParams()
  const isNewAgentOnboarding = searchParams.get('newAgent') === '1'
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
  const [authenticatedEmail, setAuthenticatedEmail] = useState<string | null>(null)
  const [configuredAgentRedirect, setConfiguredAgentRedirect] = useState<string | null>(null)
  const [signupError, setSignupError] = useState<string | null>(null)
  const [focusTrigger, setFocusTrigger] = useState(0)
  const [simulatorFocusTrigger, setSimulatorFocusTrigger] = useState(0)
  const supabase = useMemo(() => createClient(), [])
  const retriedCompletedSessionRef = useRef(false)
  const migrationCompletedRef = useRef(false)
  /** Credenciais do último signup bem-sucedido; usadas ao clicar "Acessar minha área". */
  const lastSignupCredentialsRef = useRef<{ email: string; password: string } | null>(null)

  // Inicializar session (sessionStorage: persiste no F5, limpa ao fechar a aba)
  useEffect(() => {
    const id = getOrCreateSessionId()
    setSessionId(id)
  }, [])

  // Estado de autenticação para header dinâmico no onboarding.
  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted) return
      setAuthenticatedEmail(user?.email ?? null)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticatedEmail(session?.user?.email ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  // Restaurar sessão após F5: buscar do Supabase e re-hidratar estado
  useEffect(() => {
    if (!sessionId || !supabase) return
    let cancelled = false
    restoreOnboardingSession(supabase, sessionId).then(({ session, messages: stored }) => {
      if (cancelled) return
      if (!session || stored.length === 0) return

      setCurrentStep(session.current_step as OnboardingStep)
      setOnboardingData((session.collected_data as Record<string, any>) || {})

      const lastAssistant = [...stored].reverse().find((m) => m.role === 'assistant')
      const lastMeta = lastAssistant?.metadata

      const hydrated: Message[] = stored.map((m, i) => {
        const isLastAssistant = m.role === 'assistant' && i === stored.length - 1
        const needsSignupCard = isLastAssistant && lastMeta?.requires_action === 'signup'
        return {
          id: `restore-${i}-${Date.now()}`,
          role: m.role,
          kind: needsSignupCard ? 'signup' : 'text',
          content: m.content,
          timestamp: new Date(),
          actionOptions: isLastAssistant ? lastMeta?.action_options : undefined,
          requiresAction: isLastAssistant ? lastMeta?.requires_action ?? undefined : undefined,
        }
      })
      setMessages(hydrated)

      if (lastMeta?.requires_action === 'signup' || session.current_step === 'signup_request') {
        setAuthChoicePending(true)
      }
      // Simulador disponível quando atingiu signup ou está além do intro
      if (
        session.current_step === 'signup_request' ||
        (stored.length > 0 && session.current_step !== 'welcome')
      ) {
        setIsSimulatorAvailable(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, supabase])

  const enableSimulator = () => {
    if (!isSimulatorAvailable) setIsSimulatorAvailable(true)
  }

  const maybeEnableSimulator = (response: { next_step?: string; requires_action?: string | null }) => {
    if (response?.requires_action === 'signup' || response?.next_step === 'signup_request') {
      enableSimulator()
    }
  }

  const handleSend = async (
    content: string,
    extra?: { edits?: Array<{ id: string; value: string }>; address?: { cep: string; logradouro: string; numero: string; complemento?: string; bairro: string; localidade: string; uf: string } }
  ) => {
    if ((!content.trim() && !extra?.address) || isLoading || !sessionId) return

    // Adicionar mensagem do usuário (omitir se for envio apenas de endereço)
    if (content.trim()) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMessage])
    }

    setIsLoading(true)

    try {
      // Chamar Edge Function - passar step atual ou undefined para primeira mensagem
      const stepToSend = messages.length === 0 ? undefined : currentStep
      const response = await sendOnboardingMessage(
        sessionId,
        content.trim() || 'confirm_address',
        stepToSend,
        extra?.edits,
        extra?.address
      )
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
      const extracted = response.extracted_data
      if (extracted) {
        setOnboardingData((prev) => ({
          ...prev,
          ...extracted,
          schedule: extracted.schedule
            ? { ...(prev.schedule || {}), ...extracted.schedule }
            : prev.schedule,
          service_area: extracted.service_area
            ? { ...(prev.service_area || {}), ...extracted.service_area }
            : prev.service_area,
          policies: extracted.policies
            ? { ...(prev.policies || {}), ...extracted.policies }
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
        kind: response.requires_action === 'address' ? 'address' : 'text',
        content: response.assistant_message,
        timestamp: new Date(),
        actionOptions: response.action_options,
        editableItems: response.editable_items || (inferredEditableItems && inferredEditableItems.length > 0 ? inferredEditableItems : undefined),
        selectableOptions: response.selectable_options,
        requiresAction: response.requires_action,
        allowCustomInput: response.requires_action === 'services_list',
      }

      setMessages((prev) => [...prev, assistantMessage])
      setCurrentStep(response.next_step as OnboardingStep)

      // Se backend pedir signup: manter apenas a mensagem do backend (Criar conta, Tenho conta, Continuar depois).
      // Não adicionar bloco duplicado — "Criar conta" abre o formulário direto (Google + email/senha).
      if (response.requires_action === 'signup') {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          let nextPath = '/app'
          if (!migrationCompletedRef.current) {
            const migrateResponse = await fetch('/api/onboarding/migrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, new_agent: isNewAgentOnboarding }),
            })
            if (migrateResponse.ok) {
              migrationCompletedRef.current = true
              const migrateData = await migrateResponse.json().catch(() => ({}))
              nextPath =
                typeof (migrateData as { redirect_to?: unknown }).redirect_to === 'string'
                  ? (migrateData as { redirect_to: string }).redirect_to
                  : '/app'
              setConfiguredAgentRedirect(nextPath)
            } else {
              const err = await migrateResponse.json().catch(() => ({}))
              const fallbackName =
                (response.extracted_data as { business_name?: string } | undefined)?.business_name ||
                onboardingData.business_name ||
                'novo agente'
              const failMessage: Message = {
                id: (Date.now() + 2).toString(),
                role: 'assistant',
                kind: 'text',
                content:
                  (err as { error?: string }).error ||
                  `Você já está logado. Não consegui concluir o agente ${fallbackName} agora. Tente novamente em instantes.`,
                timestamp: new Date(),
                actionOptions: ['Simular atendimento'],
              }
              setMessages((prev) => {
                const base = [...prev]
                if (base.length > 0 && base[base.length - 1]?.id === assistantMessage.id) base.pop()
                return [...base, failMessage]
              })
              setAuthChoicePending(false)
              return
            }
          }

          const fallbackName =
            (response.extracted_data as { business_name?: string } | undefined)?.business_name ||
            onboardingData.business_name ||
            'novo agente'
          const doneMessage: Message = {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            kind: 'text',
            content: `Seu agente ${fallbackName} foi configurado. O que você prefere fazer?`,
            timestamp: new Date(),
            actionOptions: ['Simular atendimento', 'Configurar Agente'],
          }
          setMessages((prev) => {
            const base = [...prev]
            if (base.length > 0 && base[base.length - 1]?.id === assistantMessage.id) base.pop()
            return [...base, doneMessage]
          })
          setIsSimulatorAvailable(true)
          setAuthChoicePending(false)
          setCurrentStep('completed')
          if (!configuredAgentRedirect) setConfiguredAgentRedirect(nextPath)
          return
        }

        setAuthChoicePending(true)
        // Se usuário digitou "criar" ou "tenho conta" e backend pediu uso do formulário, exibir o card
        const lowerContent = content.toLowerCase()
        if (response.assistant_message?.includes('formulário')) {
          if (lowerContent.includes('criar')) {
            appendAssistant('', { kind: 'signup', requiresAction: 'signup' })
          } else if (lowerContent.includes('tenho conta') || lowerContent.includes('já tenho')) {
            appendAssistant('', { kind: 'login', requiresAction: 'signup' })
          }
        }
      }

      // Se backend pedir endereço, o assistantMessage já tem kind: 'address' e mostrará AddressForm

      // Redirecionar após cadastro completo (quando vem de outro fluxo com sessão já ativa)
      if (response.next_step === 'completed' && currentStep !== 'completed') {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          if (isNewAgentOnboarding && !migrationCompletedRef.current) {
            migrationCompletedRef.current = true
            const migrateResponse = await fetch('/api/onboarding/migrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, new_agent: true }),
            })
            if (!migrateResponse.ok) {
              const err = await migrateResponse.json().catch(() => ({}))
              appendAssistant(
                (err as { error?: string }).error ||
                'Concluímos o onboarding, mas não consegui criar o novo agente agora.'
              )
              migrationCompletedRef.current = false
              return
            }
            const migrateData = await migrateResponse.json().catch(() => ({}))
            const nextPath =
              typeof (migrateData as { redirect_to?: unknown }).redirect_to === 'string'
                ? (migrateData as { redirect_to: string }).redirect_to
                : '/app'
            router.push(nextPath)
            router.refresh()
            return
          }
          router.push('/app')
          router.refresh()
        }
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
      setFocusTrigger((t) => t + 1)
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
    setSignupError(null)
    setIsLoading(true)
    try {
      // Não adicionar email/senha como mensagem do usuário no chat.
      // Orquestrar o fluxo de signup do backend “por trás”.
      const r1 = await sendOnboardingMessage(sessionId, payload.email, 'signup_email')
      maybeEnableSimulator(r1)
      const r1Data = r1.extracted_data
      if (r1Data) {
        setOnboardingData((prev) => ({
          ...prev,
          ...r1Data,
          schedule: r1Data.schedule
            ? { ...(prev.schedule || {}), ...r1Data.schedule }
            : prev.schedule,
          service_area: r1Data.service_area
            ? { ...(prev.service_area || {}), ...r1Data.service_area }
            : prev.service_area,
          policies: r1Data.policies
            ? { ...(prev.policies || {}), ...r1Data.policies }
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
      const r2Data = r2.extracted_data
      if (r2Data) {
        setOnboardingData((prev) => ({
          ...prev,
          ...r2Data,
          schedule: r2Data.schedule
            ? { ...(prev.schedule || {}), ...r2Data.schedule }
            : prev.schedule,
          service_area: r2Data.service_area
            ? { ...(prev.service_area || {}), ...r2Data.service_area }
            : prev.service_area,
          policies: r2Data.policies
            ? { ...(prev.policies || {}), ...r2Data.policies }
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
        const r3Data = r3.extracted_data
        if (r3Data) {
          setOnboardingData((prev) => ({
            ...prev,
            ...r3Data,
            schedule: r3Data.schedule
              ? { ...(prev.schedule || {}), ...r3Data.schedule }
              : prev.schedule,
            service_area: r3Data.service_area
              ? { ...(prev.service_area || {}), ...r3Data.service_area }
              : prev.service_area,
            policies: r3Data.policies
              ? { ...(prev.policies || {}), ...r3Data.policies }
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
          setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
          lastSignupCredentialsRef.current = { email: payload.email, password: payload.password }
          appendAssistant('Conta criada! O que você prefere fazer agora?', {
            actionOptions: ['Acessar minha área', 'Simular atendimento'],
          })
        }
      }
    } catch (e: any) {
      const rawMessage = (e?.message || '').toString()
      const normalized = rawMessage.toLowerCase()
      if (normalized.includes('already') || normalized.includes('registrad')) {
        setSignupError('Este e-mail já está cadastrado. Use outro e-mail ou clique em "Tenho conta" para entrar.')
        return
      }
      setSignupError('Não foi possível criar a conta. Tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignupCancel = () => {
    setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
    setSignupError(null)
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
        appendAssistant('Não consegui entrar com esses dados. Confira e tente de novo.')
        return
      }
      const migrateResponse = await fetch('/api/onboarding/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, new_agent: isNewAgentOnboarding }),
      })
      if (!migrateResponse.ok) {
        const err = await migrateResponse.json()
        appendAssistant(err.error || 'Entrei na sua conta, mas não consegui salvar o onboarding agora.')
        return
      }
      migrationCompletedRef.current = true
      const migrateData = await migrateResponse.json().catch(() => ({}))
      const nextPath =
        typeof (migrateData as { redirect_to?: unknown }).redirect_to === 'string'
          ? (migrateData as { redirect_to: string }).redirect_to
          : '/app'
      setMessages((prev) => prev.filter((m) => m.kind !== 'login'))
      setAuthChoicePending(false)
      router.push(nextPath)
      router.refresh()
    } catch {
      appendAssistant('Não consegui entrar agora. Pode tentar novamente?')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoginCancel = () => {
    setMessages((prev) => prev.filter((m) => m.kind !== 'login'))
    setAuthChoicePending(false)
  }

  const handleAddressSubmit = async (payload: {
    cep: string
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    localidade: string
    uf: string
  }) => {
    if (isLoading || !sessionId) return
    await handleSend('', { address: payload })
  }

  const handleAddressCancel = () => {
    setMessages((prev) => prev.filter((m) => m.kind !== 'address'))
    handleSend('Pular')
  }

  const handleItemEditLocal = (id: string, value: string) => {
    setMessages((prev) => {
      const lastIdx = prev.length - 1
      if (lastIdx < 0) return prev
      const last = prev[lastIdx]
      if (!last?.editableItems) return prev
      const updated = last.editableItems.map((it) =>
        it.id === id ? { ...it, value } : it
      )
      return [...prev.slice(0, lastIdx), { ...last, editableItems: updated }]
    })
  }

  const handleActionClick = async (action: string) => {
    if (action === 'Acessar minha área' && lastSignupCredentialsRef.current) {
      const cred = lastSignupCredentialsRef.current
      lastSignupCredentialsRef.current = null
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          if (isNewAgentOnboarding && !migrationCompletedRef.current) {
            const migrateResponse = await fetch('/api/onboarding/migrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, new_agent: true }),
            })
            if (migrateResponse.ok) {
              migrationCompletedRef.current = true
              const migrateData = await migrateResponse.json().catch(() => ({}))
              const nextPath =
                typeof (migrateData as { redirect_to?: unknown }).redirect_to === 'string'
                  ? (migrateData as { redirect_to: string }).redirect_to
                  : '/app'
              router.push(nextPath)
              router.refresh()
              return
            }
          }
          router.push('/app')
          router.refresh()
          return
        }
        const { error } = await supabase.auth.signInWithPassword({ email: cred.email, password: cred.password })
        if (!error) {
          if (isNewAgentOnboarding && !migrationCompletedRef.current) {
            const migrateResponse = await fetch('/api/onboarding/migrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, new_agent: true }),
            })
            if (migrateResponse.ok) {
              migrationCompletedRef.current = true
              const migrateData = await migrateResponse.json().catch(() => ({}))
              const nextPath =
                typeof (migrateData as { redirect_to?: unknown }).redirect_to === 'string'
                  ? (migrateData as { redirect_to: string }).redirect_to
                  : '/app'
              router.push(nextPath)
              router.refresh()
              return
            }
          }
          router.push('/app')
          router.refresh()
        } else {
          appendAssistant('Não foi possível entrar. Use o link "Entrar" no topo para acessar com seu email e senha.')
        }
      } catch {
        appendAssistant('Não foi possível entrar. Use o link "Entrar" no topo para acessar com seu email e senha.')
      }
      return
    }
    if (action === 'Simular atendimento') {
      if (lastSignupCredentialsRef.current) lastSignupCredentialsRef.current = null
      enableSimulator()
      setIsSimulatorOpen(true)
      return
    }
    if (action === 'Configurar Agente') {
      const target = configuredAgentRedirect || '/app/agentes'
      router.push(target)
      router.refresh()
      return
    }
    if (authChoicePending) {
      if (action === 'Criar conta' || action === 'Quero criar agora') {
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
      if (action === 'Simular atendimento') {
        enableSimulator()
        setIsSimulatorOpen(true)
        return
      }
      if (action === 'Continuar depois') {
        appendAssistant('Sem problemas. Quando quiser, é só criar sua conta por aqui.')
        setAuthChoicePending(false)
        return
      }
    }
    // Se Continuar e a última mensagem tem service_price, enviar edits em lote
    if (action === 'Continuar') {
      const lastMsg = messages[messages.length - 1]
      const items = lastMsg?.editableItems
      const servicePrices = items?.filter((it) => it.type === 'service_price') ?? []
      if (servicePrices.length > 0) {
        const edits = servicePrices.map((it) => ({ id: it.id, value: (it.value || '').trim() }))
        handleSend(action, { edits })
        return
      }
    }
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
        establishment_address: onboardingData.establishment_address,
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
        when_client_asks_price_no_value: onboardingData.when_client_asks_price_no_value || 'offer_handoff_or_booking',
        schedule: onboardingData.schedule,
        staff: onboardingData.staff,
        dynamic_variables: onboardingData.dynamic_variables,
        lead_policy: onboardingData.lead_policy,
        holidays_attend: onboardingData.holidays_attend,
        closure_periods: onboardingData.closure_periods,
        allow_sequence_booking: onboardingData.allow_sequence_booking,
        sequence_eligible_services: onboardingData.sequence_eligible_services,
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
      setSimulatorFocusTrigger((t) => t + 1)
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
            focusTrigger={focusTrigger}
            typingPlaceholders={TYPING_PLACEHOLDERS}
            onActionClick={handleActionClick}
            onItemEditLocal={handleItemEditLocal}
            onAddressSubmit={handleAddressSubmit}
            onAddressCancel={handleAddressCancel}
            onSignupSubmit={handleSignupSubmit}
            onSignupCancel={handleSignupCancel}
            signupError={signupError}
            onClearSignupError={() => setSignupError(null)}
            onLoginSubmit={handleLoginSubmit}
            onLoginCancel={handleLoginCancel}
            composerFooter={simulatorButton}
            header={
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <h1 className="text-lg sm:text-xl font-semibold">Nevo</h1>
                {authenticatedEmail ? (
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:inline text-sm text-muted-foreground">Você está logado</span>
                    <AuthenticatedHeaderUserMenu
                      userEmail={authenticatedEmail}
                      showWelcomeText={false}
                      showClientAreaButton
                      clientAreaHref="/app"
                      clientAreaLabel="Concluir configuração"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href="/login">Entrar</Link>
                    </Button>
                    <Button size="sm" asChild>
                      <Link href="/signup">Cadastre-se gratuitamente</Link>
                    </Button>
                  </div>
                )}
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
              focusTrigger={simulatorFocusTrigger}
            />
          </div>
        )}
      </div>
    </div>
  )
}

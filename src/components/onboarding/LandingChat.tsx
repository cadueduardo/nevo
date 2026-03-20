'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatShell, type Message } from '@/components/shared/ChatShell'
import { clearSessionId, getOrCreateSessionId } from '@/lib/onboarding/session'
import { sendOnboardingMessage, type NarrativeSegment } from '@/lib/onboarding/api'
import type { SimulatorRequest } from '@/lib/simulator/api'
import type { OnboardingStep } from '@/types/onboarding'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SimulatorRole } from '@/features/simulator/components/SimulatorPanel'
import Link from 'next/link'

const SimulatorPanel = dynamic(
  () => import('@/features/simulator/components/SimulatorPanel').then((mod) => mod.SimulatorPanel),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-background" />,
  }
)

const AuthenticatedHeaderUserMenu = dynamic(
  () =>
    import('@/components/shared/AuthenticatedHeaderUserMenu').then(
      (mod) => mod.AuthenticatedHeaderUserMenu
    ),
  { ssr: false }
)

let supabaseClientPromise: Promise<any> | null = null

async function getSupabaseClient() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = import('@/lib/supabase/client').then((mod) => mod.createClient())
  }
  return supabaseClientPromise
}

async function loadRestoreOnboardingSession() {
  const mod = await import('@/lib/onboarding/restore')
  return mod.restoreOnboardingSession
}

async function loadNormalizePhoneNumber() {
  const mod = await import('@/lib/actor')
  return mod.normalizePhoneNumber
}

async function loadSimulatorDependencies() {
  const [apiMod, contextMod] = await Promise.all([
    import('@/lib/simulator/api'),
    import('@/lib/simulator/context'),
  ])

  return {
    sendSimulatorMessage: apiMod.sendSimulatorMessage,
    buildSimulatorContextFromBusinessConfig: contextMod.buildSimulatorContextFromBusinessConfig,
  }
}

const TYPING_PLACEHOLDERS = [
  'Ex: Tenho um escritório de advocacia e recebo muitos contatos no WhatsApp',
  'Ex: Tenho uma empresa de cortinas e perco tempo fazendo orçamentos',
  'Ex: Sou personal chef e quero automatizar agendamentos e preços',
]

const DAYS_DISPLAY: Record<string, string> = {
  monday: 'Segunda',
  tuesday: 'Terça',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sábado',
  sunday: 'Domingo',
}

/** Conteúdo legível para exibir quando a mensagem é um comando de ação (select_*). Sem nomes técnicos; dias em pt-BR. */
function userMessageDisplayContent(message: string): string {
  const m = (message || '').trim()
  const seqMatch = m.match(/^select_sequence_services:(.+)$/i)
  if (seqMatch) return `Serviços em sequência: ${seqMatch[1].trim()}`
  const catalogMatch = m.match(/^select_catalog_services:(.+)$/i)
  if (catalogMatch) return `Serviços que ofereço: ${catalogMatch[1].trim()}`
  const bookingMatch = m.match(/^select_booking_services:(.+)$/i)
  if (bookingMatch) return `Serviços que podem ser agendados: ${bookingMatch[1].trim()}`
  const svcMatch = m.match(/^select_services:(.+)$/i)
  if (svcMatch) return `Serviços selecionados: ${svcMatch[1].trim()}`
  const daysMatch = m.match(/^select_days:(.+)$/i)
  if (daysMatch) {
    const raw = daysMatch[1].trim().split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean)
    const pt = raw.map((d) => DAYS_DISPLAY[d] ?? d).join(', ')
    return pt ? `Dias de atendimento: ${pt}` : 'Dias de atendimento selecionados'
  }
  const holMatch = m.match(/^select_holidays:(.*)$/i)
  if (holMatch) return holMatch[1].trim() ? `Feriados selecionados: ${holMatch[1].trim()}` : 'Feriados selecionados'
  const qvMatch = m.match(/^select_quote_variables:(.+)$/i)
  if (qvMatch) return `Variáveis de orçamento: ${qvMatch[1].trim()}`
  const qsMatch = m.match(/^select_quote_services:(.+)$/i)
  if (qsMatch) return `Serviços de orçamento: ${qsMatch[1].trim()}`
  const qevMatch = m.match(/^select_quote_external_variables:(.+)$/i)
  if (qevMatch) return `Variáveis para estimativa: ${qevMatch[1].trim()}`
  return m
}

function contentFromNarrativeSegments(segments?: NarrativeSegment[]): string {
  return Array.isArray(segments) ? segments.map((segment) => segment.text).join('') : ''
}

function parseLocalizedNumber(value: string): number | undefined {
  const normalized = value
    .trim()
    .replace(/\s+/g, '')
    .replace(/^R\$\s*/i, '')
    .replace(/\./g, '')
    .replace(',', '.')

  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function applyLocalOnboardingEdit(data: Record<string, any>, id: string, value: string): Record<string, any> {
  const next = { ...data }
  const trimmedValue = value.trim()

  if (id.startsWith('service_price_')) {
    const idx = Number.parseInt(id.replace('service_price_', ''), 10)
    const price = parseLocalizedNumber(trimmedValue)
    const updateServices = (services: any[] | undefined) => {
      if (!Array.isArray(services) || Number.isNaN(idx) || idx < 0 || idx >= services.length) return services
      return services.map((service, serviceIdx) =>
        serviceIdx === idx ? { ...service, base_price: price } : service
      )
    }
    next.services = updateServices(data.services)
    next.booking_services = updateServices(data.booking_services)
    next.catalog_services = updateServices(data.catalog_services)
    return next
  }

  if (id.startsWith('service_duration_')) {
    const idx = Number.parseInt(id.replace('service_duration_', ''), 10)
    const duration = parseLocalizedNumber(trimmedValue)
    const updateServices = (services: any[] | undefined) => {
      if (!Array.isArray(services) || Number.isNaN(idx) || idx < 0 || idx >= services.length) return services
      return services.map((service, serviceIdx) =>
        serviceIdx === idx ? { ...service, duration_minutes: duration } : service
      )
    }
    next.services = updateServices(data.services)
    next.booking_services = updateServices(data.booking_services)
    next.catalog_services = updateServices(data.catalog_services)
    return next
  }

  if (id.startsWith('service_') && !id.startsWith('service_price_') && !id.startsWith('service_duration_')) {
    const idx = Number.parseInt(id.replace('service_', ''), 10)
    const updateServices = (services: any[] | undefined) => {
      if (!Array.isArray(services) || Number.isNaN(idx) || idx < 0 || idx >= services.length) return services
      return services.map((service, serviceIdx) =>
        serviceIdx === idx ? { ...service, name: trimmedValue } : service
      )
    }
    next.services = updateServices(data.services)
    next.booking_services = updateServices(data.booking_services)
    next.catalog_services = updateServices(data.catalog_services)
    return next
  }

  return next
}

function normalizeSignupActionOptions(
  actionOptions: string[] | undefined,
  isAuthenticated: boolean
): string[] | undefined {
  if (!Array.isArray(actionOptions) || actionOptions.length === 0) return actionOptions

  if (isAuthenticated) {
    return ['Simular atendimento', 'Conectar meu WhatsApp agora', 'Continuar no painel']
  }

  const mapped = actionOptions.map((opt) => {
    if (opt === 'Conectar agora') return 'Conectar meu WhatsApp agora'
    if (opt === 'Depois' || opt === 'Continuar depois') return 'Deixar para depois'
    return opt
  })

  const preferredOrder = [
    'Criar conta',
    'Tenho conta',
    'Simular atendimento',
    'Conectar meu WhatsApp agora',
    'Deixar para depois',
  ]

  const uniqueMapped = Array.from(new Set(mapped))
  const ordered = preferredOrder.filter((opt) => uniqueMapped.includes(opt))
  const extra = uniqueMapped.filter((opt) => !preferredOrder.includes(opt))
  return [...ordered, ...extra]
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
  /** Estado semântico do simulador (onboarding): só no navegador, reenviado a cada turno. */
  const simulatorSemanticStateRef = useRef<Record<string, unknown> | null>(null)
  const [authChoicePending, setAuthChoicePending] = useState(false)
  const [authenticatedEmail, setAuthenticatedEmail] = useState<string | null>(null)
  const [configuredAgentRedirect, setConfiguredAgentRedirect] = useState<string | null>(null)
  /** tenant_id e agent_id do migrate; usados no simulador para intents internas (agenda, orçamento). */
  const [simulatorTenantId, setSimulatorTenantId] = useState<string | null>(null)
  const [simulatorAgentId, setSimulatorAgentId] = useState<string | null>(null)
  const [pendingDraftRedirect, setPendingDraftRedirect] = useState<string | null>(null)
  const [isRestartDialogOpen, setIsRestartDialogOpen] = useState(false)
  const [signupError, setSignupError] = useState<string | null>(null)
  const [focusTrigger, setFocusTrigger] = useState(0)
  const [simulatorFocusTrigger, setSimulatorFocusTrigger] = useState(0)
  const [simulatorRole, setSimulatorRole] = useState<SimulatorRole>('client')
  /** FASE 6.5 — Fluxo Conectar WhatsApp (pairing code) */
  const [connectFlowState, setConnectFlowState] = useState<'idle' | 'awaiting_phone' | 'connecting' | 'connected' | 'error'>('idle')
  const [connectPairingCode, setConnectPairingCode] = useState<string | null>(null)
  const [pendingAuthIntent, setPendingAuthIntent] = useState<'connect_whatsapp' | null>(null)
  const connectPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const restoredSessionRef = useRef<string | null>(null)
  const retriedCompletedSessionRef = useRef(false)
  const migrationCompletedRef = useRef(false)
  /** Credenciais do último signup bem-sucedido; usadas ao clicar "Acessar minha área". */
  const lastSignupCredentialsRef = useRef<{ email: string; password: string } | null>(null)

  // Inicializar session (sessionStorage: persiste no F5, limpa ao fechar a aba)
  useEffect(() => {
    const id = getOrCreateSessionId()
    setSessionId(id)
  }, [])

  const onboardingSimStorageKey = (sid: string) => `nevo_onboarding_sim_v1_${sid}`

  /** Reabrir simulador após F5: histórico e estado só no sessionStorage (não grava conversa no banco). */
  useEffect(() => {
    if (!isSimulatorOpen || !sessionId) return
    try {
      const raw = sessionStorage.getItem(onboardingSimStorageKey(sessionId))
      if (!raw) return
      const data = JSON.parse(raw) as {
        messages?: Array<Message & { timestamp?: string }>
        simulator_state?: Record<string, unknown>
      }
      setSimulatorMessages((prev) => {
        if (prev.length > 0) return prev
        if (!Array.isArray(data.messages) || data.messages.length === 0) return prev
        return data.messages.map((m) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        }))
      })
      if (data.simulator_state && typeof data.simulator_state === 'object') {
        simulatorSemanticStateRef.current = data.simulator_state
      }
    } catch {
      /* ignore */
    }
  }, [isSimulatorOpen, sessionId])

  // Estado de autenticação para header dinâmico no onboarding.
  useEffect(() => {
    let mounted = true
    let subscription: { unsubscribe: () => void } | null = null

    ;(async () => {
      const supabase = await getSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!mounted) return
      setAuthenticatedEmail(user?.email ?? null)

      const authState = supabase.auth.onAuthStateChange(
        (_event: unknown, session: { user?: { email?: string | null } } | null) => {
          if (!mounted) return
          setAuthenticatedEmail(session?.user?.email ?? null)
        }
      )
      subscription = authState.data.subscription
    })().catch(() => {
      if (!mounted) return
      setAuthenticatedEmail(null)
    })

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [])

  // Resolve se existe agente em draft para exibir CTA de conclusao apenas quando houver pendencia real.
  useEffect(() => {
    let cancelled = false
    if (!authenticatedEmail) {
      setPendingDraftRedirect(null)
      return
    }

    fetch('/api/app/agents')
      .then(async (res) => {
        if (!res.ok) return []
        return (await res.json()) as Array<{ id: string; status: string }>
      })
      .then((agents) => {
        if (cancelled) return
        const draft = Array.isArray(agents) ? agents.find((a) => a.status === 'draft') : undefined
        setPendingDraftRedirect(
          draft ? `/app/agentes/${draft.id}?tab=canais&pending=whatsapp` : null
        )
      })
      .catch(() => {
        if (!cancelled) setPendingDraftRedirect(null)
      })

    return () => {
      cancelled = true
    }
  }, [authenticatedEmail])

  // FASE 6.5 — Polling de status da conexão WhatsApp
  useEffect(() => {
    if (connectFlowState !== 'connecting' || !simulatorAgentId) return

    const checkStatus = async () => {
      try {
        const res = await fetch(
          `/api/whatsapp/connect/status?agent_id=${encodeURIComponent(simulatorAgentId)}`
        )
        const data = (await res.json().catch(() => ({}))) as { status?: string }
        if (data.status === 'connected') {
          setConnectFlowState('connected')
          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              kind: 'text',
              content: 'Conectado ✅ A partir de agora o Nevo atende por esse número.',
              timestamp: new Date(),
            },
          ])
        }
      } catch {
        /* ignora */
      }
    }

    checkStatus()
    const id = setInterval(checkStatus, 4000)
    connectPollRef.current = id
    return () => {
      if (connectPollRef.current) {
        clearInterval(connectPollRef.current)
        connectPollRef.current = null
      }
    }
  }, [connectFlowState, simulatorAgentId])

  // Restaurar sessão após F5: buscar do Supabase e re-hidratar estado
  useEffect(() => {
    if (!sessionId) return
    if (restoredSessionRef.current === sessionId) return
    let cancelled = false
    ;(async () => {
      const [supabase, restoreOnboardingSession] = await Promise.all([
        getSupabaseClient(),
        loadRestoreOnboardingSession(),
      ])
      const { session, messages: stored } = await restoreOnboardingSession(supabase, sessionId)
      if (cancelled) return
      if (!session || stored.length === 0) return
      restoredSessionRef.current = sessionId

      setCurrentStep(session.current_step as OnboardingStep)
      setOnboardingData((session.collected_data as Record<string, any>) || {})

      const lastAssistant = [...stored].reverse().find((m) => m.role === 'assistant')
      const lastMeta = lastAssistant?.metadata

      const hydrated: Message[] = stored.map((m, i) => {
        const isLastAssistant = m.role === 'assistant' && i === stored.length - 1
        const displayContent = m.role === 'user' ? userMessageDisplayContent(m.content) : m.content
        const requiresAction = isLastAssistant ? lastMeta?.requires_action ?? undefined : undefined
        const actionOptionsRaw = isLastAssistant ? lastMeta?.action_options : undefined
        const actionOptions =
          requiresAction === 'signup'
            ? normalizeSignupActionOptions(actionOptionsRaw, Boolean(authenticatedEmail))
            : actionOptionsRaw
        return {
          id: `restore-${i}-${Date.now()}`,
          role: m.role,
          // Não abrir automaticamente o card de signup ao restaurar.
          // Mantemos o texto + botões do backend para evitar sumiço de CTAs como "Conectar meu WhatsApp agora".
          kind: 'text',
          content: displayContent,
          timestamp: new Date(),
          actionOptions,
          editableItems: isLastAssistant ? (lastMeta?.editable_items as Message['editableItems']) ?? undefined : undefined,
          selectableOptions: isLastAssistant ? (lastMeta?.selectable_options as Message['selectableOptions']) ?? undefined : undefined,
          narrativeSegments: isLastAssistant ? (lastMeta?.narrative_segments as Message['narrativeSegments']) ?? undefined : undefined,
          requiresAction,
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
    })().catch(() => {
      /* ignore restore failures */
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, authenticatedEmail])

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

    // FASE 6.5 — Fluxo Conectar WhatsApp: número para pairing
    if (connectFlowState === 'awaiting_phone' && content.trim()) {
      const normalizePhoneNumber = await loadNormalizePhoneNumber()
      const phone = normalizePhoneNumber(content)
      if (phone.length < 12) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'user', content: content, timestamp: new Date() },
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            kind: 'text',
            content: 'Número inválido. Use DDI+DDD+número (ex: 5511999999999).',
            timestamp: new Date(),
          },
        ])
        return
      }
      const agentId = simulatorAgentId
      if (!agentId) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: 'user', content: content, timestamp: new Date() },
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            kind: 'text',
            content: 'Agente ainda não configurado. Conclua o cadastro primeiro.',
            timestamp: new Date(),
          },
        ])
        setConnectFlowState('error')
        return
      }
      setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'user', content: phone, timestamp: new Date() }])
      setIsLoading(true)
      try {
        const res = await fetch('/api/whatsapp/connect/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, phone }),
        })
        const data = (await res.json().catch(() => ({}))) as { pairingCode?: string; error?: string; message?: string }
        if (!res.ok || !data.pairingCode) {
          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              kind: 'text',
              content: data.error || 'Não foi possível obter o código. Tente novamente.',
              timestamp: new Date(),
              actionOptions: ['Regerar código', 'Depois'],
            },
          ])
          setConnectFlowState('error')
          setIsLoading(false)
          return
        }
        setConnectPairingCode(data.pairingCode)
        setConnectFlowState('connecting')
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            kind: 'text',
            content: `Pronto. Use este código para vincular: **${data.pairingCode}**\n\nNo WhatsApp: Configurações → Aparelhos conectados → Vincular dispositivo → Vincular com código.\n\nAguardando conexão…`,
            timestamp: new Date(),
            actionOptions: ['Regerar código'],
          },
        ])
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            kind: 'text',
            content: 'Erro ao conectar. Tente novamente.',
            timestamp: new Date(),
          },
        ])
        setConnectFlowState('error')
      }
      setIsLoading(false)
      return
    }

    // Adicionar mensagem do usuário (omitir se for envio apenas de endereço)
    if (content.trim()) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: userMessageDisplayContent(content),
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
        simulatorSemanticStateRef.current = null
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
      const normalizedActionOptions =
        response.requires_action === 'signup'
          ? normalizeSignupActionOptions(response.action_options, Boolean(authenticatedEmail))
          : response.action_options

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        kind: response.requires_action === 'address' ? 'address' : 'text',
        content: response.assistant_message,
        timestamp: new Date(),
        actionOptions: normalizedActionOptions,
        editableItems: response.editable_items,
        selectableOptions: response.selectable_options,
        narrativeSegments: response.narrative_segments,
        requiresAction: response.requires_action,
        allowCustomInput:
          response.requires_action === 'catalog_services_list' ||
          response.requires_action === 'booking_services_list' ||
          response.requires_action === 'services_list' ||
          response.requires_action === 'services_edit' ||
          response.requires_action === 'quote_variables' ||
          response.requires_action === 'quote_services_list' ||
          response.requires_action === 'quote_external_variables',
      }

      setMessages((prev) => [...prev, assistantMessage])
      setCurrentStep(response.next_step as OnboardingStep)

      // Se backend pedir signup: manter apenas a mensagem do backend (Criar conta, Tenho conta, Deixar para depois).
      // Não adicionar bloco duplicado - "Criar conta" abre o formulário direto (Google + email/senha).
      if (response.requires_action === 'signup') {
        const supabase = await getSupabaseClient()
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
              const migrateData = await migrateResponse.json().catch(() => ({})) as {
                redirect_to?: string
                agent_id?: string
                tenant_id?: string
              }
              nextPath =
                typeof migrateData.redirect_to === 'string' ? migrateData.redirect_to : '/app'
              setConfiguredAgentRedirect(nextPath)
              if (migrateData.agent_id) setSimulatorAgentId(migrateData.agent_id)
              else {
                const agentMatch = nextPath.match(/^\/app\/agentes\/([a-f0-9-]+)/i)
                if (agentMatch) setSimulatorAgentId(agentMatch[1])
              }
              if (migrateData.tenant_id) setSimulatorTenantId(migrateData.tenant_id)
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
            actionOptions: ['Simular atendimento', 'Conectar meu WhatsApp agora', 'Continuar no painel'],
          }
          setMessages((prev) => {
            const base = [...prev]
            if (base.length > 0 && base[base.length - 1]?.id === assistantMessage.id) base.pop()
            return [...base, doneMessage]
          })
          setIsSimulatorAvailable(true)
          setAuthChoicePending(true)
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
        const supabase = await getSupabaseClient()
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

  const resetOnboarding = () => {
    if (typeof window !== 'undefined' && sessionId) {
      try {
        sessionStorage.removeItem(onboardingSimStorageKey(sessionId))
      } catch {
        /* ignore */
      }
    }
    clearSessionId()
    const freshSessionId = getOrCreateSessionId()
    restoredSessionRef.current = null
    setSessionId(freshSessionId)
    setMessages([])
    setCurrentStep('welcome')
    setOnboardingData({})
    setIsLoading(false)
    setAuthChoicePending(false)
    setConfiguredAgentRedirect(null)
    setSimulatorTenantId(null)
    setSimulatorAgentId(null)
    setSignupError(null)
    setIsSimulatorAvailable(false)
    setIsSimulatorOpen(false)
    setSimulatorMessages([])
    setIsSimulatorLoading(false)
    simulatorSemanticStateRef.current = null
    setIsRestartDialogOpen(false)
    lastSignupCredentialsRef.current = null
    retriedCompletedSessionRef.current = false
    migrationCompletedRef.current = false
    setFocusTrigger((t) => t + 1)
  }

  const handleSignupSubmit = async (payload: { email: string; password: string }) => {
    if (isLoading || !sessionId) return
    setSignupError(null)
    setIsLoading(true)
    try {
      // Não adicionar email/senha como mensagem do usuário no chat.
      // Orquestrar o fluxo de signup do backend "por trás".
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
          narrativeSegments: r1.narrative_segments,
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
          narrativeSegments: r2.narrative_segments,
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
          narrativeSegments: r3.narrative_segments,
          requiresAction: r3.requires_action,
        })
        setCurrentStep(r3.next_step as OnboardingStep)
        if (r3.next_step === 'completed') {
          setMessages((prev) => prev.filter((m) => m.kind !== 'signup'))
          lastSignupCredentialsRef.current = { email: payload.email, password: payload.password }
          // Backend já fez a migração; fazer login para ter sessão e usar agent_id do response
          migrationCompletedRef.current = true
          const ext = r3.extracted_data as { agent_id?: string; tenant_id?: string } | undefined
          const agentId = ext?.agent_id
          const tenantId = ext?.tenant_id
          if (agentId) {
            setSimulatorAgentId(agentId)
            setConfiguredAgentRedirect(`/app/agentes/${agentId}?tab=canais&pending=whatsapp`)
          }
          if (tenantId) setSimulatorTenantId(tenantId)
          const supabase = await getSupabaseClient()
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: payload.email,
            password: payload.password,
          })
          if (signInError) {
            appendAssistant(
              'Conta criada! Use o link "Entrar" no topo para acessar com seu email e senha.',
              { actionOptions: ['Simular atendimento'] }
            )
          } else {
            if (pendingAuthIntent === 'connect_whatsapp') {
              setPendingAuthIntent(null)
              setAuthChoicePending(true)
              setConnectFlowState('idle')
              appendAssistant('Conta criada e login concluído ✅\n\nO que você prefere fazer agora?', {
                actionOptions: ['Simular atendimento', 'Conectar meu WhatsApp agora', 'Continuar no painel'],
              })
            } else {
              appendAssistant('Conta criada! O que você prefere fazer agora?', {
                actionOptions: ['Acessar minha área', 'Simular atendimento'],
              })
            }
          }
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
      const supabase = await getSupabaseClient()
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
      const migrateData = (await migrateResponse.json().catch(() => ({}))) as {
        redirect_to?: string
        agent_id?: string
        tenant_id?: string
      }
      if (migrateData.agent_id) setSimulatorAgentId(migrateData.agent_id)
      if (migrateData.tenant_id) setSimulatorTenantId(migrateData.tenant_id)
      const nextPath =
        typeof migrateData.redirect_to === 'string'
          ? migrateData.redirect_to
          : '/app'
      setMessages((prev) => prev.filter((m) => m.kind !== 'login'))
      if (pendingAuthIntent === 'connect_whatsapp') {
        setPendingAuthIntent(null)
        setAuthChoicePending(true)
        setConnectFlowState('idle')
        appendAssistant('Login concluído ✅\n\nO que você prefere fazer agora?', {
          actionOptions: ['Simular atendimento', 'Conectar meu WhatsApp agora', 'Continuar no painel'],
        })
        return
      }
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
    setPendingAuthIntent(null)
  }

  const handleLoginCreateAccount = () => {
    setMessages((prev) => {
      const withoutLogin = prev.filter((m) => m.kind !== 'login')
      return [
        ...withoutLogin,
        {
          id: (Date.now() + 3).toString(),
          role: 'assistant',
          kind: 'signup',
          content: '',
          timestamp: new Date(),
          requiresAction: 'signup',
        },
      ]
    })
    setAuthChoicePending(true)
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
    setOnboardingData((prev) => applyLocalOnboardingEdit(prev, id, value))
    setMessages((prev) => {
      const targetIdx = [...prev]
        .map((msg, idx) => ({ msg, idx }))
        .reverse()
        .find(({ msg }) => Array.isArray(msg.editableItems) && msg.editableItems.some((it) => it.id === id))?.idx

      if (targetIdx == null) return prev
      const target = prev[targetIdx]
      if (!target?.editableItems) return prev

      const currentItem = target.editableItems.find((it) => it.id === id)
      const updated = target.editableItems.map((it) => (it.id === id ? { ...it, value } : it))
      const updatedNarrativeSegments = target.narrativeSegments?.map((segment) =>
        segment.kind === 'editable' && segment.item_id === id ? { ...segment, text: value.trim() } : segment
      )

      let nextContent = target.content
      const oldValue = currentItem?.value?.trim()
      const newValue = value.trim()
      const isNarrativeSummary =
        target.requiresAction === 'summary_confirmation' || target.requiresAction === 'summary_edit'

      if (updatedNarrativeSegments && updatedNarrativeSegments.length > 0) {
        nextContent = contentFromNarrativeSegments(updatedNarrativeSegments)
      } else if (isNarrativeSummary && oldValue && newValue && oldValue !== newValue && nextContent.includes(oldValue)) {
        nextContent = nextContent.replace(oldValue, newValue)
      }

      return [
        ...prev.slice(0, targetIdx),
        { ...target, content: nextContent, editableItems: updated, narrativeSegments: updatedNarrativeSegments },
        ...prev.slice(targetIdx + 1),
      ]
    })
    // Persistir no backend em background para não perder a edição ao adicionar outro item ou avançar
    if (sessionId && currentStep && value.trim()) {
      sendOnboardingMessage(sessionId, '__sync_edits__', currentStep, [{ id, value: value.trim() }]).catch(() => {
        // Falha silenciosa; o estado local já foi atualizado
      })
    }
  }

  const handleActionClick = async (action: string) => {
    if (action === 'Acessar minha área' && lastSignupCredentialsRef.current) {
      const cred = lastSignupCredentialsRef.current
      lastSignupCredentialsRef.current = null
      const redirectTo = configuredAgentRedirect || '/app'
      try {
        const supabase = await getSupabaseClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          if (!migrationCompletedRef.current) {
            const migrateResponse = await fetch('/api/onboarding/migrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, new_agent: isNewAgentOnboarding }),
            })
            if (migrateResponse.ok) {
              migrationCompletedRef.current = true
              const migrateData = (await migrateResponse.json().catch(() => ({}))) as { redirect_to?: string }
              const nextPath =
                typeof migrateData.redirect_to === 'string' ? migrateData.redirect_to : redirectTo
              router.push(nextPath)
              router.refresh()
              return
            }
          }
          router.push(redirectTo)
          router.refresh()
          return
        }
        const { error } = await supabase.auth.signInWithPassword({ email: cred.email, password: cred.password })
        if (!error) {
          if (!migrationCompletedRef.current) {
            const migrateResponse = await fetch('/api/onboarding/migrate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, new_agent: isNewAgentOnboarding }),
            })
            if (migrateResponse.ok) {
              migrationCompletedRef.current = true
              const migrateData = (await migrateResponse.json().catch(() => ({}))) as { redirect_to?: string }
              const nextPath =
                typeof migrateData.redirect_to === 'string' ? migrateData.redirect_to : redirectTo
              router.push(nextPath)
              router.refresh()
              return
            }
          }
          router.push(redirectTo)
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
    if (action === 'Configurar Agente' || action === 'Continuar no painel') {
      const target = configuredAgentRedirect || '/app/agentes'
      router.push(target)
      router.refresh()
      return
    }
    if (action === 'Conectar agora' || action === 'Conectar meu WhatsApp agora') {
      const supabase = await getSupabaseClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setPendingAuthIntent('connect_whatsapp')
        setAuthChoicePending(true)
        appendAssistant('Para conectar seu WhatsApp, primeiro faça login.\n\nSe ainda não tem conta, clique em "Criar conta".')
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 3).toString(),
            role: 'assistant',
            kind: 'login',
            content: '',
            timestamp: new Date(),
            requiresAction: 'signup',
          },
        ])
        return
      }
      if (!simulatorAgentId) {
        appendAssistant('Conclua o cadastro primeiro para conectar o WhatsApp.')
        return
      }
      setPendingAuthIntent(null)
      setConnectFlowState('awaiting_phone')
      appendAssistant(
        'Vou preparar a conexão do seu WhatsApp.\n\nMe confirme o número com DDI/DDD (ex: 5511999999999).'
      )
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
      if (action === 'Deixar para depois' || action === 'Continuar depois' || action === 'Depois') {
        appendAssistant(
          'Sem problemas. Quando quiser, é só criar sua conta por aqui. Para conectar o WhatsApp depois, diga: conectar whatsapp.'
        )
        setAuthChoicePending(false)
        setPendingAuthIntent(null)
        return
      }
      if (action === 'Regerar código' && connectFlowState !== 'idle' && simulatorAgentId) {
        setConnectFlowState('awaiting_phone')
        appendAssistant('Me confirme o número com DDI/DDD (ex: 5511999999999).')
        return
      }
    }
    // Se Continuar e a última mensagem tem campos editáveis, enviar edits em lote.
    if (action === 'Continuar') {
      const lastMsg = messages[messages.length - 1]
      const items = lastMsg?.editableItems
      if (items && items.length > 0) {
        const edits = items
          .map((it) => ({ id: it.id, value: (it.value || '').trim() }))
          .filter((it) => it.value.length > 0)
        if (edits.length > 0) {
          handleSend(action, { edits })
          return
        }
      }
    }
    handleSend(action)
  }

  /** Simulador onboarding: simulation_local — não persiste conversa no banco; estado em sessionStorage. */
  const persistOnboardingSimulator = (msgs: Message[], state: Record<string, unknown> | null) => {
    if (typeof window === 'undefined' || !sessionId) return
    try {
      sessionStorage.setItem(
        onboardingSimStorageKey(sessionId),
        JSON.stringify({
          messages: msgs.map((m) => ({
            ...m,
            timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
          })),
          simulator_state: state,
        })
      )
    } catch {
      /* quota / private mode */
    }
  }

  const handleSimulatorSend = async (content: string) => {
    if (!content.trim() || !sessionId || isSimulatorLoading) return
    const historyForApi = simulatorMessages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
      .map((m) => ({ role: m.role, content: String(m.content).trim() }))
      .slice(-20)
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setSimulatorMessages((prev) => [...prev, userMessage])
    setIsSimulatorLoading(true)
    try {
      const { sendSimulatorMessage, buildSimulatorContextFromBusinessConfig } =
        await loadSimulatorDependencies()
      const simulatorRequestBase: Omit<
        SimulatorRequest,
        'message' | 'simulator_state' | 'simulator_history'
      > = {
        session_id: sessionId,
        onboarding_session_id: sessionId,
        simulation_local: true,
        channel: 'web_simulator',
        mode: simulatorRole === 'owner' ? 'internal' : 'external',
        actor_type: simulatorRole === 'owner' ? 'owner' : 'client',
        context: buildSimulatorContextFromBusinessConfig({
          businessName: onboardingData.business_name,
          businessConfig: {
            ...onboardingData,
            context_mode: onboardingData.context,
            when_client_asks_price_no_value:
              onboardingData.when_client_asks_price_no_value || 'offer_handoff_or_booking',
            services: onboardingData.services,
            booking_services: onboardingData.booking_services ?? onboardingData.services,
            catalog_services: onboardingData.catalog_services ?? onboardingData.services,
          },
          tone: onboardingData.tone_of_voice ?? onboardingData.tone,
        }),
      }
      const response = await sendSimulatorMessage({
        ...simulatorRequestBase,
        message: content,
        simulator_state: simulatorSemanticStateRef.current ?? undefined,
        simulator_history: historyForApi,
      })
      if (response.simulator_state && typeof response.simulator_state === 'object') {
        simulatorSemanticStateRef.current = response.simulator_state as Record<string, unknown>
      }
      const assistantMessages = response.messages.map((m, idx) => ({
        id: `${Date.now() + idx + 1}`,
        role: 'assistant' as const,
        content: m.content,
        timestamp: new Date(m.created_at),
        actionOptions: m.action_options,
        serviceMultiSelect: m.service_multi_select ?? false,
      }))
      if (assistantMessages.length > 0) {
        setSimulatorMessages((prev) => {
          const next = [...prev, ...assistantMessages]
          persistOnboardingSimulator(next, simulatorSemanticStateRef.current)
          return next
        })
      }
    } catch (error: any) {
      const errMsg = error?.message || 'Erro desconhecido'
      setSimulatorMessages((prev) => [
        ...prev,
        {
          id: `${Date.now() + 99}`,
          role: 'assistant',
          content: `Nao consegui responder: ${errMsg}. Pode tentar de novo?`,
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
    simulatorSemanticStateRef.current = null
    if (typeof window !== 'undefined' && sessionId) {
      try {
        sessionStorage.removeItem(onboardingSimStorageKey(sessionId))
      } catch {
        /* ignore */
      }
    }
  }

  const handleSimulatorRoleChange = (newRole: SimulatorRole) => {
    setSimulatorRole(newRole)
    handleSimulatorReset()
  }

  const simulatorButton = isSimulatorAvailable ? (
    <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setIsSimulatorOpen(true)}>
      Simular atendimento
    </Button>
  ) : null
  const hasOnboardingProgress =
    messages.length > 0 || currentStep !== 'welcome' || Object.keys(onboardingData).length > 0

  const configuredAgentPath =
    configuredAgentRedirect && configuredAgentRedirect.startsWith('/app/agentes/')
      ? configuredAgentRedirect
      : null
  const clientAreaHref = configuredAgentPath || pendingDraftRedirect || '/app'
  const clientAreaLabel =
    configuredAgentPath || pendingDraftRedirect ? 'Concluir configuração' : 'Área do cliente'

  const composerFooter = (
    <div className="flex flex-col items-center gap-2">
      {simulatorButton}
      {hasOnboardingProgress && (
        <button
          type="button"
          onClick={() => setIsRestartDialogOpen(true)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline hover:text-foreground transition-colors"
        >
          Recomeçar configuração
        </button>
      )}
    </div>
  )

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
            onLoginCreateAccount={handleLoginCreateAccount}
            composerFooter={composerFooter}
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
                      clientAreaHref={clientAreaHref}
                      clientAreaLabel={clientAreaLabel}
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
              role={simulatorRole}
              onRoleChange={handleSimulatorRoleChange}
              focusTrigger={simulatorFocusTrigger}
            />
          </div>
        )}

        {isRestartDialogOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-lg">
              <h2 className="text-base font-semibold">Recomeçar configuração?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Isso vai apagar o progresso atual do onboarding nesta sessão.
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsRestartDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={resetOnboarding}>
                  Recomeçar
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

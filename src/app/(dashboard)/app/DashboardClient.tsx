'use client'

import * as React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAgentContext } from '@/components/providers/AgentProvider'

function formatNextAppointmentAt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const today =
    now.getFullYear() === d.getFullYear() &&
    now.getMonth() === d.getMonth() &&
    now.getDate() === d.getDate()
  const time = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  if (today) return `Hoje ${time}`
  const date = d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  })
  return `${date} ${time}`
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  )
}

function MetricCard({
  title,
  value,
  helper,
  accent,
}: {
  title: string
  value: React.ReactNode
  helper?: string
  accent?: 'green' | 'orange' | 'purple' | 'blue'
}) {
  const accentBorder =
    accent === 'green'
      ? 'border-l-4 border-l-green-500'
      : accent === 'orange'
        ? 'border-l-4 border-l-orange-500'
        : accent === 'purple'
          ? 'border-l-4 border-l-purple-500'
          : accent === 'blue'
            ? 'border-l-4 border-l-blue-500'
            : ''
  return (
    <Card className={`shadow-sm ${accentBorder}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {helper ? (
          <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

interface BootstrapData {
  tenant: { id: string; name: string; slug: string }
  tenant_setting: {
    tone: string | null
    handoff_mode: string | null
    when_client_asks_price_no_value: string | null
    business_config: Record<string, unknown>
  }
  flow: unknown
}

interface AppointmentRow {
  start_at: string
}

export function DashboardClient() {
  const { activeAgentId, error: agentsError } = useAgentContext()
  const [bootstrap, setBootstrap] = React.useState<BootstrapData | null>(null)
  const [appointments, setAppointments] = React.useState<AppointmentRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (activeAgentId == null) {
      setBootstrap(null)
      setAppointments([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setDate(end.getDate() + 30)
    end.setHours(23, 59, 59, 999)
    const fromISO = today.toISOString().slice(0, 10)
    const toISO = end.toISOString().slice(0, 10)
    Promise.all([
      fetch(`/api/app/bootstrap?agent_id=${encodeURIComponent(activeAgentId)}`).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(r.statusText))
      ),
      fetch(
        `/api/app/appointments?agent_id=${encodeURIComponent(activeAgentId)}&from=${fromISO}&to=${toISO}`
      ).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([boot, appts]) => {
        if (!cancelled) {
          setBootstrap(boot as BootstrapData)
          setAppointments(Array.isArray(appts) ? appts : [])
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAgentId])

  if (activeAgentId == null) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
          <Card className="rounded-2xl border-dashed border-border">
            <CardContent className="py-8">
              <p className="text-sm font-medium">Selecione um agente</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {agentsError
                  ? 'Não foi possível carregar os agentes. Se o banco foi configurado recentemente, aplique a migração no projeto: supabase db push'
                  : 'Use o menu no topo para escolher o agente e ver o painel.'}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background">
        <p className="text-muted-foreground">Carregando…</p>
      </div>
    )
  }

  if (error || !bootstrap) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
          <p className="text-destructive">{error ?? 'Nenhum tenant vinculado à sua conta.'}</p>
        </div>
      </div>
    )
  }

  const { tenant, tenant_setting } = bootstrap
  const upcomingAppointments = appointments.length
  const nextAppointmentAt =
    appointments.length > 0 && appointments[0].start_at
      ? formatNextAppointmentAt(appointments[0].start_at)
      : null
  const conversationsToday = 0
  const statusLabel = 'Em teste'
  const hasAnyActivity = conversationsToday > 0 || upcomingAppointments > 0

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/app" className="hover:text-foreground">
            Início
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Dashboard</span>
        </nav>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">
              Painel do <span className="text-primary">{tenant.name}</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Visão geral do seu negócio e dos próximos agendamentos.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge>Status: {statusLabel}</Badge>
              {tenant_setting.tone ? (
                <Badge>Tom: {tenant_setting.tone}</Badge>
              ) : null}
              {tenant_setting.handoff_mode ? (
                <Badge>Handoff: {tenant_setting.handoff_mode}</Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/app/simulator">Testar atendimento</Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/app/settings">Configurar bot</Link>
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Atendimentos hoje"
            value={conversationsToday}
            helper="Conversas iniciadas hoje"
            accent="green"
          />
          <MetricCard
            title="Agendamentos futuros"
            value={upcomingAppointments}
            helper="Próximos 30 dias"
            accent="orange"
          />
          <MetricCard
            title="Próximo horário"
            value={nextAppointmentAt ?? '—'}
            helper={
              nextAppointmentAt
                ? 'Próximo agendamento'
                : 'Nenhum agendamento futuro'
            }
            accent="purple"
          />
          <MetricCard
            title="Atendimento"
            value={statusLabel}
            helper="Modo atual do sistema"
            accent="blue"
          />
        </div>

        <div className="mt-8">
          <h3 className="text-lg font-semibold">Visão geral</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Acesso rápido à agenda, simulador e configurações do seu atendimento.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Agenda</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Veja próximos horários, cancele ou gerencie sua agenda.
                </p>
                <Button asChild variant="secondary">
                  <Link href="/app/agenda">Ver agenda</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Simulador</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Teste o atendimento com dados reais do seu tenant.
                </p>
                <Button asChild variant="secondary">
                  <Link href="/app/simulator">Abrir simulador</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Configurações</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Ajuste serviços, horários, equipe, tom e handoff.
                </p>
                <Button asChild variant="secondary">
                  <Link href="/app/settings">Abrir configurações</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {!hasAnyActivity ? (
          <Card className="mt-6 border-dashed shadow-sm">
            <CardContent className="flex flex-col gap-3 py-6">
              <div className="space-y-1">
                <p className="text-sm font-medium">Seu painel ainda está vazio.</p>
                <p className="text-sm text-muted-foreground">
                  Comece testando o atendimento no simulador. Quando você
                  confirmar um agendamento, ele vai aparecer automaticamente na
                  agenda.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild>
                  <Link href="/app/simulator">Testar atendimento</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/app/settings">Revisar configurações</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

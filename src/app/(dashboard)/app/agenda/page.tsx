'use client'

import * as React from 'react'
import type { Appointment } from '@/features/agenda/types'
import { WeekStrip } from '@/features/agenda/components/WeekStrip'
import { DayTimeline } from '@/features/agenda/components/DayTimeline'
import { UpcomingList } from '@/features/agenda/components/UpcomingList'
import { AppointmentDrawer } from '@/features/agenda/components/AppointmentDrawer'
import {
  addDays,
  dayKey,
  endOfWeek,
  formatDateLong,
  getWeekDays,
  groupAppointmentsByDay,
  startOfWeek,
  toISODate,
  parseISO,
  isSameISODate,
} from '@/features/agenda/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAgentContext } from '@/components/providers/AgentProvider'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

async function fetchAppointments(
  fromISO: string,
  toISO: string,
  agentId: string | null
): Promise<Appointment[]> {
  const params: Record<string, string> = { from: fromISO, to: toISO }
  if (agentId) params.agent_id = agentId
  const qs = new URLSearchParams(params)
  const res = await fetch(`/api/app/appointments?${qs.toString()}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error('failed')
  const json = await res.json()
  if (Array.isArray(json)) return json as Appointment[]
  if (Array.isArray((json as { items?: unknown }).items)) {
    return (json as { items: Appointment[] }).items
  }
  if (Array.isArray((json as { data?: unknown }).data)) {
    return (json as { data: Appointment[] }).data
  }
  return []
}

async function cancelAppointment(id: string): Promise<void> {
  const res = await fetch(`/api/app/appointments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  })
  if (!res.ok) throw new Error('cancel failed')
}

export default function AgendaPage() {
  const { activeAgentId } = useAgentContext()
  const [anchor, setAnchor] = React.useState(() => new Date())
  const [selectedDay, setSelectedDay] = React.useState(() => new Date())
  const [state, setState] = React.useState<LoadState>('idle')
  const [items, setItems] = React.useState<Appointment[]>([])
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [selectedAppt, setSelectedAppt] = React.useState<Appointment | null>(
    null
  )
  const [cancelling, setCancelling] = React.useState(false)

  const from = React.useMemo(() => startOfWeek(anchor, true), [anchor])
  const to = React.useMemo(() => endOfWeek(anchor, true), [anchor])
  const fromISO = React.useMemo(() => toISODate(from), [from])
  const toISO = React.useMemo(() => toISODate(to), [to])

  const grouped = React.useMemo(
    () => groupAppointmentsByDay(items),
    [items]
  )
  const dayItems =
    React.useMemo(
      () => grouped.get(dayKey(selectedDay)) ?? [],
      [grouped, selectedDay]
    )

  const upcoming = React.useMemo(() => {
    const now = Date.now()
    return items
      .filter(
        (a) =>
          parseISO(a.end_at).getTime() >= now && a.status !== 'cancelled'
      )
      .sort(
        (a, b) =>
          parseISO(a.start_at).getTime() - parseISO(b.start_at).getTime()
      )
  }, [items])

  const hasWeekData = items.length > 0

  const load = React.useCallback(async () => {
    if (activeAgentId == null) {
      setItems([])
      setState('ready')
      return
    }
    setState('loading')
    try {
      const data = await fetchAppointments(fromISO, toISO, activeAgentId)
      setItems(data)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [fromISO, toISO, activeAgentId])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    const weekDays = getWeekDays(anchor)
    const inWeek = weekDays.some((d) => isSameISODate(d, selectedDay))
    if (!inWeek) setSelectedDay(weekDays[0])
  }, [anchor, selectedDay])

  const onPrevWeek = () => setAnchor((d) => addDays(d, -7))
  const onNextWeek = () => setAnchor((d) => addDays(d, 7))
  const onToday = () => {
    const t = new Date()
    setAnchor(t)
    setSelectedDay(t)
  }

  const onSelectAppt = (appt: Appointment) => {
    setSelectedAppt(appt)
    setDrawerOpen(true)
  }

  const onCancel = async (id: string) => {
    try {
      setCancelling(true)
      await cancelAppointment(id)
      setItems((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'cancelled' as const } : a))
      )
      setSelectedAppt((prev) =>
        prev && prev.id === id
          ? { ...prev, status: 'cancelled' as const }
          : prev
      )
    } finally {
      setCancelling(false)
    }
  }

  if (activeAgentId == null) {
    return (
      <main className="min-h-[calc(100vh-3.5rem)] bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
          <Card className="rounded-2xl border-dashed border-border">
            <CardContent className="py-8">
              <p className="text-sm font-medium">Selecione um agente</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use o menu no topo para escolher o agente e ver a agenda.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold tracking-tight">Agenda</h2>
            <p className="text-sm text-muted-foreground">
              Visualize sua semana e toque em um agendamento para ver detalhes.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={load}
              disabled={state === 'loading'}
            >
              {state === 'loading' ? 'Atualizando...' : 'Atualizar'}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                alert('MVP: bloquear horário vem na próxima etapa')
              }
            >
              Bloquear horário
            </Button>
          </div>
        </div>

        <div className="mt-6">
          <WeekStrip
            value={selectedDay}
            onChange={(d) => setSelectedDay(d)}
            onPrevWeek={onPrevWeek}
            onNextWeek={onNextWeek}
            onToday={onToday}
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-start">
          <div className="min-w-0 space-y-0">
            {state === 'error' ? (
              <Card className="rounded-2xl border-dashed border-border">
                <CardContent className="py-8">
                  <p className="text-sm font-medium">
                    Não foi possível carregar sua agenda.
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Verifique a API /api/app/appointments e tente novamente.
                  </p>
                  <div className="mt-4">
                    <Button onClick={load}>Tentar novamente</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-2xl border border-border bg-muted/20 shadow-md overflow-hidden">
                <div className="flex items-center justify-between border-b border-border bg-background/60 px-4 py-3">
                  <div className="text-sm font-medium">
                    {formatDateLong(selectedDay)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dayItems.length} agendamento(s) neste dia
                  </div>
                </div>
                <DayTimeline
                  day={selectedDay}
                  items={dayItems}
                  onSelect={onSelectAppt}
                  embedded
                />
              </div>
            )}

            {!hasWeekData && state === 'ready' ? (
              <Card className="mt-6 rounded-2xl border-dashed border-border">
                <CardContent className="py-6">
                  <p className="text-sm font-medium">Sua semana está vazia.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Confirme um agendamento no simulador para ver aqui.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <div className="space-y-5 lg:sticky lg:top-6">
            <UpcomingList items={upcoming} onSelect={onSelectAppt} />
            <Card className="rounded-2xl shadow-sm border-border">
              <CardContent className="py-5 px-5 text-sm text-muted-foreground">
                Dica: no mobile, use os chips acima para trocar o dia.
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <AppointmentDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        appt={selectedAppt}
        onCancel={onCancel}
        cancelling={cancelling}
      />
    </main>
  )
}

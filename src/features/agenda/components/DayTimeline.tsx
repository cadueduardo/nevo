'use client'

import * as React from 'react'
import type { Appointment } from '../types'
import { AppointmentCard } from './AppointmentCard'
import {
  START_HOUR,
  END_HOUR,
  clamp,
  minutesBetween,
  minutesSinceStartHour,
  parseISO,
} from '../utils'
import { cn } from '@/lib/utils'

const PX_PER_MINUTE = 1.6

function hourLabel(h: number) {
  return `${String(h).padStart(2, '0')}:00`
}

export function DayTimeline({
  day,
  items,
  onSelect,
  embedded,
}: {
  day: Date
  items: Appointment[]
  onSelect: (appt: Appointment) => void
  /** Quando true, não renderiza o container externo (borda/rounded); para uso dentro de um wrapper único. */
  embedded?: boolean
}) {
  const totalMinutes = (END_HOUR - START_HOUR) * 60
  const heightPx = totalMinutes * PX_PER_MINUTE
  const isEmpty = items.length === 0

  const content = (
    <div className="relative overflow-hidden">
      <div
        className="relative overflow-y-auto bg-muted/20 pr-4"
        style={{ maxHeight: '70vh' }}
      >
        <div className="relative" style={{ height: heightPx }}>
            {Array.from(
              { length: END_HOUR - START_HOUR + 1 },
              (_, i) => START_HOUR + i
            ).map((h) => {
              const top = (h - START_HOUR) * 60 * PX_PER_MINUTE
              return (
                <div
                  key={h}
                  className="absolute left-0 right-0"
                  style={{ top }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-14 px-2 text-xs text-muted-foreground">
                      {hourLabel(h)}
                    </div>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                </div>
              )
            })}

            {items.map((appt) => {
              const s = parseISO(appt.start_at)
              const e = parseISO(appt.end_at)
              const startMin = minutesSinceStartHour(s)
              const durMin = minutesBetween(s, e)
              const top =
                clamp(startMin, 0, totalMinutes) * PX_PER_MINUTE
              const height =
                clamp(durMin, 18, totalMinutes) * PX_PER_MINUTE

              return (
                <AppointmentCard
                  key={appt.id}
                  appt={appt}
                  onClick={() => onSelect(appt)}
                  style={{ top, height }}
                />
              )
            })}

            <NowLine totalMinutes={totalMinutes} />

            {isEmpty && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                aria-live="polite"
              >
                <p className="text-sm text-muted-foreground bg-background/80 backdrop-blur-[1px] px-4 py-2 rounded-lg border border-border/50">
                  Nenhum agendamento neste dia
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  )

  if (embedded) return content
  return (
    <div className="rounded-2xl border border-border bg-muted/20 shadow-md">
      {content}
    </div>
  )
}

function NowLine({ totalMinutes }: { totalMinutes: number }) {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const h = now.getHours()
  if (h < START_HOUR || h > END_HOUR) return null

  const top =
    clamp(minutesSinceStartHour(now), 0, totalMinutes) * PX_PER_MINUTE

  return (
    <div
      className="absolute left-0 right-0 z-10"
      style={{ top }}
      aria-hidden
    >
      <div className="flex items-center gap-3">
        <div className="w-14 px-2 text-[10px] font-medium text-primary">
          agora
        </div>
        <div className={cn('h-0.5 flex-1 bg-primary shadow-sm')} />
      </div>
    </div>
  )
}

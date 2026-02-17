'use client'

import * as React from 'react'
import type { Appointment } from '../types'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatTime, parseISO } from '../utils'

function leftAccent(status: Appointment['status']) {
  if (status === 'cancelled') return 'bg-muted-foreground/30'
  if (status === 'rescheduled') return 'bg-primary/40'
  return 'bg-primary'
}

export function AppointmentCard({
  appt,
  style,
  onClick,
}: {
  appt: Appointment
  style?: React.CSSProperties
  onClick?: () => void
}) {
  const start = parseISO(appt.start_at)
  const end = parseISO(appt.end_at)
  const title = appt.service_names?.length ? appt.service_names.join(', ') : 'Agendamento'
  const subtitleParts = [
    `${formatTime(start)}–${formatTime(end)}`,
    appt.attendee_name ?? 'Cliente',
    appt.staff_name ?? null,
  ].filter(Boolean)

  return (
    <Card
      onClick={onClick}
      role="button"
      style={style}
      className={cn(
        'absolute left-[4rem] right-4 min-w-0 max-w-[calc(100%-4rem-1rem)] cursor-pointer select-none rounded-2xl border-border shadow-sm transition hover:shadow-md'
      )}
    >
      <div className="flex h-full min-w-0 overflow-hidden rounded-2xl">
        <div className={cn('w-1.5 shrink-0', leftAccent(appt.status))} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 overflow-hidden px-3 py-2.5">
          <div
            className={cn(
              'truncate text-sm font-semibold leading-tight',
              appt.status === 'cancelled' && 'line-through text-muted-foreground'
            )}
            title={title}
          >
            {title}
          </div>
          <div
            className="truncate text-xs text-muted-foreground"
            title={subtitleParts.join(' · ')}
          >
            {subtitleParts.join(' · ')}
          </div>
        </div>
      </div>
    </Card>
  )
}

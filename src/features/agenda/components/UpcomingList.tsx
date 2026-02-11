'use client'

import * as React from 'react'
import type { Appointment } from '../types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatTime, parseISO } from '../utils'
import { cn } from '@/lib/utils'

export function UpcomingList({
  items,
  onSelect,
}: {
  items: Appointment[]
  onSelect: (appt: Appointment) => void
}) {
  return (
    <Card className="rounded-2xl shadow-sm border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Próximos agendamentos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-1 px-5 pb-6">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum agendamento nos próximos dias.
          </p>
        ) : (
          items.slice(0, 8).map((a) => {
            const s = parseISO(a.start_at)
            const title = a.service_names?.[0] ?? 'Agendamento'
            const sub = [
              formatTime(s),
              a.attendee_name ?? 'Cliente',
              a.staff_name ?? null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelect(a)}
                className={cn(
                  'w-full rounded-xl border border-border p-4 text-left transition hover:bg-muted/40'
                )}
              >
                <div
                  className={cn(
                    'text-sm font-semibold',
                    a.status === 'cancelled' &&
                      'line-through text-muted-foreground'
                  )}
                >
                  {title}
                </div>
                <div className="text-xs text-muted-foreground">{sub}</div>
              </button>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

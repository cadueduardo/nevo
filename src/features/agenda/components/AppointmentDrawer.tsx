'use client'

import * as React from 'react'
import type { Appointment } from '../types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDateLong, formatTime, parseISO } from '../utils'

function statusLabel(s: Appointment['status']) {
  if (s === 'confirmed') return 'Confirmado'
  if (s === 'cancelled') return 'Cancelado'
  return 'Remarcado'
}

export function AppointmentDrawer({
  open,
  onOpenChange,
  appt,
  onCancel,
  cancelling,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  appt: Appointment | null
  onCancel: (id: string) => Promise<void>
  cancelling?: boolean
}) {
  if (!appt) return null

  const start = parseISO(appt.start_at)
  const end = parseISO(appt.end_at)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="mx-auto max-w-2xl">
        <SheetHeader>
          <SheetTitle className="text-lg">
            {appt.service_names?.[0] ?? 'Agendamento'}
          </SheetTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="secondary">{statusLabel(appt.status)}</Badge>
            {appt.staff_name ? (
              <Badge variant="outline">
                Profissional: {appt.staff_name}
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
            <div>{formatDateLong(start)}</div>
            <div>
              {formatTime(start)} – {formatTime(end)}
            </div>
            <div>Cliente: {appt.attendee_name ?? '—'}</div>
            <div>Serviços: {appt.service_names?.join(', ') || '—'}</div>
          </div>
        </SheetHeader>

        <SheetFooter className="gap-2">
          <SheetClose asChild>
            <Button variant="outline">Fechar</Button>
          </SheetClose>
          <Button
            disabled={appt.status === 'cancelled' || cancelling}
            onClick={() => onCancel(appt.id)}
          >
            {appt.status === 'cancelled'
              ? 'Já cancelado'
              : cancelling
                ? 'Cancelando...'
                : 'Cancelar agendamento'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

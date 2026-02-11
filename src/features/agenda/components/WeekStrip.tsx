'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  formatDayChip,
  formatWeekLabel,
  getWeekDays,
  endOfWeek,
  startOfWeek,
} from '../utils'

export function WeekStrip({
  value,
  onChange,
  onPrevWeek,
  onNextWeek,
  onToday,
}: {
  value: Date
  onChange: (d: Date) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
}) {
  const days = React.useMemo(() => getWeekDays(value), [value])
  const from = startOfWeek(value, true)
  const to = endOfWeek(value, true)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-muted-foreground">
          {formatWeekLabel(from, to)}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPrevWeek}>
            ←
          </Button>
          <Button variant="outline" size="sm" onClick={onToday}>
            Hoje
          </Button>
          <Button variant="outline" size="sm" onClick={onNextWeek}>
            →
          </Button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d) => {
          const { weekday, day } = formatDayChip(d)
          const active = d.toDateString() === value.toDateString()
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onChange(d)}
              className={cn(
                'shrink-0 rounded-2xl border px-3 py-2 text-left transition min-w-[74px]',
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-muted/70 hover:bg-muted text-foreground'
              )}
            >
              <div
                className={cn(
                  'text-xs',
                  active ? 'text-primary-foreground/90' : 'text-muted-foreground'
                )}
              >
                {weekday}
              </div>
              <div
                className={cn(
                  'text-base font-semibold',
                  active ? 'text-primary-foreground' : 'text-foreground'
                )}
              >
                {day}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

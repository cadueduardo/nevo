// @ts-nocheck
/** Contexto compartilhado dos handlers de agendamento. Preenchido pelo orquestrador. */
import type { SimulatorConfig, SimulatorState, SimulatorResult } from "../types.ts"

export interface BookingContext {
  config: SimulatorConfig
  text: string
  state: SimulatorState
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  /** Opções numeradas "1 - X", "2 - Y"... */
  toNumberedOptions: (options: string[]) => string[]
  /** Opções de dia (ex.: Segunda, Terça) ou ["Outro dia"]. */
  getOtherDayOptions: (schedule?: { days_of_week?: string[] } | null) => string[]
  contactOk: boolean
  bookingComplete: boolean
  /** Preenchido pelo orquestrador antes de rodar os handlers (interpretação IA). */
  slotsInterpretation?: {
    service?: string
    date?: string
    time?: string
    attendee_name?: string
    relationship?: string
    relationship_only?: boolean
    needs_availability_check?: boolean
  } | null
  interpretedAdditional?: { has_additional?: boolean; count?: number } | null
  interpretedCount: number | null
  interpretedHasAdditional: boolean
  lastAssistantMsg?: string
  waitingFor?: "attendee_name" | "service" | "date" | "time"
  normalizedText: string
  allowAiDateAutofill: boolean
  isDigitOnly: boolean
  explicitService: string | null
  wasAdditionalPending: boolean
  hasCompletedBooking: boolean
}

export type BookingHandler = (ctx: BookingContext) => Promise<SimulatorResult | null>

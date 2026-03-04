// @ts-nocheck
/** Handlers de agendamento em ordem de execução. Ordem é relevante: primeiro handler que retornar não nulo encerra. */
export type { BookingContext, BookingHandler } from "./context.ts"
export { handleConfirmation } from "./confirmation.ts"
export { handleAiSlots } from "./ai-slots.ts"
export { handleService } from "./service.ts"
export { handleStaffAndDate } from "./staff-and-date.ts"
export { handleContact } from "./contact.ts"
export { handleTimeAndAvailability } from "./time-and-availability.ts"
export { handleFinalization } from "./finalization.ts"

import type { BookingHandler } from "./context.ts"
import { handleConfirmation } from "./confirmation.ts"
import { handleAiSlots } from "./ai-slots.ts"
import { handleService } from "./service.ts"
import { handleStaffAndDate } from "./staff-and-date.ts"
import { handleContact } from "./contact.ts"
import { handleTimeAndAvailability } from "./time-and-availability.ts"
import { handleFinalization } from "./finalization.ts"

/** Ordem dos handlers: confirmação → IA → serviço → staff/data → contato → horário/disponibilidade → finalização. */
export const BOOKING_HANDLERS: BookingHandler[] = [
  handleConfirmation,
  handleAiSlots,
  handleService,
  handleStaffAndDate,
  handleContact,
  handleTimeAndAvailability,
  handleFinalization,
]

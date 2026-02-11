/**
 * Tipos da feature agenda. Reutilizados pela página e pelos componentes.
 */
export type AppointmentStatus = 'confirmed' | 'cancelled' | 'rescheduled'

export type Appointment = {
  id: string
  attendee_name: string | null
  staff_name: string | null
  service_names: string[]
  start_at: string
  end_at: string
  status: AppointmentStatus
  created_at?: string
}

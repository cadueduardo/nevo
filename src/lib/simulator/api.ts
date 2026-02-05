export interface SimulatorRequest {
  session_id: string
  conversation_id?: string
  message: string
  channel?: 'web_simulator'
  context?: {
    business_name?: string
    business_type?: string
    context_mode?: 'booking' | 'quote' | 'both'
    tone?: 'formal' | 'amigavel' | 'profissional' | 'engracado'
    services?: Array<{ name: string; duration_minutes?: number }>
    schedule?: {
      days_of_week?: string[]
      start_time?: string
      end_time?: string
      breaks?: Array<{ start: string; end: string }>
      interval_minutes?: number
    }
    staff?: Array<{
      name: string
      use_business_schedule?: boolean
      schedule?: {
        days_of_week?: string[]
        start_time?: string
        end_time?: string
        breaks?: Array<{ start: string; end: string }>
        interval_minutes?: number
      }
    }>
    dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
    lead_policy?: {
      reject_unlisted_services?: boolean
      rejection_message?: string
      use_ai_matching?: boolean
      min_confidence?: number
    }
  }
}

export interface SimulatorResponse {
  conversation_id: string
  messages: Array<{
    role: 'assistant'
    content: string
    created_at: string
    action_options?: string[]
  }>
}

export async function sendSimulatorMessage(payload: SimulatorRequest): Promise<SimulatorResponse> {
  const response = await fetch('/api/conversations-turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Erro ao processar simulacao')
  }

  return response.json()
}

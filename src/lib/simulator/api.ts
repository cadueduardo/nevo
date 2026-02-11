export interface SimulatorRequest {
  session_id: string
  conversation_id?: string
  message: string
  channel?: 'web_simulator'
  context?: {
    business_name?: string
    business_type?: string
    context_mode?: 'booking' | 'quote' | 'both'
    establishment_address?: {
      cep?: string
      logradouro: string
      numero: string
      complemento?: string
      bairro: string
      localidade: string
      uf: string
    }
    tone?: 'formal' | 'amigavel' | 'profissional' | 'engracado'
    services?: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
    when_client_asks_price_no_value?: 'handoff' | 'offer_handoff_or_booking'
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
    /** Datas de feriados em que o estabelecimento atende (YYYY-MM-DD). Se vazio, nao atende em feriados. */
    holidays_attend?: string[]
    /** Periodos de fechamento (ferias). */
    closure_periods?: Array<{ start: string; end: string; reason?: string }>
    /** Cliente pode agendar vários serviços em sequência na mesma visita. */
    allow_sequence_booking?: boolean
    /** Serviços que podem ser combinados em sequência (quando allow_sequence_booking). */
    sequence_eligible_services?: string[]
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

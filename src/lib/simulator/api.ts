export interface SimulatorRequest {
  session_id: string
  conversation_id?: string
  message: string
  channel?: 'web_simulator'
  /**
   * Onboarding: true = não grava conversa no banco; estado no cliente (sessionStorage).
   * Painel (/api/app/simulator) não envia — continua persistindo na conta.
   */
  simulation_local?: boolean
  onboarding_session_id?: string
  simulator_state?: Record<string, unknown>
  simulator_history?: Array<{ role: string; content: string }>
  /** Modo do actor: internal = dono/admin; external = cliente. Simulador do onboarding envia internal. */
  mode?: 'internal' | 'external'
  /** Tipo do actor. Simulador do onboarding envia owner (quem testa é o dono). */
  actor_type?: 'owner' | 'admin' | 'agent' | 'client' | 'unknown'
  /** tenant_id e agent_id do migrate; garantem que intents internas (agenda, orçamento) usem o agente correto. */
  tenant_id?: string
  agent_id?: string
  context?: {
    business_name?: string
    business_type?: string
    business_profile?: {
      business_name?: string
      business_type?: string
      services?: Array<{
        name: string
        description?: string
        duration_minutes?: number
        base_price?: number
        bookable?: boolean
        catalog_visible?: boolean
        sequence_eligible?: boolean
      }>
    }
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
    faq?: Array<{ question?: string; answer?: string }>
    tone?: 'formal' | 'amigavel' | 'profissional' | 'engracado'
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
    target_audience?: {
      mode?: 'all' | 'women_only' | 'men_only' | 'kids_only' | 'custom'
      modes?: ('all' | 'women_only' | 'men_only' | 'kids_only' | 'custom')[]
      note?: string
    }
    interaction_style?: 'numbered_options' | 'conversational' | 'hybrid'
  }
}

export interface SimulatorResponse {
  conversation_id: string
  messages: Array<{
    role: 'assistant'
    content: string
    created_at: string
    action_options?: string[]
    /** Quando true, exibir action_options como multi-select (checkboxes) para escolher mais de um serviço em sequência. */
    service_multi_select?: boolean
  }>
  /** Preenchido quando simulation_local: true — guardar e reenviar no próximo turno. */
  simulator_state?: Record<string, unknown>
  simulation_local?: boolean
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

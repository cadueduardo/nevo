// @ts-nocheck
/** Tipos compartilhados do simulador de atendimento. */

export type SimulatorContextMode = "booking" | "quote" | "both"

export interface EstablishmentAddress {
  cep?: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  localidade: string
  uf: string
}

export interface LeadPolicyConfig {
  reject_unlisted_services?: boolean
  rejection_message?: string
  use_ai_matching?: boolean
  min_confidence?: number
}

export interface SimulatorQuoteService {
  id: string
  agent_id?: string
  name: string
  pricing_type: string
  variables_schema: unknown[]
  pricing_rules: Record<string, unknown>
  external_variable_keys?: string[]
  keywords?: string[]
  active?: boolean
}

export interface SimulatorBusinessProfileService {
  name: string
  description?: string
  duration_minutes?: number
  base_price?: number
  bookable?: boolean
  catalog_visible?: boolean
  sequence_eligible?: boolean
}

export interface SimulatorBusinessProfile {
  business_name?: string
  business_type?: string
  services?: SimulatorBusinessProfileService[]
}

export interface SimulatorConfig {
  business_name?: string
  business_type?: string
  business_profile?: SimulatorBusinessProfile
  context_mode?: SimulatorContextMode
  establishment_address?: EstablishmentAddress
  faq?: Array<{ question?: string; answer?: string }>
  tone?: "formal" | "amigavel" | "profissional" | "engracado"
  /** @deprecated Compat temporária durante migração para business_profile.services. */
  catalog_services?: Array<{ name: string; description?: string }>
  /** @deprecated Compat temporária durante migração para business_profile.services. */
  booking_services?: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
  /** @deprecated Compat temporária durante migração para business_profile.services. */
  services?: Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>
  when_client_asks_price_no_value?: "handoff" | "offer_handoff_or_booking"
  schedule?: {
    days_of_week?: string[]
    start_time?: string
    end_time?: string
    breaks?: Array<{ start: string; end: string }>
    interval_minutes?: number
    min_booking_lead_minutes?: number
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
      min_booking_lead_minutes?: number
    }
  }>
  dynamic_variables?: Array<{ key: string; label: string; type: string; context?: string }>
  lead_policy?: LeadPolicyConfig
  /** Datas de feriados em que o estabelecimento atende (YYYY-MM-DD). Se vazio, nao atende em feriados. */
  holidays_attend?: string[]
  /** Periodos de fechamento (ferias, etc.). */
  closure_periods?: Array<{ start: string; end: string; reason?: string }>
  /** Cliente pode agendar varios servicos em sequencia na mesma visita. */
  allow_sequence_booking?: boolean
  /** Servicos que podem ser combinados em sequencia (quando allow_sequence_booking). */
  sequence_eligible_services?: string[]
  target_audience?: {
    mode?: "all" | "women_only" | "men_only" | "kids_only" | "custom"
    modes?: ("all" | "women_only" | "men_only" | "kids_only" | "custom")[]
    note?: string
    /** Idade mínima em anos para público infantil (0 = qualquer idade). */
    kids_age_min?: number
  }
  interaction_style?: "numbered_options" | "conversational" | "hybrid"
  /** Branding para PDF de orçamento (logo, razão social, etc.). */
  branding?: {
    enabled?: boolean
    logo_url?: string
    company_legal_name?: string
    cnpj?: string
    company_phone?: string
    company_email?: string
  }
  quote_services?: SimulatorQuoteService[]
}

export interface SimulatorState {
  mode?: "booking" | "quote"
  step?: "ask_mode" | "booking" | "quote" | "quote_free_text" | "qualification" | "qualification_rejected"
  just_identified_service?: boolean
  pending_quote_key?: string
  pending_suggested_time?: string
  pending_date_confirmation?: string
  pending_additional_booking?: boolean
  pending_additional_count?: number
  pending_attendee_name?: boolean
  pending_attendee_queue?: string[]
  pending_template_choice?: boolean
  pending_cancel_selection?: boolean
  pending_cancel_confirm?: boolean
  pending_cancel_reason?: boolean
  pending_cancel_reason_custom?: boolean
  pending_cancel_reschedule?: boolean
  cancel_target_id?: string
  cancel_reason?: string
  cancel_candidates?: Array<{
    id: string
    attendee_name?: string
    staff_name?: string
    service_names?: string[]
    start_at?: string
    status?: string
  }>
  cancel_target_snapshot?: {
    id: string
    attendee_name?: string
    staff_name?: string
    service_names?: string[]
    start_at?: string
    status?: string
  }
  /** Segundo agendamento: após "mesmo dia e colaborador", esperando cliente escolher serviço. */
  pending_second_service_choice?: boolean
  pending_default_service?: string
  pending_default_service_locked?: boolean
  expected_additional_count?: number
  pending_final_confirmation?: boolean
  pending_calendar_offer?: boolean
  /** True quando a última mensagem foi pedindo confirmação de público (para reconhecer "sim" na volta). */
  pending_audience_confirmation?: boolean
  /** True após o usuário confirmar que se encaixa no público-alvo; evita re-perguntar em loop. */
  audience_confirmed?: boolean
  /** Quando existe 2º agendamento, pergunta se deve avisar a 2ª pessoa e coleta o telefone. */
  pending_secondary_contact?: {
    attendee_name?: string
    service?: string
    date?: string
    time?: string
  }
  /** WhatsApp: aguardando confirmar se pode usar o número do remetente como contato principal. */
  pending_primary_phone_confirmation?: boolean
  /** WhatsApp: número candidato (dígitos) do remetente. */
  primary_phone_candidate?: string
  final_thanks_sent?: boolean
  completed_bookings?: Array<{
    attendee_name?: string
    service?: string
    duration_minutes?: number
    date?: string
    time?: string
    staff_name?: string
    customer_phone?: string
    customer_email?: string
    contact_delivery?: "own" | "primary"
  }>
  outgoing_assistant_messages?: Array<{
    content: string
    action_options?: string[]
    service_multi_select?: boolean
  }>
  outbound_notifications?: Array<{
    phone: string
    content: string
  }>
  last_booking?: { attendee_name?: string; service?: string; date?: string; time?: string; staff_name?: string }
  pending_contact_field?: "name" | "phone" | "email" | "contact_preference"
  contact_preference?: "phone" | "email" | "both" | "skip_primary"
  last_prompt?: string
  last_time_options?: string[]
  last_time_options_date?: string
  last_time_options_staff?: string
  /** Últimas opções de template exibidas (para resolver "1", "2" por número). */
  last_template_options?: string[]
  /** Últimas opções de confirmação (ex: "1 - Sim, 15:30"). Resposta "1" = confirmar. */
  last_confirm_options?: string[]
  /** Últimas opções de serviço (para resolver "1", "2" por número). */
  last_service_options?: string[]
  /** Quando true, o cliente pode exibir os last_service_options como multi-select (checkboxes) para agendar mais de um serviço em sequência. */
  service_selection_multi?: boolean
  /** Últimas opções exibidas no turno (fallback genérico para resolver respostas numéricas como "1 - Quero agendar"). */
  last_action_options?: string[]
  booked_slots?: Record<string, Record<string, string[]>>
  /** Agendamento aguardando confirmação (create_appointment_internal). */
  appointment_pending?: {
    date: string
    time: string
    service_name: string
    attendee_name: string
    duration_minutes: number
  }
  /** Orçamento calculado aguardando confirmação para gerar PDF (FASE 4). */
  quote_pending?: {
    service_id: string
    service_name: string
    slots: Record<string, unknown>
    result: { service_name: string; total: number; currency: string; breakdown?: { label: string; value: number }[] }
  }
  slots: {
    staff_name?: string
    attendee_name?: string
    service?: string
    date?: string
    time?: string
    time_period?: "morning" | "afternoon" | "evening"
    customer_name?: string
    customer_phone?: string
    customer_email?: string
    quote_answers?: Record<string, string>
  }
}

export interface SimulatorResult {
  message: string
  state: SimulatorState
  action_options?: string[]
  render_hints?: {
    service_multi_select?: boolean
  }
}

export interface ConversationTurnRequest {
  session_id: string
  conversation_id?: string
  message: string
  /** Obrigatório para conversation/channel (NOT NULL). Quando ausente, a Edge Function usa o primeiro agente do tenant. */
  agent_id?: string
  /** Canal: web_simulator (session_id = identificador do simulador) ou whatsapp (from = número do WhatsApp). */
  channel?: "web_simulator" | "whatsapp"
  /** Para channel=whatsapp: número do remetente (ex: whatsapp:+5511999999999). Usado como session_id/contact external_id. */
  from?: string
  /** Nome de exibição do remetente (ex: pushName do WhatsApp). Usado para evitar que a IA confunda quem agenda com quem recebe o serviço. */
  sender_display_name?: string
  context?: {
    business_name?: string
    business_type?: string
    business_profile?: SimulatorBusinessProfile
    context_mode?: "booking" | "quote" | "both"
    establishment_address?: EstablishmentAddress
    faq?: Array<{ question?: string; answer?: string }>
    tone?: "formal" | "amigavel" | "profissional" | "engracado"
    when_client_asks_price_no_value?: "handoff" | "offer_handoff_or_booking"
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
    holidays_attend?: string[]
    closure_periods?: Array<{ start: string; end: string; reason?: string }>
    allow_sequence_booking?: boolean
    sequence_eligible_services?: string[]
    target_audience?: {
      mode?: "all" | "women_only" | "men_only" | "kids_only" | "custom"
      note?: string
    }
    interaction_style?: "numbered_options" | "conversational" | "hybrid"
    quote_services?: SimulatorQuoteService[]
  }
}

export interface ConversationTurnResponse {
  conversation_id: string
  messages: Array<{
    role: "assistant"
    content: string
    created_at: string
    action_options?: string[]
    /** Quando true, o cliente (simulador/WhatsApp) deve exibir action_options como multi-select (checkboxes) para escolher mais de um serviço em sequência. */
    service_multi_select?: boolean
  }>
  outbound_notifications?: Array<{
    phone: string
    content: string
  }>
}

export interface FlowOrchestratorOutput {
  intent: "price_inquiry" | "booking_intent" | "list_services" | "clarification" | "no_match" | "service_detail"
  inferred_service?: string
  inferred_attendees?: "single" | "multiple" | "other_person"
  suggested_action: "answer_price" | "start_booking" | "list_services" | "ask_clarification" | "no_match_fallback" | "service_detail"
  clarification_question?: string
  confidence: number
}

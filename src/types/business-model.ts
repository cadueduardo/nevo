// Business Model - Estrutura completa de configuração do tenant

export interface Service {
  id: string
  name: string
  duration_minutes?: number
  base_price?: number
  description?: string
  variations?: string[]
}

export interface ServiceArea {
  region: string
  coverage?: string
  travel_fee?: number
  distance_limit_km?: number
}

/** Endereço do estabelecimento (ponto fixo). */
export interface EstablishmentAddress {
  cep: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  localidade: string
  uf: string
}

/** Modo de localização: ponto fixo ou atendimento no local do cliente. */
export type LocationMode = 'fixed' | 'mobile'

export interface ScheduleBreak {
  start: string // HH:mm
  end: string // HH:mm
}

export interface Schedule {
  days_of_week: string[] // ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  start_time: string // HH:mm
  end_time: string // HH:mm
  breaks?: ScheduleBreak[]
  interval_minutes: number // intervalo entre atendimentos
  /** Antecedência mínima em minutos para agendamento (buffer antes do horário). */
  min_booking_lead_minutes?: number
  capacity_per_slot?: number
}

export interface Policies {
  cancellation_hours?: number
  deposit_percentage?: number
  deposit_rules?: string
  refund_policy?: string
}

export interface DynamicVariable {
  key: string // snake_case
  label: string
  type: 'text' | 'number' | 'enum' | 'date' | 'time' | 'location'
  required: boolean
  options?: string[] // para enum
  validation?: {
    min?: number
    max?: number
    regex?: string
  }
  context: 'quote' | 'booking' | 'qualification' | 'other'
}

export interface FAQ {
  question: string
  answer: string
  category?: 'services' | 'pricing' | 'policies' | 'general'
}

export type TargetAudienceMode = 'all' | 'women_only' | 'men_only' | 'kids_only' | 'custom'

export interface TargetAudience {
  /** @deprecated Prefer modes[]. Single mode (backward compat). */
  mode?: TargetAudienceMode
  /** Múltiplos tipos de público (ex.: masculino + infantil). Vazio ou ausente = todos. */
  modes?: TargetAudienceMode[]
  note?: string
  /** Idade mínima em anos para atender crianças (ex.: 8 = a partir de 8 anos). Omitir ou 0 = qualquer idade. */
  kids_age_min?: number
  /** Idade máxima em anos considerada "infantil" (opcional). */
  kids_age_max?: number
}

export type InteractionStyle = 'numbered_options' | 'conversational' | 'hybrid'

export interface BusinessModel {
  // Básico
  business_type: string
  business_name: string
  
  // Serviços
  services: Service[]
  
  // Localização: ponto fixo ou atendimento no local do cliente
  location_mode?: LocationMode
  /** Endereço completo (quando location_mode = 'fixed'). */
  establishment_address?: EstablishmentAddress
  /** Regiões atendidas (quando location_mode = 'mobile'). */
  service_area?: ServiceArea
  
  // Agenda
  schedule: Schedule
  
  // Políticas
  policies?: Policies
  
  // Variáveis dinâmicas (para orçamentos, qualificações, etc.)
  dynamic_variables?: DynamicVariable[]
  
  // Perguntas de qualificação
  qualification_questions?: string[]
  
  // FAQ / Base de conhecimento
  faq?: FAQ[]
  
  // Tom de voz
  tone_of_voice: 'formal' | 'friendly' | 'professional' | 'funny'
  
  // Modo de decisão
  handoff_mode: 'always' | 'conditional' | 'never'
  target_audience?: TargetAudience
  interaction_style?: InteractionStyle
  
  // Contexto identificado
  context?: 'booking' | 'quote' | 'both'
}

// Estado do onboarding
export interface OnboardingState {
  current_step: string
  collected_data: Partial<BusinessModel>
  missing_fields: string[]
  context?: 'booking' | 'quote' | 'both'
}

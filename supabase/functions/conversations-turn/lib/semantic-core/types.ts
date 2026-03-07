// @ts-nocheck
import type { EstablishmentAddress, SimulatorConfig, SimulatorState } from "../types.ts"

export type AudienceMode = "all" | "women_only" | "men_only" | "kids_only" | "custom"

export type SemanticPrimaryIntent =
  | "greeting"
  | "identity"
  | "faq"
  | "price"
  | "service_detail"
  | "service_list"
  | "booking"
  | "booking_sequence"
  | "cancellation"
  | "quote"
  | "closing"
  | "fallback"

export type SemanticSecondaryIntent =
  | "booking_with_faq"
  | "booking_with_price"
  | "availability_check"
  | "audience_confirmation"
  | "calendar_request"

export type SemanticChannel = "web_simulator" | "whatsapp"

export interface BusinessBrainService {
  id?: string
  name: string
  normalized_name: string
  description?: string
  duration_minutes?: number
  base_price?: number
  sequence_eligible?: boolean
}

export interface BusinessBrainStaffSchedule {
  days_of_week?: string[]
  start_time?: string
  end_time?: string
  breaks?: Array<{ start: string; end: string }>
  interval_minutes?: number
  min_booking_lead_minutes?: number
}

export interface BusinessBrainStaffMember {
  name: string
  normalized_name: string
  use_business_schedule?: boolean
  schedule?: BusinessBrainStaffSchedule
}

export interface BusinessBrainAudience {
  modes: AudienceMode[]
  note?: string
  kids_age_min?: number
}

export interface BusinessBrainPolicies {
  reject_unlisted_services?: boolean
  sequence_enabled: boolean
  interaction_style: "numbered_options" | "conversational" | "hybrid"
}

export interface BusinessBrain {
  business_name?: string
  business_type?: string
  tone?: SimulatorConfig["tone"]
  address?: EstablishmentAddress
  faq: Array<{ question: string; answer: string }>
  services: BusinessBrainService[]
  staff: BusinessBrainStaffMember[]
  audience: BusinessBrainAudience
  policies: BusinessBrainPolicies
  schedule?: BusinessBrainStaffSchedule
  holidays_attend?: string[]
  closure_periods?: Array<{ start: string; end: string; reason?: string }>
  raw_config: SimulatorConfig
}

export interface SemanticPersonCandidate {
  name?: string
  relation?: string
  includes_self?: boolean
  audience_hint?: "man" | "woman" | "child" | "unknown"
  confidence?: number
}

export interface SemanticServiceCandidate {
  name: string
  normalized_name: string
  confidence?: number
}

export interface SemanticDateCandidate {
  raw_text?: string
  iso_date?: string
  weekday?: string
  confidence?: number
}

export interface SemanticTimeCandidate {
  raw_text?: string
  hhmm?: string
  confidence?: number
}

export interface SemanticAudienceRisk {
  requires_confirmation: boolean
  blocked?: boolean
  reason?: string
  prompt?: string
  inferred_fit?: boolean | null
}

export interface SemanticIntentsSnapshot {
  primary: SemanticPrimaryIntent
  secondary: SemanticSecondaryIntent[]
  booking: boolean
  confidence: number
}

export interface SemanticEntitiesSnapshot {
  people: SemanticPersonCandidate[]
  attendee_names: string[]
  services: SemanticServiceCandidate[]
  date?: SemanticDateCandidate | null
  time?: SemanticTimeCandidate | null
}

export interface SemanticSignalsSnapshot {
  includes_self: boolean
  additional_count: number
  sequence_request?: boolean
  availability_check?: boolean
  next_question_hint?: string
}

export interface SemanticRisksSnapshot {
  audience?: SemanticAudienceRisk
  ambiguities: string[]
}

export interface SemanticMetaSnapshot {
  raw_user_message: string
}

export interface TurnSemanticSnapshot {
  intents: SemanticIntentsSnapshot
  entities: SemanticEntitiesSnapshot
  signals: SemanticSignalsSnapshot
  risks: SemanticRisksSnapshot
  meta: SemanticMetaSnapshot
}

export type SemanticDecisionAction =
  | "ask_clarification"
  | "reply_greeting"
  | "reply_identity"
  | "reply_faq"
  | "reply_price"
  | "reply_service_detail"
  | "reply_service_list"
  | "enter_booking"
  | "ask_audience_confirmation"
  | "ask_attendee_name"
  | "ask_service"
  | "ask_date"
  | "ask_time"
  | "ask_contact"
  | "offer_sequence_template"
  | "confirm_booking"
  | "offer_calendar"
  | "handoff_fallback"

export interface SemanticDecisionResult {
  action: SemanticDecisionAction
  reason: string
  confidence: number
  slot_updates?: Partial<SimulatorState["slots"]>
  semantic_people_queue?: string[]
  action_options?: string[]
  next_question?: string
  channel_hints?: {
    prefer_numbered_options?: boolean
    prefer_multi_select?: boolean
  }
}

export interface SemanticPolicyOutcome {
  should_clarify: boolean
  clarification_reason?: string
  clarification_prompt?: string
  adjusted_snapshot: TurnSemanticSnapshot
}

export interface SemanticCompletedBookingDraft {
  attendee_name?: string
  service?: string
  service_names: string[]
  duration_minutes?: number
  date?: string
  time?: string
  staff_name?: string
  customer_phone?: string
  customer_email?: string
  contact_delivery?: "own" | "primary"
}

export interface SemanticPostConfirmationPlan {
  has_more_people: boolean
  next_attendee_name?: string
  remaining_queue: string[]
  expected_total_people?: number
  completed_count_after_confirmation: number
  next_action_options?: string[]
  should_offer_sequence_template?: boolean
  suggested_next_date?: string
  suggested_next_time?: string
  suggested_next_staff_name?: string
  should_offer_calendar?: boolean
  outbound_notifications?: SemanticOutboundNotificationDraft[]
  calendar_targets?: string[]
}

export interface SemanticOutboundNotificationDraft {
  attendee_name?: string
  phone?: string
  content?: string
}

export interface SemanticExecutorResult {
  executor: string
  state_patch?: Partial<SimulatorState>
  slot_updates?: Partial<SimulatorState["slots"]>
  action_options?: string[]
  prompt_key: string
  metadata?: Record<string, unknown>
}

export interface SemanticTurnContext {
  channel: SemanticChannel
  sender_display_name?: string
  history: Array<{ role: string; content: string }>
  state: SimulatorState
  business_brain: BusinessBrain
}

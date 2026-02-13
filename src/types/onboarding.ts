export type OnboardingStep =
  | 'welcome'
  | 'domain_detection'
  | 'domain_confirmation'
  | 'business_type'
  | 'business_name'
  | 'context'
  | 'services_list'
  | 'schedule_days'
  | 'schedule_time'
  | 'schedule_breaks'
  | 'schedule_interval'
  | 'schedule_interval_custom'
  | 'min_booking_lead'
  | 'services_duration'
  | 'services_pricing'
  | 'staff_mode'
  | 'staff_list'
  | 'staff_schedule_mode'
  | 'staff_schedule_days'
  | 'staff_schedule_time'
  | 'staff_schedule_interval'
  | 'staff_schedule_interval_custom'
  | 'service_area'
  | 'policies'
  | 'tone_of_voice'
  | 'handoff_mode'
  | 'faq_offer'
  | 'faq_question'
  | 'faq_more'
  | 'what_serves'
  | 'what_not_serves'
  | 'decision_mode'
  | 'tone'
  | 'summary'
  | 'summary_confirmation'
  | 'signup_request'
  | 'signup_email'
  | 'signup_password'
  | 'signup_confirm_password'
  | 'signup_google'
  | 'completed'

export interface OnboardingSession {
  id: string
  session_id: string
  collected_data: Record<string, any>
  current_step_key: OnboardingStep
  domain_suggested?: string
  domain_confirmed?: string
  expires_at: string
  created_at: string
  updated_at: string
}

export interface OnboardingMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  metadata?: Record<string, any>
  created_at: string
}

export interface VisitorState {
  sessionId: string
  isAuthenticated: false
  onboarding: {
    stepKey: OnboardingStep
    collected: Record<string, any>
    domainSuggested?: string
    domainConfirmed?: string
  }
}

export interface AuthState {
  isAuthenticated: true
  userId: string
  tenantId: string
}

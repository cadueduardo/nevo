export type OnboardingStep =
  | 'welcome'
  | 'domain_detection'
  | 'domain_confirmation'
  | 'business_name'
  | 'what_serves'
  | 'what_not_serves'
  | 'decision_mode'
  | 'tone'
  | 'summary'
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

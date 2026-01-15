'use client'

interface OnboardingRequest {
  session_id: string
  message: string
  current_step?: string
}

export interface EditableItem {
  id: string
  label: string
  value: string
  type: 'service' | 'faq' | 'variable'
}

export interface SelectableOption {
  id: string
  label: string
  value: string
  selected?: boolean
}

interface OnboardingResponse {
  assistant_message: string
  next_step: string
  extracted_data?: Record<string, any>
  requires_action?: 'domain_confirmation' | 'signup' | null
  action_options?: string[]
  editable_items?: EditableItem[]
  selectable_options?: SelectableOption[]
}

export async function sendOnboardingMessage(
  sessionId: string,
  message: string,
  currentStep?: string
): Promise<OnboardingResponse> {
  // Usar API route do Next.js como proxy para evitar problemas de CORS
  const response = await fetch('/api/onboarding', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      current_step: currentStep,
    } as OnboardingRequest),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Erro ao processar mensagem')
  }

  return response.json()
}

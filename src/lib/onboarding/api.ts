'use client'

interface OnboardingRequest {
  session_id: string
  message: string
  current_step?: string
  /** Edits a aplicar antes de processar a mensagem (ex: preços ao clicar Continuar). */
  edits?: Array<{ id: string; value: string }>
  /** Endereço do estabelecimento (quando step = address). */
  address?: {
    cep: string
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    localidade: string
    uf: string
  }
}

export interface EditableItem {
  id: string
  label: string
  value: string
  type:
    | 'service'
    | 'service_price'
    | 'service_duration'
    | 'faq'
    | 'variable'
    | 'schedule'
    | 'schedule_interval'
    | 'min_booking_lead'
    | 'service_area'
    | 'tone_of_voice'
    | 'policies'
    | 'business_name'
    | 'business_type'
    | 'context'
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
  requires_action?: string | null
  action_options?: string[]
  editable_items?: EditableItem[]
  selectable_options?: SelectableOption[]
}

export async function sendOnboardingMessage(
  sessionId: string,
  message: string,
  currentStep?: string,
  edits?: Array<{ id: string; value: string }>,
  address?: OnboardingRequest['address']
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
      edits,
      address,
    } as OnboardingRequest),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Erro ao processar mensagem')
  }

  return response.json()
}

'use client'

interface OnboardingRequest {
  session_id: string
  message: string
  current_step?: string
}

interface OnboardingResponse {
  assistant_message: string
  next_step: string
  extracted_data?: Record<string, any>
  requires_action?: 'domain_confirmation' | 'signup' | null
  action_options?: string[]
}

export async function sendOnboardingMessage(
  sessionId: string,
  message: string,
  currentStep?: string
): Promise<OnboardingResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurado')
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/onboarding-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
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

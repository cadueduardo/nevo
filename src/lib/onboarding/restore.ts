'use client'

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RestoredSession {
  current_step: string
  collected_data: Record<string, unknown>
}

export interface RestoredMessage {
  role: 'user' | 'assistant'
  content: string
  metadata?: {
    next_step?: string
    requires_action?: string | null
    action_options?: string[]
  }
}

export interface RestoreResult {
  session: RestoredSession | null
  messages: RestoredMessage[]
}

/**
 * Restaura sessão e mensagens do Supabase.
 * Usado após F5 para re-hidratar o estado quando sessionStorage preserva o session_id.
 */
export async function restoreOnboardingSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<RestoreResult> {
  const [sessionRes, messagesRes] = await Promise.all([
    supabase
      .from('onboarding_sessions')
      .select('current_step_key, collected_data')
      .eq('session_id', sessionId)
      .maybeSingle(),
    supabase
      .from('onboarding_messages')
      .select('role, content, metadata')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])

  const session =
    sessionRes.data && sessionRes.error == null
      ? {
          current_step: sessionRes.data.current_step_key || 'welcome',
          collected_data: (sessionRes.data.collected_data as Record<string, unknown>) || {},
        }
      : null

  const messages: RestoredMessage[] =
    messagesRes.data && messagesRes.error == null
      ? messagesRes.data.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content || '',
          metadata: (m.metadata as RestoredMessage['metadata']) || undefined,
        }))
      : []

  return { session, messages }
}

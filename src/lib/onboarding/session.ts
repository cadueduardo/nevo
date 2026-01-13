'use client'

const SESSION_ID_KEY = 'nevo_onboarding_session_id'

// Função simples para gerar UUID v4 (sem dependência externa)
function generateUUID(): string {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID()
  }
  // Fallback para navegadores sem crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  let sessionId = localStorage.getItem(SESSION_ID_KEY)
  
  if (!sessionId) {
    sessionId = generateUUID()
    localStorage.setItem(SESSION_ID_KEY, sessionId)
  }

  return sessionId
}

export function clearSessionId(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_ID_KEY)
  }
}

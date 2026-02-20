'use client'

import { useEffect } from 'react'

let initialized = false

export function SentryProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (initialized) return
    import('@sentry/browser')
      .then((Sentry) => {
        if (initialized) return
        initialized = true

        Sentry.init({
          dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
          environment: process.env.NEXT_PUBLIC_SENTRY_ENV || process.env.NODE_ENV,
          tracesSampleRate: 0.1,
        })
      })
      .catch(() => {
        // Keep app startup resilient even if monitoring SDK load fails.
      })
  }, [])

  return <>{children}</>
}

import type { NextRequest } from 'next/server'

type Bucket = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

declare global {
  // eslint-disable-next-line no-var
  var __nevoRateLimitStore: Map<string, Bucket> | undefined
}

function getStore(): Map<string, Bucket> {
  if (!global.__nevoRateLimitStore) {
    global.__nevoRateLimitStore = new Map()
  }
  return global.__nevoRateLimitStore
}

export function getRequestRateLimitKey(req: NextRequest, prefix: string): string {
  const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = req.headers.get('x-real-ip')?.trim()
  const ip = forwardedFor || realIp || 'unknown'
  return `${prefix}:${ip}`
}

export function consumeRateLimit(params: {
  key: string
  limit: number
  windowMs: number
}): RateLimitResult {
  const now = Date.now()
  const store = getStore()
  const current = store.get(params.key)

  if (!current || current.resetAt <= now) {
    store.set(params.key, {
      count: 1,
      resetAt: now + params.windowMs,
    })
    return {
      ok: true,
      remaining: Math.max(params.limit - 1, 0),
      retryAfterSeconds: Math.ceil(params.windowMs / 1000),
    }
  }

  if (current.count >= params.limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
    }
  }

  current.count += 1
  store.set(params.key, current)
  return {
    ok: true,
    remaining: Math.max(params.limit - current.count, 0),
    retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
  }
}

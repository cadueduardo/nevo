import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto'

const ENCRYPTED_PREFIX = 'enc:v1:'

function buildKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

function getCredentialsSecret(): string | null {
  return process.env.EVOLUTION_CREDENTIALS_SECRET?.trim() || null
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map((part) => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false
  }
  const [a, b] = octets
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isBlockedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) return true
  if (normalized === '0.0.0.0' || normalized === '::1' || normalized === '[::1]') return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return isPrivateIpv4(normalized)
  return false
}

export function sanitizeEvolutionBaseUrl(raw: string): { value: string | null; error: string | null } {
  const input = raw.trim()
  if (!input) return { value: null, error: null }

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return { value: null, error: 'URL base da Evolution inválida.' }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { value: null, error: 'A URL da Evolution deve usar http ou https.' }
  }
  if (isBlockedHost(parsed.hostname)) {
    return { value: null, error: 'Host da Evolution não permitido.' }
  }

  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''
  return { value: parsed.toString().replace(/\/$/, ''), error: null }
}

export function buildEvolutionBaseCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/$/, '')
  const candidates = [normalized]
  if (normalized.endsWith('/api')) candidates.push(normalized.replace(/\/api$/, ''))
  else candidates.push(`${normalized}/api`)
  return Array.from(new Set(candidates))
}

export function encryptEvolutionApiKey(apiKey: string): string {
  const secret = getCredentialsSecret()
  if (!secret) {
    throw new Error('Defina EVOLUTION_CREDENTIALS_SECRET para salvar API keys da Evolution.')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', buildKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCRYPTED_PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptEvolutionApiKey(value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value

  const secret = getCredentialsSecret()
  if (!secret) {
    throw new Error('Defina EVOLUTION_CREDENTIALS_SECRET para ler API keys da Evolution.')
  }

  const payload = value.slice(ENCRYPTED_PREFIX.length)
  const [ivPart, tagPart, dataPart] = payload.split('.')
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Formato inválido de credencial da Evolution.')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    buildKey(secret),
    Buffer.from(ivPart, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

export function resolveEvolutionApiKey(params: {
  storedValue?: string | null
  envValue?: string | null
}): string | null {
  const stored = params.storedValue?.trim() || null
  if (stored) return decryptEvolutionApiKey(stored)
  return params.envValue?.trim() || null
}

export function ensureEvolutionWebhookSecret(secret?: string | null): string {
  const value = secret?.trim()
  if (value) return value
  return randomBytes(24).toString('base64url')
}

export function buildEvolutionWebhookUrl(params: {
  appOrigin: string
  agentId: string
  webhookSecret?: string | null
}): string {
  const url = new URL(`/api/webhooks/evolution/${params.agentId}`, params.appOrigin)
  const secret = params.webhookSecret?.trim()
  if (secret) url.searchParams.set('token', secret)
  return url.toString()
}

export function isValidEvolutionWebhookToken(expected: string | null | undefined, received: string | null): boolean {
  const expectedValue = expected?.trim()
  if (!expectedValue) return false
  if (!received) return false

  const left = Buffer.from(expectedValue)
  const right = Buffer.from(received)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

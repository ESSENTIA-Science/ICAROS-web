import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = '__Host-icaros_session'
export const SESSION_ABSOLUTE_TTL_SEC = 7 * 24 * 60 * 60
export const SESSION_IDLE_TTL_SEC = 8 * 60 * 60
const TOUCH_INTERVAL_MS = 5 * 60 * 1000
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** The fields used from an API Gateway HTTP API v2 event. No AWS package is required. */
export interface AuthRequest {
  headers?: Readonly<Record<string, string | undefined>>
  cookies?: readonly string[]
}

/** Repository should join the session to its current user in one lookup. */
export interface StoredAdminSession {
  sessionId: string
  userId: string
  email: string
  displayName: string | null
  tokenHash: Uint8Array
  createdAt: Date
  expiresAt: Date
  lastSeenAt: Date
  revokedAt: Date | null
  isActive: boolean
  passwordChangedAt: Date
}

export interface SessionStore {
  findByTokenHash(tokenHash: Buffer): Promise<StoredAdminSession | null>
  /** Update only if the session is still current; store this timestamp atomically. */
  touch(sessionId: string, at: Date): Promise<void>
}

export interface AdminSession {
  sessionId: string
  userId: string
  email: string
  displayName: string | null
}

export type AuthErrorCode = 'bad_origin' | 'unauthenticated'

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(`auth: ${code}`)
    this.name = 'AuthError'
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}

function parseOrigin(value: string): string | null {
  if (!/^https?:\/\/[^/?#\s]+$/i.test(value)) return null
  try {
    const url = new URL(value)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

function getHeader(request: AuthRequest, name: string): string | null {
  const matches = Object.entries(request.headers ?? {}).filter(([key]) => key.toLowerCase() === name)
  return matches.length === 1 ? matches[0]?.[1] ?? null : null
}

function cookieToken(request: AuthRequest): string | null {
  const sources = request.cookies ?? [getHeader(request, 'cookie') ?? '']
  const values = sources.flatMap((header) => header.split(';')).map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
  if (values.length !== 1) return null
  const token = values[0]?.slice(SESSION_COOKIE.length + 1)
  if (!token || !TOKEN_PATTERN.test(token)) return null
  const bytes = Buffer.from(token, 'base64url')
  return bytes.length === 32 && bytes.toString('base64url') === token ? token : null
}

function isCurrent(row: StoredAdminSession, hash: Buffer, now: Date): boolean {
  const storedHash = Buffer.from(row.tokenHash)
  if (storedHash.length !== hash.length || !timingSafeEqual(storedHash, hash)) return false
  const time = now.getTime()
  const created = row.createdAt.getTime()
  const seen = row.lastSeenAt.getTime()
  return row.isActive && row.revokedAt === null &&
    Number.isFinite(created) && Number.isFinite(seen) &&
    created <= time && seen >= created && seen <= time &&
    row.passwordChangedAt.getTime() <= created &&
    row.expiresAt.getTime() > time && time < created + SESSION_ABSOLUTE_TTL_SEC * 1000 &&
    time - seen < SESSION_IDLE_TTL_SEC * 1000
}

/** Construct once at Lambda startup. Invalid or absent allowlists fail closed. */
export function createAuth(deps: {
  allowedOrigins: readonly string[]
  sessions: SessionStore
  now?: () => Date
}) {
  if (!deps.sessions || typeof deps.sessions.findByTokenHash !== 'function' ||
      typeof deps.sessions.touch !== 'function') throw new Error('Session store is required')
  if (!Array.isArray(deps.allowedOrigins) || deps.allowedOrigins.length === 0) {
    throw new Error('Explicit allowed origins are required')
  }
  const origins = new Set<string>()
  for (const value of deps.allowedOrigins) {
    const parsed = parseOrigin(value)
    if (!parsed) throw new Error('Invalid allowed origin')
    const url = new URL(parsed)
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !isLoopback) throw new Error('HTTPS origin required')
    origins.add(parsed)
  }

  async function readSession(request: AuthRequest): Promise<AdminSession | null> {
    const token = cookieToken(request)
    if (!token) return null
    const hash = createHash('sha256').update(token, 'utf8').digest()
    const row = await deps.sessions.findByTokenHash(hash)
    const at = deps.now?.() ?? new Date()
    if (!row || !isCurrent(row, hash, at)) return null
    if (at.getTime() - row.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await deps.sessions.touch(row.sessionId, at)
    }
    return { sessionId: row.sessionId, userId: row.userId, email: row.email, displayName: row.displayName }
  }

  async function assertTrustedOrigin(request: AuthRequest): Promise<void> {
    const origin = getHeader(request, 'origin')
    const parsed = origin ? parseOrigin(origin) : null
    if (!parsed || !origins.has(parsed)) throw new AuthError('bad_origin')
  }

  /** Call before parsing the body of every admin mutation. */
  async function requireAdmin(request: AuthRequest): Promise<AdminSession> {
    await assertTrustedOrigin(request)
    const session = await readSession(request)
    if (!session) throw new AuthError('unauthenticated')
    return session
  }

  return { requireAdmin, readSession, assertTrustedOrigin }
}

/** Call only after a separate, rate-limited password check; persist tokenHash, never token. */
export function createSessionCredential(now: Date = new Date()): {
  token: string
  tokenHash: Buffer
  expiresAt: Date
  setCookie: string
} {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token, 'utf8').digest()
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_SEC * 1000)
  const setCookie = `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_ABSOLUTE_TTL_SEC}; ` +
    `Expires=${expiresAt.toUTCString()}; HttpOnly; Secure; SameSite=Lax`
  return { token, tokenHash, expiresAt, setCookie }
}

import { createSessionCredential } from './auth/index.js'
import type { HttpEvent } from './http.js'

export interface LoginAccount {
  readonly id: string
  readonly passwordHash: string
  readonly isActive: boolean
}

export interface LoginDependencies {
  /** Atomically consume one attempt from durable storage; return false on exhaustion. */
  readonly attempts: { consume(ip: string): Promise<boolean>; reset?(ip: string): Promise<void> }
  readonly accounts: { findByEmail(email: string): Promise<LoginAccount | null> }
  readonly verifyPassword: (hash: string, password: string) => Promise<boolean>
  readonly sessions: {
    create(input: { userId: string; tokenHash: Buffer; expiresAt: Date; ip: string }): Promise<void>
    revoke(sessionId: string): Promise<void>
  }
  readonly now?: () => Date
}

const DENIED = { status: 401, body: { ok: false, error: 'DENIED' } } as const

export function createLoginService(deps: LoginDependencies) {
  if (!deps.attempts?.consume || !deps.accounts?.findByEmail || !deps.verifyPassword ||
      !deps.sessions?.create || !deps.sessions?.revoke) {
    throw new Error('Durable login dependencies are required')
  }

  return {
    async login(event: HttpEvent, body: unknown) {
      const ip = event.requestContext.http.sourceIp
      if (!ip) return { status: 503, body: { ok: false, error: 'UNAVAILABLE' } }
      // Count every request before account lookup, including malformed credentials.
      if (!(await deps.attempts.consume(ip))) return { status: 429, body: { ok: false, error: 'RATE_LIMITED' } }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return DENIED
      const input = body as Record<string, unknown>
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
      const password = input.password
      if (email.length < 3 || email.length > 254 || typeof password !== 'string' || password.length === 0 || password.length > 1024) return DENIED
      const account = await deps.accounts.findByEmail(email)
      if (!account?.isActive || !(await deps.verifyPassword(account.passwordHash, password))) return DENIED
      const credential = createSessionCredential(deps.now?.() ?? new Date())
      await deps.sessions.create({ userId: account.id, tokenHash: credential.tokenHash, expiresAt: credential.expiresAt, ip })
      await deps.attempts.reset?.(ip)
      return { status: 200, body: { ok: true, data: { userId: account.id, email } }, cookie: credential.setCookie }
    },
    async logout(sessionId: string) {
      await deps.sessions.revoke(sessionId)
      return {
        status: 200,
        body: { ok: true },
        cookie: '__Host-icaros_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      }
    },
  }
}

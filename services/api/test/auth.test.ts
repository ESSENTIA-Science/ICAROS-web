import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { AuthError, createAuth, createSessionCredential } from '../src/auth/index.js'

const now = new Date('2026-09-30T12:00:00.000Z')
const token = Buffer.alloc(32, 7).toString('base64url')
const hash = createHash('sha256').update(token).digest()

function fixture(overrides: Record<string, unknown> = {}) {
  const row = {
    sessionId: 's1', userId: 'u1', email: 'admin@example.com', displayName: null,
    tokenHash: hash, createdAt: new Date(now.getTime() - 10 * 60_000),
    expiresAt: new Date(now.getTime() + 60_000), lastSeenAt: new Date(now.getTime() - 60_000),
    revokedAt: null, isActive: true, passwordChangedAt: new Date(now.getTime() - 11 * 60_000),
    ...overrides,
  }
  const touched: string[] = []
  const auth = createAuth({
    allowedOrigins: ['https://icaros.kr'], now: () => now,
    sessions: {
      findByTokenHash: async () => row,
      touch: async (sessionId) => { touched.push(sessionId) },
    },
  })
  const request = { headers: { origin: 'https://icaros.kr', cookie: `__Host-icaros_session=${token}` } }
  return { auth, request, touched }
}

test('write guard accepts an active current session', async () => {
  const { auth, request } = fixture()
  assert.deepEqual(await auth.requireAdmin(request), {
    sessionId: 's1', userId: 'u1', email: 'admin@example.com', displayName: null,
  })
})

test('origin is required and never inferred from Host', async () => {
  const { auth, request } = fixture()
  await assert.rejects(auth.requireAdmin({ headers: { ...request.headers, origin: '', host: 'icaros.kr' } }),
    (error: unknown) => error instanceof AuthError && error.code === 'bad_origin')
  await assert.rejects(auth.requireAdmin({ headers: { ...request.headers, origin: 'https://evil.test', host: 'evil.test' } }),
    (error: unknown) => error instanceof AuthError && error.code === 'bad_origin')
})

test('empty or malformed allowlist fails at setup', () => {
  const { auth } = fixture()
  assert.ok(auth)
  for (const allowedOrigins of [[], ['https://icaros.kr/path'], ['http://icaros.kr'], ['*']]) {
    assert.throws(() => createAuth({ allowedOrigins, sessions: {
      findByTokenHash: async () => null, touch: async () => undefined,
    } }))
  }
})

test('missing cookie and duplicate cookie fail authentication', async () => {
  const { auth, request } = fixture()
  for (const cookie of ['', `${request.headers.cookie}; ${request.headers.cookie}`]) {
    await assert.rejects(auth.requireAdmin({ headers: { ...request.headers, cookie } }),
      (error: unknown) => error instanceof AuthError && error.code === 'unauthenticated')
  }
})

test('expired, idle, revoked, inactive, and password-changed sessions are rejected', async () => {
  const cases = [
    { expiresAt: now }, { lastSeenAt: new Date(now.getTime() - 8 * 60 * 60 * 1000) },
    { revokedAt: now }, { isActive: false }, { passwordChangedAt: now },
    { tokenHash: Buffer.alloc(32, 8) },
  ]
  for (const change of cases) {
    const { auth, request } = fixture(change)
    await assert.rejects(auth.requireAdmin(request),
      (error: unknown) => error instanceof AuthError && error.code === 'unauthenticated')
  }
})

test('last seen is touched after five minutes', async () => {
  const { auth, request, touched } = fixture({ lastSeenAt: new Date(now.getTime() - 5 * 60_000) })
  await auth.requireAdmin(request)
  assert.deepEqual(touched, ['s1'])
})

test('API Gateway v2 cookies array and case-insensitive Origin header work', async () => {
  const { auth } = fixture()
  const session = await auth.requireAdmin({
    headers: { Origin: 'https://icaros.kr' },
    cookies: [`__Host-icaros_session=${token}`],
  })
  assert.equal(session.userId, 'u1')
})

test('readSession permits originless reads, while requireAdmin denies them', async () => {
  const { auth, request } = fixture()
  const readRequest = { headers: { cookie: request.headers.cookie } }
  assert.equal((await auth.readSession(readRequest))?.userId, 'u1')
  await assert.rejects(auth.requireAdmin(readRequest),
    (error: unknown) => error instanceof AuthError && error.code === 'bad_origin')
})

test('absolute expiry cannot be extended by a store row', async () => {
  const { auth, request } = fixture({
    createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60_000),
    passwordChangedAt: new Date(now.getTime() - 8 * 24 * 60 * 60_000),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
  })
  await assert.rejects(auth.requireAdmin(request),
    (error: unknown) => error instanceof AuthError && error.code === 'unauthenticated')
})

test('credential uses a 256-bit token and stores only its SHA-256 digest', () => {
  const credential = createSessionCredential(now)
  assert.equal(Buffer.from(credential.token, 'base64url').length, 32)
  assert.deepEqual(credential.tokenHash, createHash('sha256').update(credential.token).digest())
  assert.equal(credential.expiresAt.toISOString(), '2026-10-07T12:00:00.000Z')
  assert.match(credential.setCookie, /^__Host-icaros_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=604800; Expires=/)
  assert.match(credential.setCookie, /; HttpOnly; Secure; SameSite=Lax$/)
  assert.doesNotMatch(credential.setCookie, /Domain=/)
})

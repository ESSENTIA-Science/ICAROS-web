import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { createPostgresAuthAdapters } from '../src/adapters/postgres-auth.js'
import { createAuth, createSessionCredential } from '../src/auth/index.js'
import { createLoginService } from '../src/login.js'

function fakeDb(responses: Record<string, unknown>[][] = []) {
  const calls: { sql: string; values: readonly unknown[] }[] = []
  return {
    calls,
    async query(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values })
      return { rows: responses.shift() ?? [] }
    },
  }
}

test('session lookup maps joined user for auth', async () => {
  const now = new Date('2026-09-30T12:00:00Z')
  const credential = createSessionCredential(now)
  const db = fakeDb([[{ session_id: 's', user_id: 'u', email: 'a@b.c', display_name: null,
    token_hash: credential.tokenHash, created_at: now, expires_at: credential.expiresAt,
    last_seen_at: now, revoked_at: null, is_active: true, password_changed_at: new Date(0) }]])
  const adapters = createPostgresAuthAdapters(db, { verifyPassword: async () => false })
  const auth = createAuth({ allowedOrigins: ['https://icaros.kr'], sessions: adapters.authSessions, now: () => now })
  assert.equal((await auth.readSession({ cookies: [credential.setCookie] }))?.userId, 'u')
  assert.match(db.calls[0]!.sql, /join icaros\.admin_users/)
  assert.deepEqual(db.calls[0]!.values, [createHash('sha256').update(credential.token).digest()])
})

test('attempt consumption is atomic and denied when SQL returns no row', async () => {
  const db = fakeDb([[{ allowed: true }], []])
  const adapters = createPostgresAuthAdapters(db, { verifyPassword: async () => false })
  assert.equal(await adapters.login.attempts.consume('192.0.2.1'), true)
  assert.equal(await adapters.login.attempts.consume('192.0.2.1'), false)
  assert.match(db.calls[0]!.sql, /on conflict \(key\) do update/i)
  assert.match(db.calls[0]!.sql, /locked_until/i)
  assert.deepEqual(db.calls[0]!.values, ['ip:192.0.2.1'])
})

test('account lookup and session writes use schema columns and hashed token', async () => {
  const hash = '$argon2id$v=19$example'
  const db = fakeDb([[{ id: 'u', password_hash: hash, is_active: true }], [], [], []])
  const adapters = createPostgresAuthAdapters(db, { verifyPassword: async (stored, password) => stored === hash && password === 'secret' })
  assert.deepEqual(await adapters.login.accounts.findByEmail('a@b.c'), { id: 'u', passwordHash: hash, isActive: true })
  assert.equal(await adapters.login.verifyPassword(hash, 'secret'), true)
  const tokenHash = Buffer.alloc(32, 7)
  const expiresAt = new Date('2026-10-01T00:00:00Z')
  await adapters.login.sessions.create({ userId: 'u', tokenHash, expiresAt, ip: '192.0.2.1' })
  await adapters.login.sessions.revoke('s')
  await adapters.authSessions.touch('s', new Date())
  assert.match(db.calls[1]!.sql, /insert into icaros\.admin_sessions/i)
  assert.deepEqual(db.calls[1]!.values, ['u', tokenHash, expiresAt, '192.0.2.1'])
  assert.match(db.calls[2]!.sql, /revoked_at is null/i)
  assert.match(db.calls[3]!.sql, /last_seen_at/i)
})

test('login service accepts durable adapters and persists credential hash', async () => {
  const db = fakeDb([[{ allowed: true }], [{ id: 'u', password_hash: '$argon2id$test', is_active: true }], []])
  const adapters = createPostgresAuthAdapters(db, { verifyPassword: async () => true })
  const service = createLoginService(adapters.login)
  const result = await service.login({ requestContext: { http: { sourceIp: '192.0.2.1' } } } as Parameters<typeof service.login>[0], { email: 'A@B.C', password: 'secret' })
  assert.equal(result.status, 200)
  assert.equal(db.calls[2]!.values[0], 'u')
  assert.equal((db.calls[2]!.values[1] as Buffer).length, 32)
})

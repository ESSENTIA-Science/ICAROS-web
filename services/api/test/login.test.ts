import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLoginService } from '../src/login.js'

test('login consumes durable limit before lookup and stores only a token digest', async () => {
  const calls: string[] = []
  const saved: { hash?: Buffer } = {}
  const login = createLoginService({
    attempts: { async consume(ip) { calls.push(`limit:${ip}`); return true } },
    accounts: { async findByEmail(email) { calls.push(`lookup:${email}`); return { id: 'admin', passwordHash: 'hash', isActive: true } } },
    async verifyPassword() { calls.push('verify'); return true },
    sessions: {
      async create(input) { calls.push('create'); saved.hash = input.tokenHash },
      async revoke() { calls.push('revoke') },
    },
  })
  const result = await login.login({ rawPath: '', requestContext: { http: { method: 'POST', sourceIp: '127.0.0.1' } } },
    { email: 'ADMIN@example.com', password: 'valid' })
  assert.equal(result.status, 200)
  assert.deepEqual(calls, ['limit:127.0.0.1', 'lookup:admin@example.com', 'verify', 'create'])
  assert.equal(saved.hash?.length, 32)
  assert.match(result.cookie ?? '', /HttpOnly; Secure; SameSite=Lax$/)
})

test('login fails closed without source IP or durable dependencies', async () => {
  assert.throws(() => createLoginService({} as never))
  let consumed = false
  const login = createLoginService({
    attempts: { async consume() { consumed = true; return true } },
    accounts: { async findByEmail() { throw new Error('must not query') } },
    async verifyPassword() { return false },
    sessions: { async create() { throw new Error('must not write') }, async revoke() {} },
  })
  const result = await login.login({ rawPath: '', requestContext: { http: { method: 'POST' } } }, {})
  assert.equal(result.status, 503)
  assert.equal(consumed, false)
})

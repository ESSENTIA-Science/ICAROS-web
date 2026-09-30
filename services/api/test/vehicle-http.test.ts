import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttpHandler, type AdminOperations, type HttpEvent } from '../src/http.js'

const event = (method: string, path: string): HttpEvent => ({
  rawPath: path, requestContext: { http: { method } }, headers: { 'if-match': 'v1' },
  body: JSON.stringify({ mediaIds: [] }),
})
test('vehicle media routes authenticate before reading or writing and require If-Match', async () => {
  const calls: string[] = []
  const ops = {
    async requireAdmin(_event: HttpEvent, mutation: boolean) { calls.push(mutation ? 'write-auth' : 'read-auth'); return null },
    async readVehicleMedia() { calls.push('read'); return { status: 200, body: {} } },
    async writeVehicleMedia() { calls.push('write'); return { status: 200, body: {} } },
  } as unknown as AdminOperations
  const handler = createHttpHandler(ops)
  assert.equal((await handler(event('GET', '/api/admin/content/vehicles/icx1/gallery'))).statusCode, 403)
  assert.equal((await handler(event('PUT', '/api/admin/content/vehicles/icx1/model'))).statusCode, 403)
  assert.deepEqual(calls, ['read-auth', 'write-auth'])
  ops.requireAdmin = async () => ({ userId: 'u', email: 'admin@example.test' })
  assert.equal((await handler({ ...event('PUT', '/api/admin/content/vehicles/icx1/gallery'), headers: {} })).statusCode, 400)
  assert.equal(calls.includes('write'), false)
})

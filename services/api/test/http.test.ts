import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHttpHandler, type AdminOperations, type HttpEvent } from '../src/http.js'
import { handler as unwiredHandler } from '../src/handler.js'

const event = (method: string, rawPath: string, body?: unknown): HttpEvent => ({
  rawPath,
  requestContext: { http: { method } },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

function operations(calls: string[], allowed: boolean): AdminOperations {
  return {
    async requireAdmin(_event, mutation) { calls.push(`guard:${mutation}`); return allowed ? { userId: 'admin-1', email: 'admin@example.test' } : null },
    async assertLoginOrigin() { calls.push('login-origin'); return allowed },
    async login() { calls.push('login'); return { status: 503, body: { ok: false } } },
    async logout() { calls.push('logout'); return { status: 200, body: { ok: true } } },
    async readContent(route) { calls.push(`read:${route}`); return { ok: true } },
    async writeContent(route) { calls.push(`write:${route}`); return { status: 200, body: { ok: true } } },
    async createContent(route) { calls.push(`create:${route}`); return { status: 201, body: { ok: true } } },
    async deleteContent(route) { calls.push(`delete:${route}`); return { status: 200, body: { ok: true } } },
    async startPublish() { calls.push('publish'); return { status: 202, body: { ok: true } } },
    async readPublish(id) { calls.push(`job:${id}`); return { status: 200, body: { ok: true } } },
    async retryPublish(id) { calls.push(`retry:${id}`); return { status: 202, body: { ok: true } } },
    async requireBuildWorker() { calls.push('worker-guard'); return allowed },
    async finishPublish(id) { calls.push(`finish:${id}`); return { status: 200, body: { ok: true } } },
  }
}

test('all supported mutations run the admin guard before their service', async () => {
  for (const request of [
    { ...event('PUT', '/api/admin/content/rockets/r1', {}), headers: { 'if-match': 'v1' } },
    { ...event('PUT', '/api/admin/content/site/s1', {}), headers: { 'if-match': 'v1' } },
    { ...event('PUT', '/api/admin/content/posts/p1', {}), headers: { 'if-match': 'v1' } },
    event('POST', '/api/admin/publish', {}),
    event('POST', '/api/admin/logout'),
    event('POST', '/api/admin/publish/job-1/retry'),
  ]) {
    const calls: string[] = []
    const response = await createHttpHandler(operations(calls, true))(request)
    assert.equal(response.statusCode < 400, true)
    assert.equal(calls[0], 'guard:true')
    assert.equal(calls.length, 2)
  }
})

test('denied writes never parse or call the write service', async () => {
  const calls: string[] = []
  const response = await createHttpHandler(operations(calls, false))({
    ...event('PUT', '/api/admin/content/site/s1'), body: '{bad',
  })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(calls, ['guard:true'])
})

test('media routes authenticate before parsing and never respond with a cached URL', async () => {
  const calls: string[] = []
  const denied = await createHttpHandler({ ...operations(calls, false), async presignMedia() { calls.push('presign'); return { status: 201, body: { ok: true } } } })({ ...event('POST', '/api/admin/media/presign'), body: '{bad' })
  assert.equal(denied.statusCode, 403)
  assert.deepEqual(calls, ['guard:true'])
  calls.length = 0
  const allowed = await createHttpHandler({ ...operations(calls, true), async confirmMedia() { calls.push('confirm'); return { status: 200, body: { ok: true } } } })(event('POST', '/api/admin/media/confirm', { mediaId: 'x' }))
  assert.equal(allowed.statusCode, 200)
  assert.equal(allowed.headers['cache-control'], 'private, no-store')
  assert.deepEqual(calls, ['guard:true', 'confirm'])
})

test('collection create and versioned delete use the admin guard', async () => {
  const calls: string[] = []
  const handler = createHttpHandler(operations(calls, true))
  assert.equal((await handler(event('POST', '/api/admin/content/departments', { id: 'x', name: 'Team' }))).statusCode, 201)
  assert.deepEqual(calls, ['guard:true', 'create:departments'])
  calls.length = 0
  assert.equal((await handler({ ...event('DELETE', '/api/admin/content/panels/id'), headers: { 'If-Match': 'v1' } })).statusCode, 200)
  assert.deepEqual(calls, ['guard:true', 'delete:panels'])
  calls.length = 0
  const denied = await createHttpHandler(operations(calls, false))({
    ...event('POST', '/api/admin/content/members'), body: '{bad',
  })
  assert.equal(denied.statusCode, 403)
  assert.deepEqual(calls, ['guard:true'])
})

test('session and publish state require a session and disable caching', async () => {
  const calls: string[] = []
  const handler = createHttpHandler(operations(calls, true))
  const session = await handler(event('GET', '/api/admin/session'))
  const job = await handler(event('GET', '/api/admin/publish/job-1'))
  assert.equal(session.statusCode, 200)
  assert.equal(job.statusCode, 200)
  assert.equal(job.headers['cache-control'], 'private, no-store')
  assert.deepEqual(calls, ['guard:false', 'guard:false', 'job:job-1'])
})

test('unsupported public write paths cannot reach services', async () => {
  const calls: string[] = []
  const response = await createHttpHandler(operations(calls, true))(event('POST', '/api/community/posts', {}))
  assert.equal(response.statusCode, 404)
  assert.equal(calls.includes('publish'), false)
})

test('login checks origin before parsing credentials', async () => {
  const calls: string[] = []
  const response = await createHttpHandler(operations(calls, false))({
    ...event('POST', '/api/admin/login'), body: '{bad',
  })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(calls, ['login-origin'])
})

test('unwired Lambda export cannot grant a write', async () => {
  const response = await unwiredHandler({ ...event('PUT', '/api/admin/content/site/nav.about', { value: 'x' }), headers: { origin: 'https://icaros.kr', 'if-match': 'version' } })
  assert.equal(response.statusCode, 503)
  assert.equal(JSON.parse(response.body).ok, false)
})

test('worker callback authenticates before parsing and never uses the browser admin guard', async () => {
  const calls: string[] = []
  const denied = await createHttpHandler(operations(calls, false))({ ...event('POST', '/api/internal/publish/job-1/complete'), body: '{bad' })
  assert.equal(denied.statusCode, 403)
  assert.deepEqual(calls, ['worker-guard'])
  calls.length = 0
  const accepted = await createHttpHandler(operations(calls, true))(event('POST', '/api/internal/publish/job-1/complete', { attempt: 1 }))
  assert.equal(accepted.statusCode, 200)
  assert.deepEqual(calls, ['worker-guard', 'finish:job-1'])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApiHandler } from '../src/api.js'
import { createSessionCredential } from '../src/auth/index.js'
import type { HttpEvent } from '../src/http.js'
import type { PublicationJob, PublicationState } from '../src/publish/index.js'

const VERSION = '2026-09-30T01:00:00.000000Z'

test('CMS contract uses session email, If-Match, server snapshot and job state', async () => {
  const now = new Date()
  const credential = createSessionCredential(now)
  const jobs = new Map<string, PublicationJob>()
  const state: PublicationState = { latestVersion: null, publishedVersion: null, activeJobId: null }
  const calls: string[] = []
  let postWrites = 0
  const postPublished = true
  const api = createApiHandler({
    allowedOrigins: ['https://icaros.kr'],
    authSessions: {
      async findByTokenHash(hash) {
        if (!hash.equals(credential.tokenHash)) return null
        return {
          sessionId: 'session', userId: 'admin', email: 'admin@example.test', displayName: null,
          tokenHash: hash, createdAt: now, expiresAt: credential.expiresAt, lastSeenAt: now,
          revokedAt: null, isActive: true, passwordChangedAt: new Date(now.getTime() - 1000),
        }
      },
      async touch() {},
    },
    login: {
      attempts: { async consume() { return true } },
      accounts: { async findByEmail() { return { id: 'admin', passwordHash: 'stored', isActive: true } } },
      async verifyPassword() { return true },
      sessions: { async create() {}, async revoke() {} },
    },
    contentRepository: {
      async create() { throw new Error('unexpected create') },
      async updateIfVersion(write) { calls.push(`update:${write.id}:${write.version}`); return { status: 'saved', id: write.id, version: '2026-09-30T01:01:00.000000Z' } },
      async deleteIfVersion() { throw new Error('unexpected delete') },
    },
    essentiaPosts: {
      async create(write) { postWrites++; assert.equal(write.published, false); return { status: 'saved', id: 'post-1', version: 'post-v2' } },
      async update(write) { postWrites++; assert.equal(write.published, false); return { status: 'saved', id: write.id, version: 'post-v2' } },
      async delete() { throw new Error('unexpected') },
    },
    contentReader: { async read() { return [{ id: 'icx-1a', version: VERSION }] } },
    contentRecordReader: { async read(route) { return route === 'posts'
      ? { id: 'post-1', version: 'post-v2', publishState: 'draft_saved', updatedAt: now.toISOString(), title: 'Post', bodyMd: 'Body', authorLabel: 'Team' }
      : { id: 'icx-1a', version: '2026-09-30T01:01:00.000000Z', publishState: 'draft_saved', updatedAt: now.toISOString(), name: 'ICX' } } },
    postStateReader: { async read() { return { published: postPublished, authorLabel: 'Team' } } },
    publishPost: async (id, version) => { calls.push(`publish-post:${id}:${version}`); return { status: 'saved' } },
    publicationRepository: { async withLock(operation) { return operation({
      async getState() { return { ...state } }, async saveState(next) { Object.assign(state, next) },
      async getJob(id) { return jobs.get(id) ?? null },
      async getByKey(key) { return [...jobs.values()].find(job => job.idempotencyKey === key) ?? null },
      async listJobs() { return [...jobs.values()] }, async saveJob(job) { jobs.set(job.id, job) },
    }) } },
    buildLauncher: { async launch(job) { calls.push(`launch:${job.snapshotSha256}`) }, async promote() {} },
    snapshotExporter: { async export() { calls.push('export'); return { snapshotRef: 'server/snapshot.json', snapshotSha256: 'a'.repeat(64) } } },
    publicationSource: { async prepare(input) { calls.push(`prepare:${input.recordVersion}`); return { version: calls.filter(value => value.startsWith('prepare:')).length, sourceRevision: 'server-revision' } } },
    async requireBuildWorker() {},
    newJobId: () => `job-${jobs.size + 1}`,
  })
  const request = (method: string, rawPath: string, body?: unknown, headers?: Record<string, string>): HttpEvent => ({
    rawPath, requestContext: { http: { method, sourceIp: '127.0.0.1' } },
    cookies: [`__Host-icaros_session=${credential.token}`],
    headers: { origin: 'https://icaros.kr', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const session = await api(request('GET', '/api/admin/session'))
  assert.deepEqual(JSON.parse(session.body).data, { userId: 'admin', email: 'admin@example.test' })
  const login = await api(request('POST', '/api/admin/login', { email: 'admin@example.test', password: 'valid' }))
  assert.deepEqual(JSON.parse(login.body).data, { userId: 'admin', email: 'admin@example.test' })
  assert.equal(login.cookies?.length, 1)
  const list = await api(request('GET', '/api/admin/content/rockets'))
  assert.equal(JSON.parse(list.body).data.length, 1)

  const save = await api(request('PUT', '/api/admin/content/rockets/icx-1a', { name: 'ICX' }, { 'If-Match': VERSION }))
  assert.equal(save.statusCode, 200)
  assert.equal(JSON.parse(save.body).data.version, '2026-09-30T01:01:00.000000Z')
  assert.ok(calls.includes(`update:icx-1a:${VERSION}`))

  const rejectedAuthor = await api(request('PUT', '/api/admin/content/posts/post-1', { title: 'Post', bodyMd: 'Body', authorLabel: 'Changed' }, { 'If-Match': 'post-v1' }))
  assert.equal(rejectedAuthor.statusCode, 422)
  assert.equal(postWrites, 0)
  const savedPost = await api(request('PUT', '/api/admin/content/posts/post-1', { title: 'Post', bodyMd: 'Body', authorLabel: 'Team', displayDate: '2026-07-18', attachments: [] }, { 'If-Match': 'post-v1' }))
  assert.equal(savedPost.statusCode, 200)
  assert.equal(postWrites, 1)
  const createdPost = await api(request('POST', '/api/admin/content/posts', { title: 'New post', bodyMd: 'Draft', displayDate: '2026-07-18', attachments: [], idempotencyKey: 'create-post-12345' }))
  assert.equal(createdPost.statusCode, 200)
  assert.equal(postWrites, 2)

  const publish = await api(request('POST', '/api/admin/publish', { kind: 'rockets', id: 'icx-1a', version: VERSION, idempotencyKey: 'key-12345678' }))
  assert.equal(publish.statusCode, 202)
  assert.equal(JSON.parse(publish.body).data.state, 'publishing')
  assert.ok(calls.includes('prepare:' + VERSION))
  assert.ok(calls.includes('launch:' + 'a'.repeat(64)))
  const job = await api(request('GET', '/api/admin/publish/job-1'))
  assert.equal(JSON.parse(job.body).data.id, 'job-1')

  const failed = await api(request('POST', '/api/internal/publish/job-1/fail', { attempt: 1 }))
  assert.equal(JSON.parse(failed.body).data.state, 'failed')
  const retry = await api(request('POST', '/api/admin/publish/job-1/retry'))
  assert.equal(retry.statusCode, 202)
  assert.equal(JSON.parse(retry.body).data.state, 'publishing')
  const completed = await api(request('POST', '/api/internal/publish/job-1/complete', { attempt: 2 }))
  assert.equal(JSON.parse(completed.body).data.state, 'published')

  const before = calls.length
  const unauthenticated = await api({
    ...request('POST', '/api/admin/publish', { kind: 'rockets', id: 'icx-1a', version: VERSION, idempotencyKey: 'key-87654321' }),
    cookies: [],
  })
  assert.equal(unauthenticated.statusCode, 403)
  assert.equal(calls.length, before, 'unauthenticated publish cannot allocate a version or export a snapshot')
  const forged = await api(request('POST', '/api/admin/publish', {
    kind: 'rockets', id: 'icx-1a', version: VERSION, idempotencyKey: 'key-99999999',
    snapshotRef: 'attacker/path.json',
  }))
  assert.equal(forged.statusCode, 400)
  assert.equal(calls.length, before)
  const postPublish = await api(request('POST', '/api/admin/publish', { kind: 'posts', id: 'post-1', version: '2', idempotencyKey: 'post-publish-12345' }))
  assert.equal(postPublish.statusCode, 202)
  assert.ok(calls.indexOf('publish-post:post-1:2') < calls.indexOf('prepare:2'))
})

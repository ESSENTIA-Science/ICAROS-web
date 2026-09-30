import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createContentService, parseContentWrite, parsePostWrite } from '../src/content/index.js'
import type { ContentRepository, EssentiaPostsAdapter, RepositoryResult } from '../src/content/index.js'

const VERSION = '2026-09-30T08:12:13.123456Z'
const PANEL_ID = 'aaad326c-74de-4bd2-a3f9-6869cde0b83f'
const MEDIA_ID = '59f0649e-ed79-47a2-bf9d-e299204641b8'
const saved: RepositoryResult = { status: 'saved', id: PANEL_ID, version: VERSION }

function fixtures(allowed = true, answer: RepositoryResult = saved) {
  const calls: string[] = []
  const repository: ContentRepository = {
    async create(write) { calls.push(`content:create:${write.entity}`); return answer },
    async updateIfVersion(write) { calls.push(`content:update:${write.entity}:${write.version}`); return answer },
    async deleteIfVersion(write) { calls.push(`content:delete:${write.entity}:${write.version}`); return answer },
  }
  const essentiaPosts: EssentiaPostsAdapter = {
    async create() { calls.push('post:create'); return answer },
    async update() { calls.push('post:update'); return answer },
    async delete() { calls.push('post:delete'); return answer },
  }
  const service = createContentService({
    requireAdmin: async (request: { route: string }) => {
      calls.push(`auth:${request.route}`)
      return allowed
    },
    contentRepository: repository, essentiaPosts,
  })
  return { calls, service, repository, essentiaPosts }
}

const request = { route: '/api/admin/content' }
const panelCreate = {
  operation: 'create', entity: 'panel', id: PANEL_ID,
  fields: { mediaId: MEDIA_ID, headline: '첫 발사', published: false },
}

test('denied content and posts never reach a repository, even for malformed input', async () => {
  const { calls, service } = fixtures(false)
  assert.deepEqual(await service.editContent(request, null), { ok: false, status: 'denied' })
  assert.deepEqual(await service.editPost(request, null), { ok: false, status: 'denied' })
  assert.deepEqual(calls, ['auth:/api/admin/content', 'auth:/api/admin/content'])
})

test('missing dependencies fail at construction', () => {
  assert.throws(() => createContentService(undefined as never), TypeError)
  assert.throws(() => createContentService({ requireAdmin: () => true } as never), TypeError)
})

test('malformed, unknown and dangerous fields are rejected after auth', async () => {
  const { calls, service } = fixtures()
  const bad = [
    { ...panelCreate, fields: { headline: 'No photo', published: true } },
    { ...panelCreate, fields: { ...panelCreate.fields, published: 'true' } },
    { ...panelCreate, fields: { ...panelCreate.fields, sql: 'DROP TABLE' } },
    { ...panelCreate, fields: { ...panelCreate.fields, ctaLabel: 'Open' } },
    { operation: 'delete', entity: 'rocket', id: 'icx1', version: 'bad' },
    { operation: 'delete', entity: 'siteSetting', id: 'nav.about', version: VERSION },
    { operation: 'create', entity: 'post', id: 'bad', fields: {} },
  ]
  for (const item of bad) assert.deepEqual(await service.editContent(request, item), { ok: false, status: 'malformed' })
  assert.equal(calls.filter((call) => call.startsWith('auth:')).length, bad.length)
  assert.equal(calls.filter((call) => call.startsWith('content:')).length, 0)
})

test('repository conflict is preserved and update passes per-record version atomically', async () => {
  const { calls, service } = fixtures(true, { status: 'conflict' })
  const result = await service.editContent(request, {
    operation: 'update', entity: 'rocket', id: 'icx1', version: VERSION,
    fields: { name: 'ICX-I' },
  })
  assert.deepEqual(result, { ok: false, status: 'conflict' })
  assert.deepEqual(calls, ['auth:/api/admin/content', `content:update:rocket:${VERSION}`])
  assert.deepEqual(parseContentWrite({ operation: 'delete', entity: 'member', id: PANEL_ID, version: VERSION }),
    { operation: 'delete', entity: 'member', id: PANEL_ID, version: VERSION })
})

test('authorized create and delete use only the ICAROS repository', async () => {
  const created = fixtures()
  assert.deepEqual(await created.service.editContent(request, panelCreate),
    { ok: true, status: 'saved', id: PANEL_ID, version: VERSION })
  assert.deepEqual(created.calls, ['auth:/api/admin/content', 'content:create:panel'])

  const deleted = fixtures(true, { status: 'deleted', id: PANEL_ID })
  assert.deepEqual(await deleted.service.editContent(request,
    { operation: 'delete', entity: 'panel', id: PANEL_ID, version: VERSION }),
    { ok: true, status: 'deleted', id: PANEL_ID })
  assert.deepEqual(deleted.calls, ['auth:/api/admin/content', `content:delete:panel:${VERSION}`])
})

test('post writes use ESSENTIA adapter only and require an idempotency key', async () => {
  const { calls, service } = fixtures()
  const draft = { operation: 'create', idempotencyKey: 'publish-20260930-0001',
    title: '발사 기록', bodyMd: '기록', displayDate: '2026-07-18', attachments: [], published: false }
  assert.deepEqual(await service.editPost(request, draft),
    { ok: true, status: 'saved', id: PANEL_ID, version: VERSION })
  assert.deepEqual(calls, ['auth:/api/admin/content', 'post:create'])
  assert.equal(parsePostWrite({ ...draft, idempotencyKey: '' }), null)
  assert.equal(parsePostWrite({ ...draft, serviceToken: 'forbidden' }), null)
  assert.equal(parsePostWrite({ ...draft, displayDate: '2026-02-30' }), null)
})

test('site settings and members use the allowlist and explicit published value', async () => {
  assert.deepEqual(parseContentWrite({ operation: 'create', entity: 'siteSetting', id: 'donation.goal',
    fields: { value: '1000000' } }),
  { operation: 'create', entity: 'siteSetting', id: 'donation.goal', fields: { value: '1000000' } })
  assert.equal(parseContentWrite({ operation: 'create', entity: 'siteSetting', id: 'admin.secret',
    fields: { value: 'x' } }), null)
  assert.equal(parseContentWrite({ operation: 'update', entity: 'siteSetting', id: 'nav.about',
    version: VERSION, fields: { value: null } }), null)
  assert.equal(parseContentWrite({ operation: 'create', entity: 'member', id: PANEL_ID,
    fields: { name: '홍길동' } }), null)
  assert.deepEqual(parseContentWrite({ operation: 'create', entity: 'member', id: PANEL_ID,
    fields: { name: '홍길동', published: false } }),
  { operation: 'create', entity: 'member', id: PANEL_ID,
    fields: { name: '홍길동', published: false } })
})

test('ESSENTIA delete delegates the opaque upstream version and preserves conflict', async () => {
  const { calls, service } = fixtures(true, { status: 'conflict' })
  const result = await service.editPost(request, { operation: 'delete', id: 'article-42',
    version: 'v7', idempotencyKey: 'delete-article-42' })
  assert.deepEqual(result, { ok: false, status: 'conflict' })
  assert.deepEqual(calls, ['auth:/api/admin/content', 'post:delete'])
})

test('guard exceptions fail closed and adapter exceptions expose no details', async () => {
  const calls: string[] = []
  const dependencies = fixtures()
  const service = createContentService({
    requireAdmin: () => { calls.push('auth'); throw new Error('secret') },
    contentRepository: dependencies.repository,
    essentiaPosts: dependencies.essentiaPosts,
  })
  assert.deepEqual(await service.editContent(request, panelCreate), { ok: false, status: 'denied' })
  assert.deepEqual(calls, ['auth'])

  const unavailable = createContentService({
    requireAdmin: () => true,
    contentRepository: {
      create: async () => { throw new Error('credential') },
      updateIfVersion: async () => { throw new Error('credential') },
      deleteIfVersion: async () => { throw new Error('credential') },
    },
    essentiaPosts: {
      create: async () => { throw new Error('credential') },
      update: async () => { throw new Error('credential') },
      delete: async () => { throw new Error('credential') },
    },
  })
  assert.deepEqual(await unavailable.editContent(request, panelCreate), { ok: false, status: 'unavailable' })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createEssentiaPostsAdapter } from '../src/essentia/posts.js'

const origin = 'https://essentia.example'
const token = 'test-secret'
const postId = '11111111-1111-4111-8111-111111111111'
const forumId = '22222222-2222-4222-8222-222222222222'
const updatedAt = '2026-09-30T09:00:00Z'
const displayDate = '2026-07-18'
const attachments = [{ mediaId: '33333333-3333-4333-8333-333333333333', kind: 'image' as const, title: '발사 사진' }]
const saved = { id: postId, version: 1, publishedVersion: null, forumPostId: null, updatedAt }

test('create sends scoped credential and idempotency key, then publishes requested draft', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: 'ICAROS 팀', fetch: async (url, init) => {
    calls.push({ url: String(url), init: init! })
    return Response.json(calls.length === 1 ? { ...saved, version: 1 } : { ...saved, publishedVersion: 1, forumPostId: forumId })
  } })
  assert.deepEqual(await adapter.create({ operation: 'create', idempotencyKey: 'create-p1', title: 'Title', bodyMd: 'Body', displayDate, attachments, published: true }), { status: 'saved', id: postId, version: '1' })
  assert.equal(calls[0]?.url, `${origin}/api/service/icaros/posts`)
  assert.equal(calls[0]?.init.headers && (calls[0].init.headers as Record<string,string>)['Authorization'], `Bearer ${token}`)
  assert.equal((calls[0]?.init.headers as Record<string,string>)['Idempotency-Key'], 'create-p1')
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { category: 'ICAROS', title: 'Title', content: 'Body', displayDate, attachments })
  assert.equal(calls[1]?.url, `${origin}/api/service/icaros/posts/${postId}/publish`)
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), { expectedVersion: 1 })
})

test('update sends numeric expectedVersion and maps 409 to conflict', async () => {
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: 'ICAROS 팀', fetch: async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedVersion: 3, draft: { category: 'ICAROS', title: 'New', content: 'Text', displayDate, attachments } })
    return new Response(null, { status: 409 })
  } })
  assert.deepEqual(await adapter.update({ operation: 'update', id: postId, version: '3', idempotencyKey: 'update-p1', title: 'New', bodyMd: 'Text', displayDate, attachments, published: false }), { status: 'conflict' })
})

test('publishDraft promotes the saved revision without creating another draft', async () => {
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: 'ICAROS 팀', fetch: async (url, init) => {
    assert.equal(String(url), `${origin}/api/service/icaros/posts/${postId}/publish`)
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedVersion: 3 })
    return Response.json({ ...saved, version: 3, publishedVersion: 3, forumPostId: forumId })
  } })
  assert.deepEqual(await adapter.publishDraft(postId, '3'), { status: 'saved', id: postId, version: '3' })
})

test('delete and invalid version fail without contacting upstream', async () => {
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: 'ICAROS 팀', fetch: async () => { throw new Error('called') } })
  await assert.rejects(adapter.delete({ operation: 'delete', id: postId, version: '1', idempotencyKey: 'delete-p1' }))
  await assert.rejects(adapter.update({ operation: 'update', id: postId, version: 'v2', idempotencyKey: 'update-p1', title: 'New', bodyMd: 'Text', displayDate, attachments, published: false }))
})

test('snapshot reads only mapped published entries', async () => {
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: 'ICAROS 팀', fetch: async () => Response.json([{ id: postId, version: 2, forumPostId: forumId, category: 'ICAROS', title: 'Title', content: 'Body', displayDate, attachments }]) })
  assert.deepEqual(await adapter.readSnapshot(), [{ id: postId, version: '2', forumPostId: forumId, category: 'ICAROS', title: 'Title', contentMd: 'Body', displayDate, attachments }])
})

test('listDrafts maps published and unpublished revisions to CMS read fields using upstream updatedAt', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: 'ICAROS 팀', fetch: async (url, init) => {
    calls.push({ url: String(url), init: init! })
    return Response.json([
      { id: postId, version: 3, publishedVersion: 2, title: 'Changed', content: 'Draft', category: 'ICAROS', forumPostId: forumId, updatedAt, displayDate, attachments },
      { id: forumId, version: 1, publishedVersion: 1, title: 'Live', content: 'Body', category: 'ICAROS', forumPostId: postId, updatedAt, displayDate, attachments },
      { id: '33333333-3333-4333-8333-333333333333', version: 1, publishedVersion: null, title: 'New', content: '', category: 'ICAROS', forumPostId: null, updatedAt, displayDate, attachments },
    ])
  } })
  assert.deepEqual(await adapter.listDrafts(), [
    { id: postId, version: '3', publishedVersion: '2', publishState: 'draft_saved', updatedAt, title: 'Changed', bodyMd: 'Draft', authorLabel: 'ICAROS 팀', displayDate, attachments },
    { id: forumId, version: '1', publishedVersion: '1', publishState: 'published', updatedAt, title: 'Live', bodyMd: 'Body', authorLabel: 'ICAROS 팀', displayDate, attachments },
    { id: '33333333-3333-4333-8333-333333333333', version: '1', publishedVersion: null, publishState: 'draft_saved', updatedAt, title: 'New', bodyMd: '', authorLabel: 'ICAROS 팀', displayDate, attachments },
  ])
  assert.equal(calls[0]?.url, `${origin}/api/service/icaros/posts`)
  assert.equal(calls[0]?.init.method, 'GET')
  assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization, `Bearer ${token}`)
})

test('readDraft uses latest draft detail and returns null for missing UUID', async () => {
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: '팀', fetch: async (url) => {
    assert.equal(String(url), `${origin}/api/service/icaros/posts/${postId}/draft`)
    return Response.json({ revision: { id: postId, version: 2, publishedVersion: 2, forumPostId: forumId, updatedAt }, draft: { category: 'ICAROS', title: 'Title', content: 'Body', displayDate, attachments } })
  } })
  assert.deepEqual(await adapter.readDraft(postId), { id: postId, version: '2', publishedVersion: '2', publishState: 'published', updatedAt, title: 'Title', bodyMd: 'Body', authorLabel: '팀', displayDate, attachments })
  const missing = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: '팀', fetch: async () => new Response(null, { status: 404 }) })
  assert.equal(await missing.readDraft(postId), null)
})

test('draft reads fail closed on malformed upstream metadata and invalid id', async () => {
  const adapter = createEssentiaPostsAdapter({ origin, token, category: 'ICAROS', authorLabel: '팀', fetch: async () => Response.json([{ id: postId, version: 2, publishedVersion: 3, title: 'Bad', content: '', category: 'ICAROS', forumPostId: forumId }]) })
  await assert.rejects(adapter.listDrafts())
  await assert.rejects(adapter.readDraft('not-a-uuid'))
})

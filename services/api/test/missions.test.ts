import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseContentWrite } from '../src/content/validate.js'
import { createPostgresContentRepository } from '../src/adapters/postgres-content.js'
import { createContentReaders } from '../src/adapters/content-readers.js'
import { createHttpHandler } from '../src/http.js'

const id = 'aaad326c-74de-4bd2-a3f9-6869cde0b83f'
const version = '2026-09-30T08:12:13.123456Z'
const fields = { title: '첫 발사', launchDate: '2026-07-18', vehicleId: null,
  location: '알뜨르', outcome: 'success', summary: '회수 성공', bodyMd: '기록', coverMediaId: null, published: false }

test('mission validation accepts exact CMS fields and real ISO dates', () => {
  assert.ok(parseContentWrite({ operation: 'create', entity: 'mission', id, fields }))
  assert.ok(parseContentWrite({ operation: 'update', entity: 'mission', id, version, fields: { outcome: 'partial' } }))
  assert.ok(parseContentWrite({ operation: 'delete', entity: 'mission', id, version }))
  for (const launchDate of ['2026-02-30', '2026-2-03', '2026-13-01', '2026-01-01T00:00:00Z']) {
    assert.equal(parseContentWrite({ operation: 'create', entity: 'mission', id, fields: { ...fields, launchDate } }), null)
  }
  assert.equal(parseContentWrite({ operation: 'create', entity: 'mission', id, fields: { ...fields, outcome: 'unknown' } }), null)
  assert.equal(parseContentWrite({ operation: 'create', entity: 'mission', id, fields: { ...fields, extra: 1 } }), null)
  for (const change of [
    { title: 'x'.repeat(201) }, { location: 'x'.repeat(201) }, { summary: 'x'.repeat(1001) },
    { vehicleId: 'not a rocket id' },
  ]) assert.equal(parseContentWrite({ operation: 'create', entity: 'mission', id, fields: { ...fields, ...change } }), null)
  assert.ok(parseContentWrite({ operation: 'create', entity: 'mission', id,
    fields: { ...fields, vehicleId: 'icx-1', summary: '', bodyMd: '' } }))
  assert.equal(parseContentWrite({ operation: 'create', entity: 'mission', id,
    fields: { ...fields, published: true, summary: '' } }), null)
  assert.equal(parseContentWrite({ operation: 'create', entity: 'mission', id,
    fields: { ...fields, published: true, bodyMd: '' } }), null)
  assert.equal(parseContentWrite({ operation: 'update', entity: 'mission', id, version,
    fields: { published: true } }), null)
  assert.ok(parseContentWrite({ operation: 'update', entity: 'mission', id, version,
    fields: { published: false, summary: '', bodyMd: '' } }))
})

test('mission SQL maps fields, reads, lists by launch date descending, and writes by version', async () => {
  const queries: { text: string; values?: readonly unknown[] }[] = []
  const row = { id, title: fields.title, launch_date: new Date('2026-08-17T00:00:00+09:00'),
    launch_date_text: '2026-08-17', vehicle_id: null,
    location: fields.location, outcome: fields.outcome, summary: fields.summary, body_md: fields.bodyMd,
    cover_media_id: null, published: false, updated_at: new Date('2026-09-30T08:12:13Z'), version }
  const repo = createPostgresContentRepository({ async query(text, values) {
    queries.push({ text, ...(values ? { values } : {}) })
    return { rows: text.startsWith('delete') ? [{ id }] : [row] }
  } })
  assert.equal(row.launch_date.toISOString().slice(0, 10), '2026-08-16')
  assert.equal((await repo.read('mission', id))?.launchDate, '2026-08-17')
  assert.match(queries[0]!.text, /launch_date::text as launch_date_text/)
  assert.equal((await repo.list('mission'))[0]?.launchDate, '2026-08-17')
  const readers = createContentReaders(repo)
  const list = await readers.contentReader.read('missions') as Record<string, unknown>[]
  assert.equal(list[0]?.launchDate, '2026-08-17')
  assert.match(queries[1]!.text, /launch_date::text as launch_date_text/)
  assert.match(queries[1]!.text, /from icaros\.missions order by launch_date desc, id/)
  assert.equal((await readers.contentRecordReader.read('missions', id) as Record<string, unknown>).vehicleId, null)
  await repo.create({ operation: 'create', entity: 'mission', id, fields })
  assert.match(queries[4]!.text, /insert into icaros\.missions \(id, title, launch_date, vehicle_id/)
  await repo.updateIfVersion({ operation: 'update', entity: 'mission', id, version, fields: { outcome: 'partial' } })
  assert.match(queries[5]!.text, /where id = \$1 and to_char\(updated_at.* = \$2 returning/)
  await repo.deleteIfVersion({ operation: 'delete', entity: 'mission', id, version })
  assert.match(queries[6]!.text, /delete from icaros\.missions/)
})

test('mission HTTP route remains guarded', async () => {
  const handler = createHttpHandler({
    async requireAdmin() { return null }, async assertLoginOrigin() { return false },
    async login() { throw new Error('unused') }, async logout() { throw new Error('unused') },
    async readContent() { throw new Error('unused') }, async writeContent() { throw new Error('unused') },
    async startPublish() { throw new Error('unused') }, async readPublish() { throw new Error('unused') },
    async retryPublish() { throw new Error('unused') }, async requireBuildWorker() { return false },
    async finishPublish() { throw new Error('unused') },
  })
  const response = await handler({ rawPath: '/api/admin/content/missions', requestContext: { http: { method: 'GET' } } })
  assert.equal(response.statusCode, 403)
})

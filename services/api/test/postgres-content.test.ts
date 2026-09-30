import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPostgresContentRepository } from '../src/adapters/postgres-content.js'

test('create maps only declared columns and returns a microsecond version', async () => {
  const queries: { text: string; values: readonly unknown[] }[] = []
  const repo = createPostgresContentRepository({ async query(text, values = []) {
    queries.push({ text, values })
    return { rows: [{ id: 'rockets', version: '2026-09-30T00:00:00.000001Z' }] }
  } })
  assert.deepEqual(await repo.create({ operation: 'create', entity: 'vehicleType', id: 'rockets', fields: { label: 'Rockets', sortOrder: 2 } }),
    { status: 'saved', id: 'rockets', version: '2026-09-30T00:00:00.000001Z' })
  assert.match(queries[0]!.text, /insert into icaros\.vehicle_types/)
  assert.deepEqual(queries[0]!.values, ['rockets', 'Rockets', 2])
})

test('stale update returns conflict without overwriting the row', async () => {
  const repo = createPostgresContentRepository({ async query(text) {
    if (text.startsWith('update')) return { rows: [] }
    return { rows: [{ exists: true }] }
  } })
  assert.deepEqual(await repo.updateIfVersion({ operation: 'update', entity: 'department', id: '9c65b4ea-437f-48bb-9cec-22a47d906838', version: '2026-09-30T00:00:00.000001Z', fields: { name: 'New' } }), { status: 'conflict' })
})

test('delete distinguishes missing row from stale version', async () => {
  const repo = createPostgresContentRepository({ async query() { return { rows: [] } } })
  assert.deepEqual(await repo.deleteIfVersion({ operation: 'delete', entity: 'rocket', id: 'icx1', version: '2026-09-30T00:00:00.000001Z' }), { status: 'not_found' })
})

test('read exposes CMS field names and version from the existing schema', async () => {
  const repo = createPostgresContentRepository({ async query() {
    return { rows: [{ id: 'icx1', name: 'ICX-1', series: 'A', description_md: null,
      cover_media_id: null, max_altitude_m: null, size_m: null, payload_kg: null,
      published: true, sort_order: 0, updated_at: new Date('2026-09-30T00:00:00Z'),
      version: '2026-09-30T00:00:00.000001Z' }] }
  } })
  const row = await repo.read('rocket', 'icx1')
  assert.equal(row?.descriptionMd, null)
  assert.equal(row?.version, '2026-09-30T00:00:00.000001Z')
  assert.equal(row?.published, true)
})

test('update compares the original version in the same SQL statement', async () => {
  const queries: string[] = []
  const repo = createPostgresContentRepository({ async query(text) {
    queries.push(text)
    return { rows: [{ id: 'A', version: '2026-09-30T00:00:00.000002Z' }] }
  } })
  await repo.updateIfVersion({ operation: 'update', entity: 'rocketSeries', id: 'A',
    version: '2026-09-30T00:00:00.000001Z', fields: { label: 'Series A' } })
  assert.match(queries[0]!, /where id = \$1 and to_char\(updated_at.* = \$2 returning/)
  assert.match(queries[0]!, /updated_at = greatest\(clock_timestamp\(\), updated_at \+ interval '1 microsecond'\)/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPostgresContentRepository } from '../src/adapters/postgres-content.js'
import { createContentReaders } from '../src/adapters/content-readers.js'
import type { ContentRoute } from '../src/http.js'

const version = '2026-09-30T00:00:00.000001Z'
const updated = new Date('2026-09-30T00:00:00.000Z')
const fixtures: Record<string, Record<string, unknown>> = {
  departments: { id: 'd1', name: '추진', sort_order: 1 },
  members: { id: 'm1', name: 'Member', role: 'Lead', squad: 'Flight', department_id: 'd1', school: null, bio_md: null, image_media_id: null, published: false, sort_order: 2 },
  'vehicle-types': { id: 'v1', label: 'Rocket', sort_order: 3 },
  'rocket-series': { id: 's1', label: 'Series', type_id: 'v1', description_md: null, sort_order: 4 },
  panels: { id: 'p1', media_id: 'media1', headline: 'Launch', eyebrow: null, body: null, cta_label: null, cta_href: null, focal_x: 0.5, focal_y: 0.6, scrim: 0.3, anchor: 'center', height: 'full', published: true, sort_order: 5 },
  rockets: { id: 'r1', name: 'ICX', series: 's1', description_md: null, cover_media_id: null, max_altitude_m: null, size_m: '1.25', payload_kg: '0.5', published: true, sort_order: 6 },
  site: { key: 'headline', value: 'Hello' },
}
const tables: Record<string, string> = { departments: 'departments', members: 'members', 'vehicle-types': 'vehicle_types', 'rocket-series': 'rocket_series', panels: 'page_panels', rockets: 'rockets', site: 'site_settings' }

test('all ICAROS routes map PG rows to CMS DTOs for lists and records', async () => {
  const queries: string[] = []
  const repo = createPostgresContentRepository({ async query(sql) {
    queries.push(sql)
    const route = Object.keys(tables).find(key => sql.includes(`icaros.${tables[key]}`))!
    return { rows: [{ ...fixtures[route], version, updated_at: updated }] }
  } })
  const readers = createContentReaders(repo)
  for (const [route, source] of Object.entries(fixtures)) {
    const id = String(source.id ?? source.key)
    const list = await readers.contentReader.read(route as ContentRoute) as Record<string, unknown>[]
    const record = await readers.contentRecordReader.read(route as ContentRoute, id) as Record<string, unknown>
    assert.deepEqual(list, [record])
    assert.equal(record.id, id)
    assert.equal(record.version, version)
    assert.equal(record.updatedAt, '2026-09-30T00:00:00.000Z')
    assert.equal(record.publishState, 'draft_saved')
    assert.equal(record.sortOrder, source.sort_order)
  }
  assert.equal(queries.length, 14)
  const rocket = await readers.contentRecordReader.read('rockets', 'r1') as Record<string, unknown>
  assert.equal(rocket.descriptionMd, '')
  assert.equal(rocket.maxAltitudeM, '')
  assert.equal(rocket.sizeM, '1.25')
  assert.equal(rocket.payloadKg, '0.5')
  assert.equal(rocket.coverMediaId, null)
  assert.equal((await readers.contentRecordReader.read('members', 'm1') as Record<string, unknown>).departmentId, 'd1')
})

test('missing record stays null and posts/media fail closed without upstream readers', async () => {
  const repo = createPostgresContentRepository({ async query() { return { rows: [] } } })
  const readers = createContentReaders(repo)
  assert.equal(await readers.contentRecordReader.read('rockets', 'missing'), null)
  for (const route of ['posts', 'media'] as const) {
    await assert.rejects(readers.contentReader.read(route), /unavailable/i)
    await assert.rejects(readers.contentRecordReader.read(route, 'x'), /unavailable/i)
  }
})

test('ESSENTIA draft reader owns post lists and individual reads', async () => {
  const repo = createPostgresContentRepository({ async query() { throw new Error('ICAROS DB must not read posts') } })
  const post = { id: 'post-1', version: '2', publishedVersion: null, title: '시험', bodyMd: '내용', authorLabel: 'ICAROS',
    displayDate: '2026-09-30', attachments: [], updatedAt: '2026-09-30T09:00:00Z', publishState: 'draft_saved' as const }
  const readers = createContentReaders(repo, {
    async listDrafts() { return [post] },
    async readDraft(id) { return id === post.id ? post : null },
  })
  assert.deepEqual(await readers.contentReader.read('posts'), [post])
  assert.deepEqual(await readers.contentRecordReader.read('posts', 'post-1'), post)
  assert.equal(await readers.contentRecordReader.read('posts', 'missing'), null)
  assert.deepEqual(await readers.postStateReader.read('post-1'), { published: false, authorLabel: 'ICAROS' })
})

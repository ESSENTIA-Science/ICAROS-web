import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPostgresMediaRecords } from '../src/adapters/postgres-media.js'

const id = 'aa477986-d294-4ae7-aadb-b9e5d4a5b2ae'
test('create persists declared size separately and returns UUID', async () => {
  const calls: { sql: string; values: readonly unknown[] }[] = []
  const records = createPostgresMediaRecords({ async query(sql, values = []) { calls.push({ sql, values }); return { rows: [{ id }] } } })
  assert.equal(await records.create({ bucket: 'bucket', key: 'icaros-web/media/x.webp', mime: 'image/webp', declaredSize: 100, status: 'pending', originalFilename: 'x.webp' }), id)
  assert.match(calls[0]!.sql, /declared_size/)
  assert.deepEqual(calls[0]!.values, ['bucket', 'icaros-web/media/x.webp', 'image/webp', 100, 'x.webp'])
})
test('find excludes deleted media and returns numeric declared size', async () => {
  const records = createPostgresMediaRecords({ async query() { return { rows: [{ id, bucket: 'bucket', key: 'icaros-web/media/x.webp', mime: 'image/webp', declared_size: '100', status: 'pending' }] } } })
  assert.equal((await records.find(id))?.declaredSize, 100)
})
test('ready uses pending compare and swap and stores measured size', async () => {
  const calls: string[] = []
  const records = createPostgresMediaRecords({ async query(sql) { calls.push(sql); return { rows: [] } } })
  assert.equal(await records.ready(id, 80, 'etag'), false)
  assert.match(calls[0]!, /status = 'pending'.*deleted_at is null/)
  assert.match(calls[0]!, /size = \$2/)
})
test('fail only changes pending, undeleted media', async () => {
  const calls: string[] = []
  const records = createPostgresMediaRecords({ async query(sql) { calls.push(sql); return { rows: [] } } })
  await records.fail(id)
  assert.match(calls[0]!, /status = 'pending'.*deleted_at is null/)
})

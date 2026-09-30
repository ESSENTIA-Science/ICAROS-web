import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPostgresPublicationRepository, createPostgresPublicationSource } from '../src/adapters/postgres-publication.js'

test('repository keeps the row lock through the callback and rolls back failures', async () => {
  const calls: string[] = []
  const pool = { async connect() { return { async query(sql: string) {
    calls.push(sql)
    return { rows: sql.includes('publication_state') ? [{ latest_version: null, published_version: null, active_job_id: null }] : [] }
  }, release() { calls.push('release') } } } }
  const repo = createPostgresPublicationRepository(pool)
  await repo.withLock(async session => { await session.getState(); calls.push('callback') })
  assert.deepEqual(calls.slice(0, 3), ['BEGIN', 'select latest_version, published_version, active_job_id from icaros.publication_state where id = 1 for update', 'select latest_version, published_version, active_job_id from icaros.publication_state where id = 1'])
  assert.deepEqual(calls.slice(-3), ['callback', 'COMMIT', 'release'])
  await assert.rejects(repo.withLock(async () => { throw new Error('failed') }), /failed/)
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'release'])
})

test('prepare checks record version and reuses an allocated version for the same key', async () => {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = []
  const pool = { async connect() { return { async query(sql: string, params: readonly unknown[] = []) {
    calls.push({ sql, params })
    if (sql.includes('publication_allocations where idempotency_key')) return { rows: params[0] === 'key' && calls.filter(c => c.sql.startsWith('insert into icaros.publication_allocations')).length ? [{ version: '1', kind: 'rockets', record_id: 'r', record_version: '2026-09-30T00:00:00.000001Z', source_revision: 'sha' }] : [] }
    if (sql.includes('from icaros.rockets')) return { rows: [{ version: '2026-09-30T00:00:00.000001Z' }] }
    if (sql.includes('publication_counter')) return { rows: [{ version: '1' }] }
    return { rows: [] }
  }, release() {} } } }
  const source = createPostgresPublicationSource(pool, 'sha')
  assert.deepEqual(await source.prepare({ kind: 'rockets', id: 'r', recordVersion: '2026-09-30T00:00:00.000001Z', idempotencyKey: 'key' }), { version: 1, sourceRevision: 'sha' })
  assert.deepEqual(await source.prepare({ kind: 'rockets', id: 'r', recordVersion: '2026-09-30T00:00:00.000001Z', idempotencyKey: 'key' }), { version: 1, sourceRevision: 'sha' })
  assert.equal(calls.filter(c => c.sql.includes('update icaros.publication_counter')).length, 1)
  await assert.rejects(source.prepare({ kind: 'rockets', id: 'r', recordVersion: '2026-09-30T00:00:00.000002Z', idempotencyKey: 'other' }), /VERSION_CONFLICT/)
})

test('published ESSENTIA revision allocates a site version without touching public schema', async () => {
  const calls: string[] = []
  const pool = { async connect() { return { async query(sql: string) {
    calls.push(sql)
    if (sql.includes('publication_allocations where idempotency_key')) return { rows: [] }
    if (sql.includes('publication_counter')) return { rows: [{ version: '7' }] }
    return { rows: [] }
  }, release() {} } } }
  const source = createPostgresPublicationSource(pool, 'revision')
  assert.deepEqual(await source.prepare({ kind: 'posts', id: 'post-id', recordVersion: '3', idempotencyKey: 'post-key' }),
    { version: 7, sourceRevision: 'revision' })
  assert.equal(calls.some(sql => sql.includes('from public.') || sql.includes('from icaros.posts')), false)
  assert.equal(calls.some(sql => sql.startsWith('insert into icaros.publication_allocations')), true)
})

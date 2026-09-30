import test from 'node:test'
import assert from 'node:assert/strict'
import { createPostgresDonationRepository } from '../src/adapters/postgres-donation.js'

test('donation settings update as one versioned transaction', async () => {
  const values = new Map([['donation.round_label', '1차'], ['donation.goal', '100'], ['donation.current', '10']])
  const writes: string[] = []
  const client = {
    async query(sql: string, params?: readonly unknown[]) {
      if (sql.startsWith('select key')) return { rows: [...values].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value, updated_at: '2026-01-01' })) }
      if (sql.startsWith('update')) { values.set(params![0] as string, params![1] as string); writes.push(params![0] as string) }
      return { rows: [] }
    }, release() {},
  }
  const repo = createPostgresDonationRepository({ async connect() { return client } })
  const before = await repo.read()
  assert.equal(before.amount, 10)
  assert.equal(await repo.update('stale', { roundLabel: '2차', goal: 200, amount: 20 }), null)
  assert.equal(writes.length, 0)
  const after = await repo.update(before.version, { roundLabel: '2차', goal: 200, amount: 20 })
  assert.equal(after?.roundLabel, '2차')
  assert.equal(after?.goal, 200)
  assert.equal(writes.length, 3)
})

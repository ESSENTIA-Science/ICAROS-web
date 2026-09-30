import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDepartmentService, type DepartmentTransaction } from '../src/departments.js'

const SOURCE = '11111111-1111-4111-8111-111111111111'
const DESTINATION = '22222222-2222-4222-8222-222222222222'

test('department deletion checks auth before opening a transaction', async () => {
  let transactions = 0
  const service = createDepartmentService({
    async requireAdmin() { return false },
    repository: { async transaction() { transactions++; throw new Error('must not run') } },
  })
  assert.deepEqual(await service.delete({}, { id: SOURCE, version: 'v1' }), { ok: false, code: 'DENIED' })
  assert.equal(transactions, 0)
})

test('populated department requires explicit destination or unassigned choice', async () => {
  const calls: string[] = []
  const tx: DepartmentTransaction = {
    async lockDepartment() { calls.push('lock'); return { version: 'v1' } },
    async countMembers() { calls.push('count'); return 2 },
    async departmentExists() { calls.push('destination'); return true },
    async reassignMembers(_from, to) { calls.push(`reassign:${to ?? 'unassigned'}`) },
    async deleteIfVersion() { calls.push('delete'); return true },
  }
  const service = createDepartmentService({
    async requireAdmin() { return true },
    repository: { async transaction(work) { return work(tx) } },
  })
  assert.deepEqual(await service.delete({}, { id: SOURCE, version: 'v1' }),
    { ok: false, code: 'DEPARTMENT_HAS_MEMBERS', memberCount: 2 })
  assert.deepEqual(calls, ['lock', 'count'])
  calls.length = 0
  assert.deepEqual(await service.delete({}, { id: SOURCE, version: 'v1', reassignTo: DESTINATION }),
    { ok: true, reassigned: 2 })
  assert.deepEqual(calls, ['lock', 'count', 'destination', `reassign:${DESTINATION}`, 'delete'])
  calls.length = 0
  assert.deepEqual(await service.delete({}, { id: SOURCE, version: 'v1', reassignTo: null }),
    { ok: true, reassigned: 2 })
  assert.deepEqual(calls, ['lock', 'count', 'reassign:unassigned', 'delete'])
})

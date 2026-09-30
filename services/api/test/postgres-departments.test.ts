import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDepartmentService } from '../src/departments.js'
import { createPostgresDepartmentRepository } from '../src/adapters/postgres-departments.js'

const SOURCE = '11111111-1111-4111-8111-111111111111'
const TARGET = '22222222-2222-4222-8222-222222222222'
const VERSION = '2026-09-30T00:00:00.000001Z'

test('reassignment mirrors destination name, advances member versions, and commits on one connection', async () => {
  const calls: { sql: string; params: readonly unknown[] | undefined }[] = []
  let released = false
  const repository = createPostgresDepartmentRepository({ async connect() {
    return { async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('from icaros.departments') && sql.includes('for update')) return { rows: [{ version: VERSION }] }
      if (sql.includes('from icaros.members')) return { rows: [{ id: 'member-1' }, { id: 'member-2' }] }
      if (sql.includes('for key share')) return { rows: [{ id: TARGET }] }
      if (sql.startsWith('delete')) return { rows: [{ id: SOURCE }] }
      return { rows: [] }
    }, release() { released = true } }
  } })
  const service = createDepartmentService({ async requireAdmin() { return true }, repository })
  assert.deepEqual(await service.delete({}, { id: SOURCE, version: VERSION, reassignTo: TARGET }),
    { ok: true, reassigned: 2 })
  assert.equal(calls[0]?.sql, 'BEGIN')
  assert.equal(calls.at(-1)?.sql, 'COMMIT')
  assert.equal(released, true)
  const update = calls.find((call) => call.sql.startsWith('update icaros.members'))
  assert.match(update!.sql, /squad = destination.name/)
  assert.match(update!.sql, /updated_at = greatest\(clock_timestamp\(\), m.updated_at \+ interval '1 microsecond'\)/)
  assert.deepEqual(update!.params, [SOURCE, TARGET])
})

test('unassignment clears squad and a failed delete rolls the transaction back', async () => {
  const statements: string[] = []
  let released = false
  const repository = createPostgresDepartmentRepository({ async connect() {
    return { async query(sql) {
      statements.push(sql)
      if (sql.includes('from icaros.departments') && sql.includes('for update')) return { rows: [{ version: VERSION }] }
      if (sql.includes('from icaros.members')) return { rows: [{ id: 'member-1' }] }
      if (sql.startsWith('delete')) return { rows: [] }
      return { rows: [] }
    }, release() { released = true } }
  } })
  const service = createDepartmentService({ async requireAdmin() { return true }, repository })
  assert.deepEqual(await service.delete({}, { id: SOURCE, version: VERSION, reassignTo: null }),
    { ok: false, code: 'UNAVAILABLE' })
  assert.ok(statements.some((sql) => /set department_id = null, squad = null/.test(sql)))
  assert.equal(statements.at(-1), 'ROLLBACK')
  assert.equal(released, true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createVehicleMediaRepository } from '../src/adapters/vehicle-media.js'

const rocket = 'icx1'
const image = '123e4567-e89b-42d3-a456-426614174000'
const glb = '123e4567-e89b-42d3-a456-426614174001'
test('gallery requires a matching version and only confirmed, non-cover image media', async () => {
  let attached = false
  const queries: string[] = []
  const client = {
    async query(sql: string) {
      queries.push(sql)
      if (sql.includes('from icaros.rockets where id')) return { rows: [{ id: rocket }] }
      if (sql.includes('from icaros.media m') && sql.includes('order by')) return { rows: attached ? [{ id: image, created_at: new Date() }] : [] }
      if (sql.includes('select value from icaros.site_settings')) return { rows: attached ? [{ value: image }] : [] }
      if (sql.includes('for update of m')) return { rows: [{ id: image }] }
      if (sql.includes('update icaros.media m')) return { rows: [] }
      if (sql.includes('update icaros.media set')) { attached = true; return { rows: [] } }
      return { rows: [] }
    }, release() {},
  }
  const repo = createVehicleMediaRepository({ async connect() { return client } })
  const before = await repo.readGallery(rocket)
  assert.deepEqual(before.mediaIds, [])
  assert.equal(await repo.saveGallery(rocket, 'stale', { mediaIds: [image] }), null)
  assert.equal(queries.some(sql => sql.includes('update icaros.media')), false)
  const after = await repo.saveGallery(rocket, before.version, { mediaIds: [image] })
  assert.deepEqual(after?.mediaIds, [image])
  assert.notEqual(after?.version, before.version)
  assert.ok(queries.some(sql => sql.includes('m.id is distinct from r.cover_media_id')))
  await assert.rejects(repo.saveGallery(rocket, after!.version, { mediaIds: ['bad'] }), TypeError)
})

test('model checks ready GLB and rejects a stale version', async () => {
  const queries: string[] = []
  const client = {
    async query(sql: string) {
      queries.push(sql)
      if (sql.includes('from icaros.rockets where id')) return { rows: [{ id: rocket }] }
      if (sql.includes('from icaros.rocket_models')) return { rows: [] }
      if (sql.includes('from icaros.media where id')) return { rows: [{ id: glb }] }
      return { rows: [] }
    }, release() {},
  }
  const repo = createVehicleMediaRepository({ async connect() { return client } })
  const before = await repo.readModel(rocket)
  assert.equal(before.modelMediaId, null)
  assert.equal(await repo.saveModel(rocket, 'stale', { modelMediaId: glb }), null)
  await repo.saveModel(rocket, before.version, { modelMediaId: glb })
  assert.ok(queries.some(sql => sql.includes('mime = $2') && sql.includes("status = 'ready'")))
  assert.ok(queries.some(sql => sql.includes('insert into icaros.rocket_models')))
})

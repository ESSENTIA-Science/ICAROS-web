import { createHash } from 'node:crypto'

type Client = { query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(): void }
type Pool = { connect(): Promise<Client> }
type Gallery = { id: string; version: string; mediaIds: string[] }
type Model = { id: string; version: string; modelMediaId: string | null; posterMediaId: string | null }
const version = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const rocketId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

async function rows(client: Client, id: string) {
  const result = await client.query(`select m.id, m.created_at from icaros.media m
    join icaros.rockets r on r.id = $1
    where m.entity_type = 'rocket' and m.entity_id = $1 and m.status = 'ready' and m.deleted_at is null
    and m.mime like 'image/%' and m.id is distinct from r.cover_media_id order by m.created_at, m.id`, [id])
  const setting = (await client.query('select value from icaros.site_settings where key = $1', [`rocket.${id}.gallery`])).rows[0]?.value
  const order = typeof setting === 'string' ? setting.split(',').filter(Boolean) : []
  const ids = result.rows.map(item => item.id as string)
  ids.sort((a, b) => {
    const ai = order.indexOf(a); const bi = order.indexOf(b)
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi)
  })
  return { ids, setting }
}
async function modelRow(client: Client, id: string) {
  return (await client.query(`select id, glb_media_id, poster_media_id, updated_at
    from icaros.rocket_models where rocket_id = $1 order by updated_at desc, id limit 1`, [id])).rows[0]
}
function gallery(id: string, state: Awaited<ReturnType<typeof rows>>): Gallery {
  return { id, version: version([state.ids, state.setting]), mediaIds: state.ids }
}
function model(id: string, row: Record<string, unknown> | undefined): Model {
  return { id, version: version(row ? [row.id, row.glb_media_id, row.poster_media_id, row.updated_at] : null),
    modelMediaId: typeof row?.glb_media_id === 'string' ? row.glb_media_id : null,
    posterMediaId: typeof row?.poster_media_id === 'string' ? row.poster_media_id : null }
}
async function transaction<T>(pool: Pool, id: string, work: (client: Client) => Promise<T>): Promise<T> {
  if (!rocketId.test(id)) throw new TypeError('Invalid rocket id')
  const client = await pool.connect()
  try {
    await client.query('begin')
    const rocket = (await client.query('select id from icaros.rockets where id = $1 for update', [id])).rows[0]
    if (!rocket) throw new Error('Vehicle not found')
    const value = await work(client)
    await client.query('commit')
    return value
  } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
}
export function createVehicleMediaRepository(pool: Pool) {
  return {
    async readGallery(id: string): Promise<Gallery> {
      return transaction(pool, id, async client => gallery(id, await rows(client, id)))
    },
    async readModel(id: string): Promise<Model> {
      return transaction(pool, id, async client => model(id, await modelRow(client, id)))
    },
    async saveGallery(id: string, expected: string, body: unknown): Promise<Gallery | null> {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Invalid gallery')
      const input = body as Record<string, unknown>
      if (Object.keys(input).length !== 1 || !Array.isArray(input.mediaIds) || input.mediaIds.length > 50 ||
        input.mediaIds.some(value => typeof value !== 'string' || !uuid.test(value)) ||
        new Set(input.mediaIds).size !== input.mediaIds.length) throw new TypeError('Invalid gallery')
      const ids = input.mediaIds as string[]
      return transaction(pool, id, async client => {
        const current = gallery(id, await rows(client, id))
        if (current.version !== expected) return null
        if (ids.length) {
          const valid = (await client.query(`select m.id from icaros.media m join icaros.rockets r on r.id = $2
            where m.id = any($1::uuid[]) and m.status = 'ready' and m.deleted_at is null and m.mime like 'image/%'
            and m.id is distinct from r.cover_media_id
            and (m.entity_type is null or (m.entity_type = 'rocket' and m.entity_id = $2)) for update of m`, [ids, id])).rows
          if (valid.length !== ids.length) throw new TypeError('Invalid gallery media')
        }
        await client.query(`update icaros.media m set entity_type = null, entity_id = null
          from icaros.rockets r where r.id = $1 and m.entity_type = 'rocket' and m.entity_id = $1
          and m.mime like 'image/%' and m.id is distinct from r.cover_media_id
          and m.id <> all($2::uuid[])`, [id, ids])
        if (ids.length) await client.query(`update icaros.media set entity_type = 'rocket', entity_id = $2 where id = any($1::uuid[])`, [ids, id])
        await client.query(`insert into icaros.site_settings (key, value) values ($1, $2)
          on conflict (key) do update set value = excluded.value, updated_at = clock_timestamp()`, [`rocket.${id}.gallery`, ids.join(',')])
        await client.query(`update icaros.rockets set updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond') where id = $1`, [id])
        return gallery(id, await rows(client, id))
      })
    },
    async saveModel(id: string, expected: string, body: unknown): Promise<Model | null> {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Invalid model')
      const input = body as Record<string, unknown>
      if (!Object.hasOwn(input, 'modelMediaId') || Object.keys(input).some(key => !['modelMediaId', 'posterMediaId'].includes(key)) ||
        (input.modelMediaId !== null && (typeof input.modelMediaId !== 'string' || !uuid.test(input.modelMediaId))) ||
        (input.posterMediaId !== undefined && input.posterMediaId !== null &&
          (typeof input.posterMediaId !== 'string' || !uuid.test(input.posterMediaId)))) throw new TypeError('Invalid model')
      return transaction(pool, id, async client => {
        const row = await modelRow(client, id)
        if (model(id, row).version !== expected) return null
        for (const [mediaId, mime] of [[input.modelMediaId, 'model/gltf-binary'], [input.posterMediaId, 'image/webp']]) {
          if (mediaId == null) continue
          const found = (await client.query(`select id from icaros.media where id = $1 and mime = $2
            and status = 'ready' and deleted_at is null for share`, [mediaId, mime])).rows[0]
          if (!found) throw new TypeError('Invalid model media')
        }
        if (row) await client.query(`update icaros.rocket_models set glb_media_id = $2, poster_media_id = $3,
          updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond') where id = $1`,
          [row.id, input.modelMediaId, input.posterMediaId ?? null])
        else await client.query(`insert into icaros.rocket_models (rocket_id, label, glb_media_id, poster_media_id)
          values ($1, $2, $3, $4)`, [id, id, input.modelMediaId, input.posterMediaId ?? null])
        await client.query(`update icaros.rockets set updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond') where id = $1`, [id])
        return model(id, await modelRow(client, id))
      })
    },
  }
}

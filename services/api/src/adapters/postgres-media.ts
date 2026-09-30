import type { MediaDependencies, MediaRecord } from '../media/index.js'

export interface MediaSqlClient {
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

type Records = MediaDependencies['records']
function declaredSize(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw new TypeError('Invalid declared media size')
  return number
}

export function createPostgresMediaRecords(db: MediaSqlClient): Records {
  return {
    async create(row) {
      const result = await db.query(`insert into icaros.media (bucket, key, mime, declared_size, original_filename, status)
        values ($1, $2, $3, $4, $5, 'pending') returning id`,
      [row.bucket, row.key, row.mime, row.declaredSize, row.originalFilename])
      const id = result.rows[0]?.id
      if (typeof id !== 'string') throw new Error('Media insert returned no id')
      return id
    },
    async find(id) {
      const row = (await db.query(`select id, bucket, key, mime, declared_size, status
        from icaros.media where id = $1 and deleted_at is null`, [id])).rows[0]
      if (!row) return null
      return { id: row.id as string, bucket: row.bucket as string, key: row.key as string,
        mime: row.mime as string, declaredSize: declaredSize(row.declared_size), status: row.status as MediaRecord['status'] }
    },
    async ready(id, size, etag) {
      const result = await db.query(`update icaros.media set status = 'ready', size = $2, etag = $3
        where id = $1 and status = 'pending' and deleted_at is null returning id`, [id, size, etag])
      return result.rows.length > 0
    },
    async fail(id) {
      await db.query(`update icaros.media set status = 'failed'
        where id = $1 and status = 'pending' and deleted_at is null`, [id])
    },
  }
}

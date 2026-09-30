import type { ContentRoute } from '../http.js'
import { PublicationError, type PublicationJob, type PublicationRepository, type PublicationState } from '../publish/index.js'

export interface PublicationSqlClient {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  release(): void
}
export interface PublicationSqlPool { connect(): Promise<PublicationSqlClient> }

async function transaction<T>(pool: PublicationSqlPool, work: (client: PublicationSqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    committed = true
    return result
  } catch (error) {
    if (!committed) try { await client.query('ROLLBACK') } catch { /* Preserve original error. */ }
    throw error
  } finally { client.release() }
}

const stateColumns = 'latest_version, published_version, active_job_id'
const jobColumns = 'id, idempotency_key, version, snapshot_ref, snapshot_sha256, source_revision, attempt, status, error'
function integer(value: unknown): number {
  const result = typeof value === 'string' ? Number(value) : value
  if (typeof result !== 'number' || !Number.isSafeInteger(result)) throw new TypeError('Invalid publication version')
  return result
}
function nullableInteger(value: unknown): number | null { return value === null ? null : integer(value) }
function state(row: Record<string, unknown> | undefined): PublicationState {
  if (!row) throw new Error('Publication state missing')
  return { latestVersion: nullableInteger(row.latest_version), publishedVersion: nullableInteger(row.published_version), activeJobId: row.active_job_id as string | null }
}
function job(row: Record<string, unknown>): PublicationJob {
  return {
    id: row.id as string, idempotencyKey: row.idempotency_key as string, version: integer(row.version),
    snapshotRef: row.snapshot_ref as string, snapshotSha256: row.snapshot_sha256 as string,
    sourceRevision: row.source_revision as string, attempt: integer(row.attempt),
    status: row.status as PublicationJob['status'], error: row.error as string | null,
  }
}

export function createPostgresPublicationRepository(pool: PublicationSqlPool): PublicationRepository {
  return { withLock: operation => transaction(pool, async client => {
    if ((await client.query(`select ${stateColumns} from icaros.publication_state where id = 1 for update`)).rows.length !== 1) throw new Error('Publication state missing')
    return operation({
      async getState() { return state((await client.query(`select ${stateColumns} from icaros.publication_state where id = 1`)).rows[0]) },
      async saveState(next) { await client.query('update icaros.publication_state set latest_version = $1, published_version = $2, active_job_id = $3 where id = 1', [next.latestVersion, next.publishedVersion, next.activeJobId]) },
      async getJob(id) { const row = (await client.query(`select ${jobColumns} from icaros.publication_jobs where id = $1`, [id])).rows[0]; return row ? job(row) : null },
      async getByKey(key) { const row = (await client.query(`select ${jobColumns} from icaros.publication_jobs where idempotency_key = $1`, [key])).rows[0]; return row ? job(row) : null },
      async listJobs() { return (await client.query(`select ${jobColumns} from icaros.publication_jobs order by version`)).rows.map(job) },
      async saveJob(next) { await client.query(`insert into icaros.publication_jobs (${jobColumns}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (id) do update set attempt = excluded.attempt, status = excluded.status, error = excluded.error`,
        [next.id, next.idempotencyKey, next.version, next.snapshotRef, next.snapshotSha256, next.sourceRevision, next.attempt, next.status, next.error]) },
    })
  }) }
}

const recordTables: Partial<Record<ContentRoute, { table: string; key: string }>> = {
  missions: { table: 'missions', key: 'id' }, rockets: { table: 'rockets', key: 'id' }, site: { table: 'site_settings', key: 'key' },
  departments: { table: 'departments', key: 'id' }, members: { table: 'members', key: 'id' },
  'vehicle-types': { table: 'vehicle_types', key: 'id' }, 'rocket-series': { table: 'rocket_series', key: 'id' },
  panels: { table: 'page_panels', key: 'id' }, media: { table: 'media', key: 'id' },
}
const versionSql = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const versionPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
export function createPostgresPublicationSource(pool: PublicationSqlPool, sourceRevision: string) {
  if (!sourceRevision.trim() || sourceRevision.length > 200) throw new TypeError('Invalid source revision')
  return { async prepare(input: { kind: ContentRoute; id: string; recordVersion: string; idempotencyKey: string }): Promise<{ version: number; sourceRevision: string }> {
    const target = recordTables[input.kind]
    const externalPost = input.kind === 'posts'
    if ((!target && !externalPost) || !input.id ||
        !(externalPost ? /^[1-9]\d*$/.test(input.recordVersion) : versionPattern.test(input.recordVersion)) ||
        !input.idempotencyKey.trim() || input.idempotencyKey.length > 200)
      throw new PublicationError('INVALID_INPUT')
    return transaction(pool, async client => {
      await client.query('select version from icaros.publication_counter where id = 1 for update')
      const existing = (await client.query('select version, kind, record_id, record_version, source_revision from icaros.publication_allocations where idempotency_key = $1', [input.idempotencyKey])).rows[0]
      if (existing) {
        if (existing.kind !== input.kind || existing.record_id !== input.id || existing.record_version !== input.recordVersion || existing.source_revision !== sourceRevision)
          throw new PublicationError('IDEMPOTENCY_CONFLICT')
        return { version: integer(existing.version), sourceRevision: existing.source_revision as string }
      }
      if (!externalPost && target) {
        const record = (await client.query(`select ${versionSql} as version from icaros.${target.table} where ${target.key} = $1 for share`, [input.id])).rows[0]
        if (!record || record.version !== input.recordVersion) throw new PublicationError('VERSION_CONFLICT')
      }
      const allocated = (await client.query('update icaros.publication_counter set version = version + 1 where id = 1 returning version')).rows[0]
      if (!allocated) throw new Error('Publication counter missing')
      const version = integer(allocated.version)
      await client.query('insert into icaros.publication_allocations (idempotency_key, version, kind, record_id, record_version, source_revision) values ($1,$2,$3,$4,$5,$6)',
        [input.idempotencyKey, version, input.kind, input.id, input.recordVersion, sourceRevision])
      return { version, sourceRevision }
    })
  } }
}

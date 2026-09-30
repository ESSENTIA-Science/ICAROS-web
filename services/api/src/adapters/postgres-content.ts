import type { ContentEntity, ContentRepository, ContentFields, RepositoryResult } from '../content/types.js'

export interface SqlClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

const tables: Record<ContentEntity, string> = {
  mission: 'missions', siteSetting: 'site_settings', rocket: 'rockets', member: 'members', panel: 'page_panels',
  department: 'departments', vehicleType: 'vehicle_types', rocketSeries: 'rocket_series',
}
const columns: Record<ContentEntity, Readonly<Record<string, string>>> = {
  mission: { title: 'title', launchDate: 'launch_date', vehicleId: 'vehicle_id', location: 'location', outcome: 'outcome', summary: 'summary', bodyMd: 'body_md', coverMediaId: 'cover_media_id', published: 'published' },
  siteSetting: { value: 'value' },
  rocket: { name: 'name', series: 'series', descriptionMd: 'description_md', coverMediaId: 'cover_media_id', maxAltitudeM: 'max_altitude_m', sizeM: 'size_m', payloadKg: 'payload_kg', published: 'published', sortOrder: 'sort_order' },
  member: { name: 'name', role: 'role', squad: 'squad', departmentId: 'department_id', school: 'school', bioMd: 'bio_md', imageMediaId: 'image_media_id', published: 'published', sortOrder: 'sort_order' },
  panel: { mediaId: 'media_id', headline: 'headline', eyebrow: 'eyebrow', body: 'body', ctaLabel: 'cta_label', ctaHref: 'cta_href', focalX: 'focal_x', focalY: 'focal_y', scrim: 'scrim', anchor: 'anchor', height: 'height', published: 'published', sortOrder: 'sort_order' },
  department: { name: 'name', sortOrder: 'sort_order' },
  vehicleType: { label: 'label', sortOrder: 'sort_order' },
  rocketSeries: { label: 'label', typeId: 'type_id', descriptionMd: 'description_md', sortOrder: 'sort_order' },
}
const versionSql = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const versionPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

function mapped(entity: ContentEntity, fields: ContentFields): [string, unknown][] {
  return Object.entries(fields).map(([key, value]) => {
    const column = columns[entity][key]
    if (!column) throw new TypeError(`Unknown ${entity} field`)
    return [column, value]
  })
}

function record(entity: ContentEntity, row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { id: row.id ?? row.key, version: row.version, updatedAt: row.updated_at }
  for (const [field, column] of Object.entries(columns[entity])) {
    if (entity === 'mission' && field === 'launchDate') {
      if (typeof row.launch_date_text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.launch_date_text))
        throw new TypeError('Invalid mission launch date')
      result[field] = row.launch_date_text
    } else result[field] = row[column]
  }
  return result
}

function saved(row: Record<string, unknown>): RepositoryResult {
  if (typeof row.id !== 'string' || typeof row.version !== 'string') throw new TypeError('Invalid database result')
  return { status: 'saved', id: row.id, version: row.version }
}

function unique(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export function createPostgresContentRepository(db: SqlClient): ContentRepository & {
  read(entity: ContentEntity, id: string): Promise<Record<string, unknown> | null>
  list(entity: ContentEntity): Promise<Record<string, unknown>[]>
} {
  async function missingOrConflict(entity: ContentEntity, id: string): Promise<RepositoryResult> {
    const key = entity === 'siteSetting' ? 'key' : 'id'
    const result = await db.query(`select true as exists from icaros.${tables[entity]} where ${key} = $1`, [id])
    return result.rows.length ? { status: 'conflict' } : { status: 'not_found' }
  }
  return {
    async read(entity, id) {
      const key = entity === 'siteSetting' ? 'key' : 'id'
      const result = await db.query(`select *, ${versionSql} as version${entity === 'mission' ? ', launch_date::text as launch_date_text' : ''} from icaros.${tables[entity]} where ${key} = $1`, [id])
      return result.rows[0] ? record(entity, result.rows[0]) : null
    },
    async list(entity) {
      const result = await db.query(`select *, ${versionSql} as version${entity === 'mission' ? ', launch_date::text as launch_date_text' : ''} from icaros.${tables[entity]} order by ${entity === 'siteSetting' ? 'key' : entity === 'mission' ? 'launch_date desc, id' : 'sort_order, id'}`)
      return result.rows.map((row) => record(entity, row))
    },
    async create(write) {
      const values = mapped(write.entity, write.fields)
      const key = write.entity === 'siteSetting' ? 'key' : 'id'
      const names = [key, ...values.map(([column]) => column)]
      try {
        const result = await db.query(`insert into icaros.${tables[write.entity]} (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')}) returning ${key} as id, ${versionSql} as version`, [write.id, ...values.map(([, value]) => value)])
        if (!result.rows[0]) throw new Error('Insert returned no row')
        return saved(result.rows[0])
      } catch (error) {
        if (unique(error)) return { status: 'conflict' }
        throw error
      }
    },
    async updateIfVersion(write) {
      if (!versionPattern.test(write.version)) throw new TypeError('Invalid version')
      const values = mapped(write.entity, write.fields)
      if (!values.length) throw new TypeError('Empty update')
      const key = write.entity === 'siteSetting' ? 'key' : 'id'
      const assignments = values.map(([column], i) => `${column} = $${i + 3}`)
      assignments.push(`updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')`)
      const result = await db.query(`update icaros.${tables[write.entity]} set ${assignments.join(', ')} where ${key} = $1 and ${versionSql} = $2 returning ${key} as id, ${versionSql} as version`, [write.id, write.version, ...values.map(([, value]) => value)])
      return result.rows[0] ? saved(result.rows[0]) : missingOrConflict(write.entity, write.id)
    },
    async deleteIfVersion(write) {
      if (!versionPattern.test(write.version)) throw new TypeError('Invalid version')
      if (write.entity === 'siteSetting') throw new TypeError('Site settings cannot be deleted')
      const result = await db.query(`delete from icaros.${tables[write.entity]} where id = $1 and ${versionSql} = $2 returning id`, [write.id, write.version])
      return result.rows[0] ? { status: 'deleted', id: write.id } : missingOrConflict(write.entity, write.id)
    },
  }
}

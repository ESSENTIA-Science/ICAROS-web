import { createServer } from 'node:http'
import pg from 'pg'
import { spawn } from 'node:child_process'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createHttpHandler } from '../services/api/src/http.ts'
import { createPostgresContentRepository } from '../services/api/src/adapters/postgres-content.ts'
import { createContentReaders } from '../services/api/src/adapters/content-readers.ts'
import { createEssentiaPostsAdapter } from '../services/api/src/essentia/posts.ts'
import { createPostgresDonationRepository } from '../services/api/src/adapters/postgres-donation.ts'
import { createPostgresMediaRecords } from '../services/api/src/adapters/postgres-media.ts'
import { createS3MediaObjects } from '../services/api/src/adapters/s3-media.ts'
import { createMediaService } from '../services/api/src/media/index.ts'

// Local preview only. The production API remains fail-closed until durable adapters are wired.
const pool = new pg.Pool({
  connectionString: 'postgres://icaros:icaros_local_dev@127.0.0.1:5435/icaros',
  max: 2,
  connectionTimeoutMillis: 5000,
})
const serviceConfigured = ['ESSENTIA_SERVICE_ORIGIN', 'ESSENTIA_SERVICE_TOKEN', 'ESSENTIA_SERVICE_CATEGORY', 'ESSENTIA_AUTHOR_LABEL']
  .every((key) => Boolean(process.env[key]))
const servicePosts = serviceConfigured ? createEssentiaPostsAdapter({
  origin: process.env.ESSENTIA_SERVICE_ORIGIN,
  token: process.env.ESSENTIA_SERVICE_TOKEN,
  category: process.env.ESSENTIA_SERVICE_CATEGORY,
  authorLabel: process.env.ESSENTIA_AUTHOR_LABEL,
}) : null
const contentRepository = createPostgresContentRepository(pool)
const donation = createPostgresDonationRepository(pool)
const localS3 = process.env.S3_ENDPOINT === 'http://127.0.0.1:9010' &&
  process.env.S3_BUCKET === 'icaros-local' && process.env.S3_PREFIX === 'icaros-local'
const media = localS3 ? createMediaService({ bucket: 'icaros-local', prefix: 'icaros-local',
  records: createPostgresMediaRecords(pool), objects: createS3MediaObjects({
    bucket: 'icaros-local', prefix: 'icaros-local', endpoint: process.env.S3_ENDPOINT,
  }),
}) : null
const readers = createContentReaders(contentRepository, servicePosts)
const routeEntity = { rockets: 'rocket', site: 'siteSetting', missions: 'mission',
  departments: 'department', members: 'member', 'vehicle-types': 'vehicleType',
  'rocket-series': 'rocketSeries', panels: 'panel' }
const jobs = new Map()
let building = false
const origin = 'http://127.0.0.1:5175'
const credentials = JSON.parse(readFileSync('docs/.local/admin-login.json', 'utf8'))
const sessions = new Set()
function same(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}
const versionSql = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

async function record(route, id) {
  return readers.contentRecordReader.read(route, id)
}
function result(status, body) { return { status, body } }
async function rebuild(job) {
  if (building) throw new Error('Build already in progress')
  building = true
  try {
    const child = spawn('node', ['scripts/build-web-local.mjs'], { cwd: process.cwd(), stdio: 'inherit' })
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    if (code !== 0) throw new Error('Build failed')
    const promote = spawn('node', ['scripts/promote-web-local.mjs'], { cwd: process.cwd(), stdio: 'inherit' })
    const promoted = await new Promise((resolve, reject) => {
      promote.once('error', reject)
      promote.once('exit', resolve)
    })
    job.state = promoted === 0 ? 'published' : 'failed'
  } catch { job.state = 'failed' }
  finally { building = false }
}
const api = createHttpHandler({
  async presignMedia(body) { return media ? media.presign(body) : result(503, { ok: false, message: 'UNAVAILABLE' }) },
  async confirmMedia(body) { return media ? media.confirm(body) : result(503, { ok: false, message: 'UNAVAILABLE' }) },
  async requireAdmin(event, mutation) {
    if (mutation && event.headers?.origin !== origin) return null
    const cookies = event.headers?.cookie ?? ''
    const session = /(?:^|;\s*)icaros_local_session=([^;]+)/.exec(cookies)?.[1]
    if (!session || !sessions.has(session)) return null
    return { userId: 'local', email: 'local@localhost.invalid' }
  },
  async assertLoginOrigin(event) { return event.headers?.origin === origin },
  async login(_event, body) {
    if (!body || !same(body.email, credentials.email) || !same(body.password, credentials.password))
      return result(403, { ok: false, message: 'DENIED' })
    const token = randomUUID()
    sessions.add(token)
    return { ...result(200, { ok: true, data: { userId: 'local', email: credentials.email } }),
      cookie: `icaros_local_session=${token}; HttpOnly; SameSite=Lax; Path=/api/admin` }
  },
  async logout(event) {
    const token = /(?:^|;\s*)icaros_local_session=([^;]+)/.exec(event.headers?.cookie ?? '')?.[1]
    if (token) sessions.delete(token)
    return { ...result(200, { ok: true, data: {} }),
      cookie: 'icaros_local_session=; HttpOnly; SameSite=Lax; Path=/api/admin; Max-Age=0' }
  },
  async readContent(route) { return { ok: true, data: route === 'donation-rounds' ? [await donation.read()]
    : route === 'posts' && !servicePosts ? [] : await readers.contentReader.read(route) } },
  async createContent(route, body) {
    if (routeEntity[route] && body && typeof body === 'object' && !Array.isArray(body)) {
      const { id, ...fields } = body
      const saved = await contentRepository.create({ entity: routeEntity[route], id, fields })
      return saved.status === 'saved' ? result(200, { ok: true, data: await record(route, saved.id) })
        : result(409, { ok: false, message: 'CONFLICT' })
    }
    if (route !== 'posts' || !servicePosts) return result(503, { ok: false, message: 'UNAVAILABLE' })
    const saved = await servicePosts.create({ operation: 'create', ...body, published: false })
    if (saved.status !== 'saved') return result(409, { ok: false, message: 'CONFLICT' })
    return result(200, { ok: true, data: await record('posts', saved.id) })
  },
  async writeContent(route, id, version, body) {
    if (route === 'donation-rounds') {
      if (id !== 'current') return result(404, { ok: false, message: 'NOT_FOUND' })
      const saved = await donation.update(version, body)
      return saved ? result(200, { ok: true, data: saved }) : result(409, { ok: false, message: 'CONFLICT' })
    }
    if (route === 'posts' && servicePosts) {
      const saved = await servicePosts.update({ operation: 'update', id, version, ...body,
        idempotencyKey: randomUUID(), published: false })
      return saved.status === 'saved' ? result(200, { ok: true, data: await record(route, id) })
        : result(409, { ok: false, message: 'CONFLICT' })
    }
    const entity = routeEntity[route]
    if (!entity || !body || typeof body !== 'object' || Array.isArray(body)) return result(400, { ok: false, message: 'MALFORMED' })
    const saved = await contentRepository.updateIfVersion({ entity, id, version, fields: body })
    return saved.status === 'saved' ? result(200, { ok: true, data: await record(route, id) })
      : result(409, { ok: false, message: 'CONFLICT' })
  },
  async deleteContent(route, id, version) {
    if (!routeEntity[route] || route === 'site') return result(405, { ok: false, message: 'METHOD_NOT_ALLOWED' })
    const deleted = await contentRepository.deleteIfVersion({ entity: routeEntity[route], id, version })
    return deleted.status === 'deleted' ? result(200, { ok: true, data: { id } })
      : result(409, { ok: false, message: 'CONFLICT' })
  },
  async startPublish(body) {
    if (building) return result(409, { ok: false, message: 'CONFLICT' })
    if (!body || !['rockets', 'site', 'missions', 'posts'].includes(body.kind) ||
      typeof body.id !== 'string' || typeof body.version !== 'string') return result(400, { ok: false, message: 'MALFORMED' })
    if (body.kind === 'posts') {
      if (!servicePosts) return result(503, { ok: false, message: 'UNAVAILABLE' })
      const draft = await servicePosts.readDraft(body.id)
      if (!draft || draft.version !== body.version) return result(409, { ok: false, message: 'CONFLICT' })
      const saved = await servicePosts.update({ operation: 'update', id: body.id, version: body.version,
        title: draft.title, bodyMd: draft.bodyMd, displayDate: draft.displayDate,
        attachments: draft.attachments, idempotencyKey: randomUUID(), published: true })
      if (saved.status !== 'saved') return result(409, { ok: false, message: 'CONFLICT' })
    } else {
      const table = { rockets: 'rockets', site: 'site_settings', missions: 'missions' }[body.kind]
      const key = body.kind === 'site' ? 'key' : 'id'
      const current = await pool.query(`select ${versionSql} as version from icaros.${table} where ${key}=$1`, [body.id])
      if (current.rows[0]?.version !== body.version) return result(409, { ok: false, message: 'CONFLICT' })
      if (body.kind !== 'site') await pool.query(`update icaros.${table} set published=true where ${key}=$1`, [body.id])
    }
    const job = { id: randomUUID(), state: 'publishing' }
    jobs.set(job.id, job)
    void rebuild(job)
    return result(202, { ok: true, data: job })
  },
  async readPublish(id) { return jobs.has(id) ? result(200, { ok: true, data: jobs.get(id) }) : result(404, { ok: false, message: 'NOT_FOUND' }) },
  async retryPublish(id) {
    const job = jobs.get(id)
    if (!job || job.state !== 'failed' || building) return result(409, { ok: false, message: 'CONFLICT' })
    job.state = 'publishing'; void rebuild(job)
    return result(202, { ok: true, data: job })
  },
  async requireBuildWorker() { return false },
  async finishPublish() { return result(403, { ok: false, message: 'DENIED' }) },
})

async function previewList(kind) {
  switch (kind) {
    case 'departments': {
      const { rows } = await pool.query('select id, name, updated_at from icaros.departments order by sort_order, name')
      return rows.map(({ updated_at, ...row }) => ({ ...row, version: new Date(updated_at).toISOString() }))
    }
    case 'members': {
      const { rows } = await pool.query('select id, name, department_id as "departmentId", bio_md as description, updated_at from icaros.members order by sort_order, id')
      return rows.map(({ updated_at, ...row }) => ({ ...row, version: new Date(updated_at).toISOString() }))
    }
    case 'vehicle-types': {
      const { rows } = await pool.query('select id, label as name, updated_at from icaros.vehicle_types order by sort_order, id')
      return rows.map(({ updated_at, ...row }) => ({ ...row, version: new Date(updated_at).toISOString() }))
    }
    case 'vehicle-series': {
      const { rows } = await pool.query('select id, label as name, type_id as "typeId", description_md as description, updated_at from icaros.rocket_series order by sort_order, id')
      return rows.map(({ updated_at, ...row }) => ({ ...row, version: new Date(updated_at).toISOString() }))
    }
    case 'vehicles': {
      const { rows } = await pool.query(`select r.id, r.name, s.type_id as "typeId", r.series as "seriesId",
        r.description_md as description, r.updated_at, r.cover_media_id as cover
        from icaros.rockets r left join icaros.rocket_series s on s.id=r.series order by r.sort_order,r.id`)
      const gallery = await pool.query("select id, entity_id from icaros.media where entity_type='rocket' and status='ready' and deleted_at is null")
      return rows.map(({ updated_at, cover, ...row }) => ({
        ...row, version: new Date(updated_at).toISOString(),
        galleryMediaIds: gallery.rows.filter((item) => item.entity_id === row.id && item.id !== cover).map((item) => item.id),
      }))
    }
    case 'panels': {
      const { rows } = await pool.query(`select p.id,p.headline as title,p.body as description,p.media_id as "mediaId",
        p.sort_order as position,m.mime,p.updated_at from icaros.page_panels p
        join icaros.media m on m.id=p.media_id order by p.sort_order,p.id`)
      return rows.map(({ updated_at, mime, ...row }) => ({ ...row, mediaKind: mime.startsWith('video/') ? 'video' : 'image', version: new Date(updated_at).toISOString() }))
    }
    case 'missions': {
      const { rows } = await pool.query(`select id,title,launch_date::text as "launchDate",vehicle_id as "vehicleId",location,outcome,
        summary,body_md as "bodyMd",cover_media_id as "coverMediaId",published,updated_at
        from icaros.missions order by launch_date desc,id`)
      return rows.map(({ updated_at, ...row }) => ({ ...row,
        version: new Date(updated_at).toISOString(),
      }))
    }
    case 'donation-rounds': {
      const { rows } = await pool.query("select key, value from icaros.site_settings where key in ('donation.round_label','donation.goal','donation.current')")
      const settings = Object.fromEntries(rows.map((item) => [item.key, item.value]))
      return [{ id: 'current', version: 'local', roundLabel: settings['donation.round_label'] ?? '',
        goal: Number(settings['donation.goal'] ?? 0), amount: Number(settings['donation.current'] ?? 0) }]
    }
    case 'post-attachments': return []
    default: return null
  }
}

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
  })
  response.end(JSON.stringify(body))
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  const previewKind = path.match(/^\/api\/admin\/preview\/([a-z-]+)$/)?.[1]
  if (request.method === 'GET' && previewKind) {
    const token = /(?:^|;\s*)icaros_local_session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1]
    if (!token || !sessions.has(token)) return send(response, 403, { ok: false, message: 'DENIED' })
    try {
      const data = await previewList(previewKind)
      return data === null ? send(response, 404, { ok: false, message: 'NOT_FOUND' })
        : send(response, 200, { ok: true, data })
    } catch { return send(response, 503, { ok: false, message: 'UNAVAILABLE' }) }
  }
  if (path.startsWith('/api/admin/')) {
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (body.length > 128_000) { response.writeHead(413); response.end(); return }
    }
    const event = { rawPath: path, requestContext: { http: { method: request.method, sourceIp: '127.0.0.1' } },
      headers: request.headers, body }
    const answer = await api(event)
    response.writeHead(answer.statusCode, { ...answer.headers,
      ...(answer.cookies ? { 'set-cookie': answer.cookies } : {}) })
    response.end(answer.body)
    return
  }
  send(response, 404, { ok: false, message: 'NOT_FOUND' })
})

server.listen(Number(process.env.ICAROS_LOCAL_API_PORT ?? 5176), '127.0.0.1', () => {
  console.log(`Writable local DB API: http://127.0.0.1:${process.env.ICAROS_LOCAL_API_PORT ?? 5176}`)
})

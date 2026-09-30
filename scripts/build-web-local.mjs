import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { validateSnapshot } from '../apps/web/scripts/snapshot-contract.mjs'

const root = resolve(import.meta.dirname, '..')
const publicRoot = resolve(root, 'apps/web/public')
const mediaRoot = resolve(publicRoot, 'assets/local-media')
const snapshotPath = resolve(root, 'docs/.local/local-public-snapshot.json')
const databaseUrl = process.env.ICAROS_LOCAL_DATABASE_URL ?? 'postgres://icaros:icaros_local_dev@127.0.0.1:5435/icaros'
const target = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.port !== '5435') {
  throw new Error('Local preview accepts only the local PostgreSQL port 5435')
}

const mediaExtension = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'],
  ['image/avif', 'avif'], ['image/gif', 'gif'], ['video/mp4', 'mp4'],
  ['model/gltf-binary', 'glb'], ['application/pdf', 'pdf'],
])
const mediaIdPattern = /\/api\/media\/([0-9a-f-]{36})/gi
const client = new pg.Client({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 })
const query = async (sql) => (await client.query(sql)).rows
const iso = (value) => new Date(value).toISOString()
const numeric = (value) => value === null ? null : String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
const excerpt = (markdown) => markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[#*_>`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 170)

async function readServicePosts() {
  const { ESSENTIA_SERVICE_ORIGIN: origin, ESSENTIA_SERVICE_TOKEN: token,
    ESSENTIA_SERVICE_CATEGORY: category } = process.env
  if (![origin, token, category].some(Boolean)) return []
  if (![origin, token, category].every(Boolean) || !/^https:\/\/[^/?#]+$/.test(origin)) {
    throw new Error('ESSENTIA service configuration is incomplete')
  }
  const response = await fetch(`${origin}/api/service/icaros/posts/snapshot`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('ESSENTIA snapshot unavailable')
  const posts = await response.json()
  if (!Array.isArray(posts) || posts.some((post) => !post || post.category !== category ||
    !/^[a-zA-Z0-9_-]+$/.test(post.id) || !/^[a-zA-Z0-9_-]+$/.test(post.forumPostId) || typeof post.title !== 'string' ||
    typeof post.content !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(post.displayDate) ||
    !Array.isArray(post.attachments))) throw new Error('Invalid ESSENTIA snapshot')
  return posts
}

function localLegacyImage(path) {
  if (typeof path !== 'string' || !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..')) return null
  return existsSync(resolve(publicRoot, path.slice(1))) ? path : null
}

function download(media, destination) {
  return new Promise((resolveDownload, reject) => {
    const local = media.bucket === process.env.ICAROS_LOCAL_S3_BUCKET
    const child = spawn('aws', [
      ...(local ? ['--endpoint-url', process.env.S3_ENDPOINT] : ['--profile', 'essentia']),
      's3api', 'get-object', '--bucket', media.bucket,
      '--key', media.key, destination,
    ], { stdio: 'ignore', env: local ? process.env : {
      ...process.env, AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_SESSION_TOKEN: '',
    } })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolveDownload() : reject(new Error(`Media ${media.id} download failed`)))
  })
}

async function main() {
  const servicePosts = await readServicePosts()
  await client.connect()
  let rows
  try {
    await client.query('begin transaction isolation level repeatable read read only')
    const site = await query('select key, value from icaros.site_settings where value is not null')
    const sections = await query('select id, label from icaros.page_sections where enabled order by sort_order, id')
    const panels = await query('select * from icaros.page_panels where published order by sort_order, id')
    const types = await query('select id, label from icaros.vehicle_types order by sort_order, id')
    const series = await query('select id, label, type_id, description_md from icaros.rocket_series order by sort_order, id')
    const vehicles = await query('select * from icaros.rockets where published order by sort_order, id')
    const models = await query('select rocket_id, glb_media_id, poster_media_id from icaros.rocket_models where rocket_id is not null and glb_media_id is not null order by updated_at desc, id')
    const engines = await query('select * from icaros.rocket_engines order by sort_order, id')
    const members = await query(`select m.*, coalesce(d.name, m.squad) as public_squad
      from icaros.members m left join icaros.departments d on d.id = m.department_id
      where m.published order by m.sort_order, m.id`)
    const posts = await query('select * from icaros.legacy_posts where published order by published_at desc, id desc')
    const missions = await query('select *, launch_date::text as launch_day from icaros.missions where published order by launch_date desc, id')
    const media = await query("select id, bucket, key, mime, width, height, entity_type, entity_id, created_at from icaros.media where status = 'ready' and deleted_at is null")
    await client.query('commit')
    rows = { site, sections, panels, types, series, vehicles, models, engines, members, posts, missions, media }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }

  const mediaById = new Map(rows.media.map((item) => [item.id.toLowerCase(), item]))
  const needed = new Set()
  const requireMedia = (id) => {
    const key = String(id).toLowerCase()
    if (!mediaById.has(key)) throw new Error(`Published content references unavailable media ${key}`)
    needed.add(key)
    return key
  }
  for (const panel of rows.panels) requireMedia(panel.media_id)
  for (const vehicle of rows.vehicles) if (vehicle.cover_media_id) requireMedia(vehicle.cover_media_id)
  const galleryFor = (vehicle) => {
    const images = rows.media.filter((item) => item.entity_type === 'rocket' && item.entity_id === vehicle.id &&
      item.id !== vehicle.cover_media_id && item.mime.startsWith('image/'))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))
    const key = `rocket.${vehicle.id}.gallery`
    const order = (rows.site.find((setting) => setting.key === key)?.value ?? '').split(',').map((id) => id.trim())
    images.sort((a, b) => {
      const ai = order.indexOf(a.id)
      const bi = order.indexOf(b.id)
      return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi)
    })
    return images
  }
  for (const vehicle of rows.vehicles) for (const item of galleryFor(vehicle)) requireMedia(item.id)
  const modelFor = (vehicle) => rows.models.find((model) => model.rocket_id === vehicle.id)
  for (const vehicle of rows.vehicles) {
    const model = modelFor(vehicle)
    if (!model) continue
    const glb = mediaById.get(requireMedia(model.glb_media_id))
    if (glb.mime !== 'model/gltf-binary') throw new Error(`Vehicle ${vehicle.id} model has invalid MIME`)
    if (model.poster_media_id) {
      const poster = mediaById.get(requireMedia(model.poster_media_id))
      if (!mediaExtension.has(poster.mime) || !poster.mime.startsWith('image/')) {
        throw new Error(`Vehicle ${vehicle.id} model poster has invalid MIME`)
      }
    }
  }
  for (const post of rows.posts) {
    if (post.cover_media_id) requireMedia(post.cover_media_id)
    for (const match of post.content_md.matchAll(mediaIdPattern)) requireMedia(match[1])
  }
  for (const post of servicePosts) {
    for (const attachment of post.attachments) {
      if (!attachment || !['image', 'pdf', 'video'].includes(attachment.kind) || typeof attachment.title !== 'string') {
        throw new Error('Invalid ESSENTIA attachment')
      }
      requireMedia(attachment.mediaId)
    }
    for (const match of post.content.matchAll(mediaIdPattern)) requireMedia(match[1])
  }
  for (const mission of rows.missions) {
    if (mission.cover_media_id) requireMedia(mission.cover_media_id)
    for (const match of mission.body_md.matchAll(mediaIdPattern)) requireMedia(match[1])
  }

  rmSync(mediaRoot, { recursive: true, force: true })
  mkdirSync(mediaRoot, { recursive: true, mode: 0o700 })
  const mediaUrls = {}
  const selected = [...needed].map((id) => {
    const media = mediaById.get(id)
    const extension = mediaExtension.get(media.mime)
    if (!extension) throw new Error(`Unsupported public media type for ${id}`)
    const filename = `${id}.${extension}`
    mediaUrls[id] = `/assets/local-media/${filename}`
    return { media, destination: resolve(mediaRoot, filename) }
  })
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (next < selected.length) {
      const entry = selected[next++]
      await download(entry.media, entry.destination)
      chmodSync(entry.destination, 0o600)
    }
  }))
  const urlFor = (id) => mediaUrls[requireMedia(id)]
  const snapshot = {
    version: `local-db-${Date.now()}`,
    publishedAt: new Date().toISOString(),
    site: Object.fromEntries(rows.site.map(({ key, value }) => [key, value])),
    sections: rows.sections,
    panels: rows.panels.map((panel) => {
      const media = mediaById.get(panel.media_id.toLowerCase())
      return {
        id: panel.id, published: true, mediaSrc: urlFor(panel.media_id), mime: media.mime,
        width: media.width, height: media.height, alt: '', focalX: panel.focal_x,
        focalY: panel.focal_y, scrim: panel.scrim, anchor: panel.anchor, heightMode: panel.height,
        headline: panel.headline, body: panel.body, ctaLabel: panel.cta_label, ctaHref: panel.cta_href,
      }
    }),
    taxonomy: {
      types: rows.types,
      series: rows.series.map((item) => ({ id: item.id, label: item.label, typeId: item.type_id, descriptionMd: item.description_md })),
    },
    vehicles: rows.vehicles.map((vehicle) => {
      const itemSeries = rows.series.find((item) => item.id === vehicle.series)
      return {
        slug: vehicle.id, name: vehicle.name, series: vehicle.series,
        seriesLabel: itemSeries?.label ?? vehicle.series, typeId: itemSeries?.type_id ?? null,
        imageSrc: vehicle.cover_media_id ? urlFor(vehicle.cover_media_id) : localLegacyImage(vehicle.legacy_image_path),
        gallery: galleryFor(vehicle).map((item, index) => ({
          src: urlFor(item.id), alt: `${vehicle.name} 추가 사진 ${index + 1}`,
          width: item.width, height: item.height,
        })),
        model: modelFor(vehicle) ? {
          src: urlFor(modelFor(vehicle).glb_media_id),
          posterSrc: modelFor(vehicle).poster_media_id ? urlFor(modelFor(vehicle).poster_media_id) : null,
        } : null,
        maxAltitudeM: numeric(vehicle.max_altitude_m), sizeM: numeric(vehicle.size_m), payloadKg: numeric(vehicle.payload_kg),
        descriptionMd: vehicle.description_md,
        engines: rows.engines.filter((engine) => engine.rocket_id === vehicle.id).map((engine) => ({
          id: engine.id, type: engine.type, thrustN: numeric(engine.thrust_n),
          burnTimeS: numeric(engine.burn_time_s), count: engine.count, mode: engine.mode,
        })),
        published: true,
      }
    }),
    members: rows.members.map((member) => ({
      id: member.id, name: member.name, role: member.role, squad: member.public_squad,
      school: member.school, bioMd: member.bio_md, imageSrc: '/assets/img/member/profile.webp',
      hasPhoto: false, published: true,
    })),
    posts: [...rows.posts.map((post) => ({
      id: post.id, slug: post.slug, source: 'legacy', title: post.title,
      contentMd: post.content_md.replace(mediaIdPattern, (_, id) => urlFor(id)),
      displayDate: iso(post.published_at).slice(0, 10), excerpt: excerpt(post.content_md),
      thumb: post.cover_media_id ? { kind: 'media', src: urlFor(post.cover_media_id) } : null,
      published: true,
    })), ...servicePosts.map((post) => ({
      id: post.id, forumPostId: post.forumPostId, source: 'community', title: post.title,
      contentMd: post.content.replace(mediaIdPattern, (_, id) => urlFor(id)),
      displayDate: post.displayDate, excerpt: excerpt(post.content),
      thumb: null, published: true,
      attachments: post.attachments.map((attachment) => ({
        kind: attachment.kind, title: attachment.title, src: urlFor(attachment.mediaId),
      })),
    }))].sort((a, b) => b.displayDate.localeCompare(a.displayDate) || a.id.localeCompare(b.id)),
    missions: rows.missions.map((mission) => ({
      id: mission.id, title: mission.title, launchDate: mission.launch_day,
      vehicleName: rows.vehicles.find((vehicle) => vehicle.id === mission.vehicle_id)?.name ?? null,
      location: mission.location, outcome: mission.outcome, summary: mission.summary,
      bodyMd: mission.body_md.replace(mediaIdPattern, (_, id) => urlFor(id)),
      imageSrc: mission.cover_media_id ? urlFor(mission.cover_media_id) : null,
      published: true,
    })),
    media: mediaUrls,
  }
  validateSnapshot(snapshot, publicRoot)
  mkdirSync(resolve(root, 'docs/.local'), { recursive: true, mode: 0o700 })
  const bytes = Buffer.from(JSON.stringify(snapshot))
  writeFileSync(snapshotPath, bytes, { mode: 0o600 })
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  console.log(`Local DB snapshot: ${snapshot.vehicles.length} vehicles, ${snapshot.members.length} members, ${snapshot.panels.length} panels, ${snapshot.posts.length} archived posts, ${snapshot.missions.length} missions, ${selected.length} media files`)
  const build = spawnSync('npm', ['run', 'build', '-w', '@icaros/web'], {
    cwd: root,
    env: { ...process.env, ICAROS_SNAPSHOT: snapshotPath, ICAROS_SNAPSHOT_SHA256: sha256 },
    stdio: 'inherit',
  })
  if (build.error) throw build.error
  process.exitCode = build.status ?? 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { validateSnapshot } from '../apps/web/scripts/snapshot-contract.mjs'
import { selectedMemberMediaIds } from '../infra/release/compat-media-index.mjs'
import { memberPortraitMedia } from '../apps/web/scripts/public-member-media.mjs'

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
  let approvedOrigin = false
  try {
    const url = new URL(origin)
    approvedOrigin = !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  } catch { /* incomplete origin */ }
  if (![origin, token, category].every(Boolean) || !approvedOrigin) {
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
  return posts.map(post => ({ ...post, content: post.content.replace(/https:\/\/(?:www\.)?icaros\.kr\/api\/media\/([0-9a-f-]{36})/gi, '/api/media/$1') }))
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

export function localDepartmentSnapshot(department, publishedMembers) {
  const leader = department.lead_member_id
  return { id: department.id, name: department.name, sortOrder: department.sort_order,
    leadMemberId: leader && publishedMembers.some(member => member.id === leader && member.department_ids?.includes(department.id)) ? leader : null }
}

export function localMemberSnapshot(member, portrait, urlFor) {
  return {
    id: member.id, name: member.name, role: member.role, squad: member.public_squad,
    squads: member.public_squads ?? (member.public_squad ? [member.public_squad] : []),
    departmentIds: member.department_ids ?? [],
    school: member.school, bioMd: member.bio_md ?? null,
    imageSrc: portrait ? urlFor(portrait.id) : '/assets/img/member/profile.webp',
    hasPhoto: portrait !== null, published: true,
  }
}

/** Fingerprint selected biography images without exporting their bytes to public assets. */
export function localMemberCompatibilityEntry(media, bytes) {
  const id = String(media.id).toLowerCase()
  const extension = mediaExtension.get(media.mime)
  const ascii = (start, end) => bytes.subarray(start, end).toString('ascii')
  let header = false
  if (media.mime === 'image/jpeg') header = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (media.mime === 'image/png') header = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (media.mime === 'image/webp') header = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (media.mime === 'image/gif') header = ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
  if (media.mime === 'image/avif' && bytes.length >= 16 && ascii(4, 8) === 'ftyp') {
    const size = bytes.readUInt32BE(0)
    if (size >= 16 && size <= bytes.length && size <= 4096 && size % 4 === 0) {
      header = [ascii(8, 12), ...Array.from({ length: (size - 16) / 4 }, (_, i) => ascii(16 + i * 4, 20 + i * 4))]
        .some(brand => ['avif', 'avis'].includes(brand))
    }
  }
  const checksum = createHash('sha256').update(bytes).digest('base64')
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) || !extension || !header ||
    !Number.isSafeInteger(Number(media.size)) || Number(media.size) !== bytes.length || bytes.length < 1 || bytes.length > 3 * 1024 * 1024 ||
    (media.declared_checksum_sha256 != null && media.declared_checksum_sha256 !== checksum)) {
    throw new Error('Invalid selected private member media')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { key: `published/${id}/${sha256}.${extension}`, sha256, mime: media.mime, size: bytes.length,
    entityType: 'member', storage: 'private' }
}

export async function collectLocalMemberBioMedia(bioIds, mediaById, privateRoot, downloadMedia = download) {
  const compatMedia = {}
  const privateUrls = {}
  if (bioIds.size) {
    mkdirSync(privateRoot, { recursive: true, mode: 0o700 })
    const temporary = mkdtempSync(resolve(privateRoot, 'member-bio-'))
    try {
      for (const id of bioIds) {
        const media = mediaById.get(id)
        if (!media || !media.mime?.startsWith('image/') || !mediaExtension.has(media.mime) ||
          !Number.isSafeInteger(Number(media.size)) || Number(media.size) < 1 || Number(media.size) > 3 * 1024 * 1024) {
          throw new Error('Invalid selected private member media')
        }
        const destination = resolve(temporary, id)
        await downloadMedia(media, destination)
        chmodSync(destination, 0o600)
        if (statSync(destination).size !== Number(media.size)) throw new Error('Invalid selected private member media size')
        compatMedia[id] = localMemberCompatibilityEntry(media, readFileSync(destination))
        privateUrls[id] = `/api/media/${id}`
      }
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  }

  return { compatMedia, privateUrls }
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
    const departments = await query(`select d.id, d.name, d.sort_order,
      (select md.member_id from icaros.member_departments md join icaros.members m on m.id = md.member_id
        where md.department_id = d.id and md.is_lead and m.published) as lead_member_id
      from icaros.departments d order by d.sort_order, d.id`)
    const memberPhotos = await query('select image_media_id from icaros.members where image_media_id is not null')
    const members = await query(`select m.*, coalesce(d.name, m.squad) as public_squad,
      coalesce((select array_agg(assigned.name order by md.position)
        from icaros.member_departments md join icaros.departments assigned on assigned.id = md.department_id
        where md.member_id = m.id),
        case when coalesce(d.name, m.squad) is null then array[]::text[] else array[coalesce(d.name, m.squad)] end) as public_squads,
      coalesce((select array_agg(md.department_id::text order by md.position)
        from icaros.member_departments md where md.member_id = m.id),
        array[]::text[]) as department_ids
      from icaros.members m left join icaros.departments d on d.id = m.department_id
      where m.published order by m.sort_order, m.id`)
    const posts = await query('select * from icaros.legacy_posts where published order by published_at desc, id desc')
    const missions = await query('select *, launch_date::text as launch_day from icaros.missions where published order by launch_date desc, id')
    const media = await query("select id, bucket, key, mime, size, declared_checksum_sha256, width, height, entity_type, entity_id, created_at, status, deleted_at from icaros.media where status = 'ready' and deleted_at is null")
    await client.query('commit')
    rows = { site, sections, panels, types, series, vehicles, models, engines, departments, memberPhotos, members, posts, missions, media }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }

  const mediaById = new Map(rows.media.map((item) => [item.id.toLowerCase(), item]))
  const bioIds = selectedMemberMediaIds({ members: rows.members.map(member => ({ published: true, bioMd: member.bio_md })) })
  const memberPhotoIds = new Set(rows.memberPhotos.map(member => member.image_media_id.toLowerCase()))
  const privateIds = new Set([...memberPhotoIds, ...bioIds])
  const portraitIds = new Set()
  const needed = new Set()
  const requireMedia = (id, memberContext = false) => {
    const key = String(id).toLowerCase()
    if (!mediaById.has(key)) throw new Error(`Published content references unavailable media ${key}`)
    if (!memberContext && (privateIds.has(key) || mediaById.get(key).entity_type === 'member')) {
      throw new Error('Member media cannot be reused in static public content')
    }
    needed.add(key)
    return key
  }
  for (const panel of rows.panels) requireMedia(panel.media_id)
  for (const vehicle of rows.vehicles) if (vehicle.cover_media_id) requireMedia(vehicle.cover_media_id)
  for (const member of rows.members) {
    const portrait = memberPortraitMedia(member, mediaById)
    if (portrait) { portraitIds.add(portrait.id.toLowerCase()); requireMedia(portrait.id, true) }
  }
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
  for (const value of [
    ...rows.vehicles.map((item) => item.description_md),
    ...rows.series.map((item) => item.description_md),
  ]) {
    if (value) for (const match of value.matchAll(mediaIdPattern)) requireMedia(match[1])
  }

  const { compatMedia, privateUrls } = await collectLocalMemberBioMedia(bioIds, mediaById, resolve(root, 'docs/.local'))

  rmSync(mediaRoot, { recursive: true, force: true })
  mkdirSync(mediaRoot, { recursive: true, mode: 0o700 })
  const mediaUrls = { ...privateUrls }
  const portraitUrls = {}
  const selected = [...needed].map((id) => {
    const media = mediaById.get(id)
    const extension = mediaExtension.get(media.mime)
    if (!extension) throw new Error(`Unsupported public media type for ${id}`)
    const filename = `${id}.${extension}`
    const publicUrl = `/assets/local-media/${filename}`
    if (privateUrls[id]) {
      // Only an explicitly selected portrait may have a local static preview copy.
      mediaUrls[`${id}:portrait`] = publicUrl
    } else mediaUrls[id] = publicUrl
    if (portraitIds.has(id)) portraitUrls[id] = publicUrl
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
  const imageSize = (id) => {
    const media = mediaById.get(id.toLowerCase())
    const width = Number(media?.width)
    const height = Number(media?.height)
    return width > 0 && height > 0 ? { width, height } : {}
  }
  const versionTime = Date.now()
  const snapshot = {
    version: `local-db-${versionTime}`,
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
      series: rows.series.map((item) => ({ id: item.id, label: item.label, typeId: item.type_id, descriptionMd: item.description_md?.replace(mediaIdPattern, (_, id) => urlFor(id)) ?? null })),
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
        ...(vehicle.specs == null ? {} : { specs: vehicle.specs }),
        maxAltitudeM: numeric(vehicle.max_altitude_m), sizeM: numeric(vehicle.size_m), payloadKg: numeric(vehicle.payload_kg),
        descriptionMd: vehicle.description_md?.replace(mediaIdPattern, (_, id) => urlFor(id)) ?? null,
        engines: rows.engines.filter((engine) => engine.rocket_id === vehicle.id).map((engine) => ({
          id: engine.id, type: engine.type, thrustN: numeric(engine.thrust_n),
          burnTimeS: numeric(engine.burn_time_s), count: engine.count, mode: engine.mode,
        })),
        published: true,
      }
    }),
    departments: rows.departments.map(department => localDepartmentSnapshot(department, rows.members)),
    members: rows.members.map((member) => {
      const portrait = memberPortraitMedia(member, mediaById)
      return localMemberSnapshot(member, portrait, id => portraitUrls[id.toLowerCase()])
    }),
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
      thumb: post.attachments.find(item => item.kind === 'image') ? { kind: 'media', src: urlFor(post.attachments.find(item => item.kind === 'image').mediaId) } : null, published: true,
      attachments: post.attachments.map((attachment) => ({
        kind: attachment.kind, title: attachment.title, src: urlFor(attachment.mediaId),
        ...(attachment.kind === 'image' ? imageSize(attachment.mediaId) : {}),
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
    compatMediaIndex: { version: `local-db-${versionTime}`, media: compatMedia },
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

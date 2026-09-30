import type { SnapshotSource } from '../snapshot.js'
import type { SnapshotPost } from '../essentia/posts.js'

export interface SqlClient {
  // SQL projection columns differ across the fixed public tables below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string): Promise<{ rows: Record<string, any>[] }>
  release(): void
}
export interface SqlPool { connect(): Promise<SqlClient> }
export interface PublicMedia { url(id: string, media: Record<string, unknown>): Promise<string> }

const mediaId = /\/api\/media\/([0-9a-f-]{36})/gi
const number = (value: unknown) => value == null ? null : String(value)
const excerpt = (md: string) => md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[#*_>`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 170)
const legacyImage = (value: unknown) => typeof value === 'string' && /^\/assets\/img\/rocket\/[a-zA-Z0-9_.-]+$/.test(value)
  ? value : null

/** Reads ICAROS public rows in one repeatable-read transaction; ESSENTIA supplies its own published snapshot. */
export function createPostgresSnapshotSource(options: {
  pool: SqlPool; essentia: { readSnapshot(): Promise<SnapshotPost[]> }; media: PublicMedia
}): SnapshotSource {
  return { async read(version) {
    const servicePosts = await options.essentia.readSnapshot()
    const db = await options.pool.connect()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, Record<string, any>[]> = {}
    const queries = {
      site: 'select key, value from icaros.site_settings where value is not null',
      sections: 'select id, label from icaros.page_sections where enabled order by sort_order, id',
      panels: 'select * from icaros.page_panels where published order by sort_order, id',
      types: 'select id, label from icaros.vehicle_types order by sort_order, id',
      series: 'select id, label, type_id, description_md from icaros.rocket_series order by sort_order, id',
      vehicles: 'select * from icaros.rockets where published order by sort_order, id',
      models: 'select rocket_id, glb_media_id, poster_media_id from icaros.rocket_models where rocket_id is not null and glb_media_id is not null order by updated_at desc, id',
      engines: 'select * from icaros.rocket_engines order by sort_order, id',
      members: 'select m.id, m.name, m.role, m.school, m.bio_md, coalesce(d.name, m.squad) as public_squad from icaros.members m left join icaros.departments d on d.id = m.department_id where m.published order by m.sort_order, m.id',
      posts: 'select id, slug, title, content_md, published_at, cover_media_id from icaros.legacy_posts where published order by published_at desc, id desc',
      missions: 'select id, title, launch_date::text as launch_day, vehicle_id, location, outcome, summary, body_md, cover_media_id from icaros.missions where published order by launch_date desc, id',
      media: "select id, bucket, key, mime, width, height, entity_type, entity_id, created_at from icaros.media where status = 'ready' and deleted_at is null",
    }
    try {
      await db.query('begin transaction isolation level repeatable read read only')
      for (const [name, sql] of Object.entries(queries)) rows[name] = (await db.query(sql)).rows
      await db.query('commit')
    } catch (error) { await db.query('rollback'); throw error } finally { db.release() }
    const list = (name: string) => rows[name] ?? []
    const ready = new Map(list('media').map(item => [String(item.id).toLowerCase(), item]))
    const urls: Record<string, string> = {}
    const url = async (id: string | null): Promise<string | null> => {
      if (!id) return null
      const key = id.toLowerCase()
      const media = ready.get(key)
      if (!media) throw new Error('Published content references unavailable media')
      if (!urls[key]) urls[key] = await options.media.url(key, media)
      return urls[key]
    }
    const markdown = async (value: string): Promise<string> => {
      let result = value
      const ids = [...value.matchAll(mediaId)].map(match => match[1]!)
      for (const id of ids) result = result.replaceAll(`/api/media/${id}`, (await url(id))!)
      if (result.includes('/api/media/')) throw new Error('Unresolved private media')
      return result
    }
    const vehicles = await Promise.all(list('vehicles').map(async vehicle => {
      const series = list('series').find(item => item.id === vehicle.series)
      const model = list('models').find(item => item.rocket_id === vehicle.id)
      const gallery = list('media').filter(item => item.entity_type === 'rocket' && item.entity_id === vehicle.id &&
        item.id !== vehicle.cover_media_id && item.mime.startsWith('image/'))
      const preferred = String(list('site').find(item => item.key === `rocket.${vehicle.id}.gallery`)?.value ?? '')
        .split(',').filter(Boolean)
      gallery.sort((a, b) => {
        const ai = preferred.indexOf(a.id); const bi = preferred.indexOf(b.id)
        return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) ||
          String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))
      })
      return { slug: vehicle.id, name: vehicle.name, series: vehicle.series,
        seriesLabel: series?.label ?? vehicle.series, typeId: series?.type_id ?? null,
        imageSrc: vehicle.cover_media_id ? await url(vehicle.cover_media_id) : legacyImage(vehicle.legacy_image_path),
        gallery: await Promise.all(gallery.map(async (item, index) => ({ src: await url(item.id), alt: `${vehicle.name} 추가 사진 ${index + 1}`, width: item.width, height: item.height }))),
        model: model ? { src: await url(model.glb_media_id), posterSrc: await url(model.poster_media_id) } : null,
        maxAltitudeM: number(vehicle.max_altitude_m), sizeM: number(vehicle.size_m), payloadKg: number(vehicle.payload_kg),
        descriptionMd: vehicle.description_md, engines: list('engines').filter(item => item.rocket_id === vehicle.id).map(item => ({
          id: item.id, type: item.type, thrustN: number(item.thrust_n), burnTimeS: number(item.burn_time_s), count: item.count, mode: item.mode,
        })), published: true }
    }))
    const legacy = await Promise.all(list('posts').map(async post => ({ id: post.id, slug: post.slug, source: 'legacy',
      title: post.title, contentMd: await markdown(post.content_md), displayDate: new Date(post.published_at).toISOString().slice(0, 10),
      excerpt: excerpt(post.content_md), thumb: post.cover_media_id ? { kind: 'media', src: await url(post.cover_media_id) } : null, published: true })))
    const community = await Promise.all(servicePosts.map(async post => ({ id: post.id, forumPostId: post.forumPostId,
      source: 'community', title: post.title, contentMd: await markdown(post.contentMd), displayDate: post.displayDate,
      excerpt: excerpt(post.contentMd), thumb: null, published: true,
      attachments: await Promise.all(post.attachments.map(async attachment => ({ kind: attachment.kind,
        title: attachment.title, src: await url(attachment.mediaId) }))), })))
    return { version: String(version), publishedAt: new Date().toISOString(),
      site: Object.fromEntries(list('site').map(item => [item.key, item.value])),
      sections: list('sections'),
      panels: await Promise.all(list('panels').map(async panel => {
        const media = ready.get(String(panel.media_id).toLowerCase())
        return { id: panel.id, published: true, mediaSrc: await url(panel.media_id), mime: media?.mime,
          width: media?.width, height: media?.height, alt: '', focalX: panel.focal_x, focalY: panel.focal_y,
          scrim: panel.scrim, anchor: panel.anchor, heightMode: panel.height,
          headline: panel.headline, body: panel.body, ctaLabel: panel.cta_label, ctaHref: panel.cta_href }
      })),
      taxonomy: { types: list('types'), series: list('series').map(item => ({ id: item.id, label: item.label, typeId: item.type_id, descriptionMd: item.description_md })) },
      vehicles, members: list('members').map(item => ({ id: item.id, name: item.name, role: item.role, squad: item.public_squad,
        school: item.school, bioMd: item.bio_md, imageSrc: '/assets/img/member/profile.webp', hasPhoto: false, published: true })),
      posts: [...legacy, ...community].sort((a, b) => b.displayDate.localeCompare(a.displayDate) || a.id.localeCompare(b.id)),
      missions: await Promise.all(list('missions').map(async item => ({ id: item.id, title: item.title, launchDate: item.launch_day,
        vehicleName: vehicles.find(vehicle => vehicle.slug === item.vehicle_id)?.name ?? null,
        location: item.location, outcome: item.outcome, summary: item.summary, bodyMd: await markdown(item.body_md),
        imageSrc: await url(item.cover_media_id), published: true }))), media: urls }
  } }
}

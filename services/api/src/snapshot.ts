import { createHash } from 'node:crypto'

export interface SnapshotSource {
  /** Return one consistent, public-only view of ICAROS content and ESSENTIA posts. */
  read(version: number): Promise<unknown>
}

export interface SnapshotStore {
  /** Persist immutable bytes at a versioned or content-addressed location. */
  put(input: { version: number; bytes: Buffer; sha256: string }): Promise<string>
}

export interface SnapshotArtifact {
  readonly snapshotRef: string
  readonly snapshotSha256: string
}

export interface SnapshotExporter {
  export(version: number): Promise<SnapshotArtifact>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function publicUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value.startsWith('/assets/')) return /^\/assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes('..')
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      !url.pathname.includes('/api/media/') && !url.hostname.includes('amazonaws.com')
  } catch { return false }
}

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function safeMissionMarkdown(value: string, knownMedia: (url: unknown) => boolean): boolean {
  if (value.includes('/api/media/') || /<[^>]*>/.test(value)) return false
  const definitions = new Map<string, string>()
  for (const match of value.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(\S+)/gm)) {
    definitions.set(match[1]!.toLowerCase(), match[2]!)
  }
  const images = /!\[([^\]]*)\]\(([^\s)]+)\)|!\[([^\]]*)\]\[([^\]]*)\]/g
  const withoutImages = value.replace(images, (_, _alt, direct: string | undefined, referenceAlt: string | undefined, reference: string | undefined) => {
    const url = direct ?? definitions.get((reference || referenceAlt || '').toLowerCase())
    return knownMedia(url) ? '' : '!['
  })
  return !withoutImages.includes('![')
}

/** Mirrors the public safety constraints of apps/web's Snapshot reader before storing bytes. */
export function validatePublicSnapshot(value: unknown, version: number): asserts value is Record<string, unknown> {
  if (!record(value) || value.version !== String(version) || typeof value.publishedAt !== 'string' ||
      !record(value.site) || !record(value.media) || !record(value.taxonomy) ||
      !Array.isArray(value.taxonomy.types) || !Array.isArray(value.taxonomy.series) ||
      !Array.isArray(value.sections) || !Array.isArray(value.panels) ||
      !Array.isArray(value.vehicles) || !Array.isArray(value.members) || !Array.isArray(value.posts) ||
      !Array.isArray(value.missions)) {
    throw new Error('Invalid snapshot shape')
  }
  if (!Object.values(value.site).every((entry) => typeof entry === 'string') ||
      !Object.values(value.media).every(publicUrl)) throw new Error('Private snapshot data')
  const exportedMedia = new Set(Object.values(value.media))
  const knownMedia = (url: unknown): boolean => publicUrl(url) &&
    (typeof url !== 'string' || !url.startsWith('/assets/local-media/') || exportedMedia.has(url))
  const missionIds = new Set<string>()
  for (const item of value.missions) {
    if (!record(item) || item.published !== true || typeof item.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) ||
        missionIds.has(item.id) || !validDate(item.launchDate) ||
        typeof item.title !== 'string' || !item.title.trim() ||
        typeof item.location !== 'string' || !item.location.trim() ||
        typeof item.summary !== 'string' || !item.summary.trim() ||
        (item.vehicleName !== null && (typeof item.vehicleName !== 'string' || !item.vehicleName.trim())) ||
        !['success', 'partial', 'failure', 'planned'].includes(item.outcome as string) ||
        typeof item.bodyMd !== 'string' || !item.bodyMd.trim() ||
        !safeMissionMarkdown(item.bodyMd, knownMedia) ||
        (item.imageSrc !== null && !knownMedia(item.imageSrc))) throw new Error('Invalid public mission')
    missionIds.add(item.id)
  }
  const vehicleSlugs = new Set<string>()
  for (const item of value.vehicles) {
    if (!record(item) || typeof item.slug !== 'string' || !item.slug || vehicleSlugs.has(item.slug) ||
        (item.imageSrc != null && !knownMedia(item.imageSrc)) ||
        (item.gallery != null && (!Array.isArray(item.gallery) || item.gallery.some((image) => !record(image) || !knownMedia(image.src)))) ||
        (item.model != null && (!record(item.model) || !knownMedia(item.model.src) ||
          (item.model.posterSrc != null && !knownMedia(item.model.posterSrc))))) throw new Error('Invalid vehicle')
    vehicleSlugs.add(item.slug)
  }
  for (const item of value.panels) {
    if (!record(item) || !knownMedia(item.mediaSrc)) throw new Error('Invalid panel')
  }
  for (const item of value.members) {
    if (!record(item) || item.hasPhoto !== false || item.imageSrc !== '/assets/img/member/profile.webp') {
      throw new Error('Private member photo')
    }
  }
  const postIds = new Set<string>()
  for (const item of value.posts) {
    if (!record(item) || item.published !== true || typeof item.id !== 'string' ||
        typeof item.displayDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.displayDate) ||
        Number.isNaN(Date.parse(`${item.displayDate}T00:00:00Z`)) ||
        new Date(`${item.displayDate}T00:00:00Z`).toISOString().slice(0, 10) !== item.displayDate ||
        (item.source !== 'community' && item.source !== 'legacy') ||
        (item.source === 'community' && item.forumPostId != null &&
          (typeof item.forumPostId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(item.forumPostId))) ||
        typeof item.contentMd !== 'string' || item.contentMd.includes('/api/media/') ||
        (item.thumb != null && (!record(item.thumb) || !knownMedia(item.thumb.src))) ||
        (item.attachments != null && (!Array.isArray(item.attachments) ||
          item.attachments.some((attachment) => !record(attachment) || !knownMedia(attachment.src) ||
            (attachment.posterSrc != null && !knownMedia(attachment.posterSrc)))))) {
      throw new Error('Invalid public post')
    }
    const key = `${item.source}:${item.source === 'legacy' ? item.slug : item.id}`
    if (postIds.has(key)) throw new Error('Duplicate post')
    postIds.add(key)
  }
}

export function createSnapshotExporter(source: SnapshotSource, store: SnapshotStore): SnapshotExporter {
  if (!source?.read || !store?.put) throw new Error('Snapshot source and immutable store are required')
  return {
    async export(version) {
      if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid snapshot version')
      const data = await source.read(version)
      validatePublicSnapshot(data, version)
      const bytes = Buffer.from(JSON.stringify(data))
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const snapshotRef = await store.put({ version, bytes, sha256 })
      if (!snapshotRef) throw new Error('Snapshot store returned no reference')
      return { snapshotRef, snapshotSha256: sha256 }
    },
  }
}

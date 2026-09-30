import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const SEGMENT = /^[a-zA-Z0-9_-]+$/

function isPublicUrl(value, publicRoot) {
  if (typeof value !== 'string') return false
  if (value.startsWith('/assets/')) {
    if (!/^\/assets\/[a-zA-Z0-9_./-]+$/.test(value) || value.includes('..')) return false
    return existsSync(resolve(publicRoot, value.slice(1)))
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search &&
      !url.hash && !url.pathname.includes('/api/media/') && !url.hostname.includes('amazonaws.com')
  } catch { return false }
}

function hasUnsafeMarkdownMedia(markdown, publicRoot) {
  const tree = unified().use(remarkParse).parse(markdown)
  const definitions = new Map()
  const nodes = [tree]
  while (nodes.length) {
    const node = nodes.pop()
    if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node.url)
    if (node.children) nodes.push(...node.children)
  }
  nodes.push(tree)
  while (nodes.length) {
    const node = nodes.pop()
    if (node.type === 'html') return true
    if (node.type === 'image' && !isPublicUrl(node.url, publicRoot)) return true
    if (node.type === 'imageReference' && !isPublicUrl(definitions.get(node.identifier.toLowerCase()), publicRoot)) return true
    if (node.children) nodes.push(...node.children)
  }
  return false
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} in snapshot`)
}

export function validateSnapshot(data, publicRoot = resolve(process.cwd(), 'public')) {
  if (!data || typeof data !== 'object' || !data.version || !data.publishedAt ||
    !Array.isArray(data.sections) || !Array.isArray(data.panels) ||
    !Array.isArray(data.taxonomy?.types) || !Array.isArray(data.taxonomy?.series) ||
    !Array.isArray(data.vehicles) || !Array.isArray(data.members) || !Array.isArray(data.posts) || !Array.isArray(data.missions) ||
    !data.site || typeof data.site !== 'object' || !data.media || typeof data.media !== 'object') {
    throw new Error('Invalid publication snapshot shape')
  }
  if (!data.site['seo.title'] || !data.site['seo.description'] || data.sections.length === 0 ||
    data.taxonomy.types.length === 0 || data.taxonomy.series.length === 0 || data.vehicles.length === 0 ||
    data.posts.length === 0) {
    throw new Error('Incomplete publication snapshot')
  }

  unique(data.missions.map((mission) => mission.id), 'mission ID')
  unique(data.vehicles.map((vehicle) => vehicle.slug), 'vehicle slug')
  unique(data.posts.map((post) => `${post.source}:${post.source === 'legacy' ? post.slug : post.id}`), 'post ID')
  unique(data.taxonomy.types.map((type) => type.id), 'vehicle type')
  unique(data.taxonomy.series.map((series) => series.id), 'vehicle series')
  for (const type of data.taxonomy.types) {
    if (!SEGMENT.test(type.id) || !type.label) throw new Error('Invalid vehicle type')
  }
  for (const series of data.taxonomy.series) {
    if (!SEGMENT.test(series.id) || !data.taxonomy.types.some((type) => type.id === series.typeId) || !series.label) {
      throw new Error('Invalid vehicle series')
    }
  }
  for (const vehicle of data.vehicles) {
    if (vehicle.published !== true || !SEGMENT.test(vehicle.slug) || !vehicle.name || !Array.isArray(vehicle.engines)) {
      throw new Error('Invalid published vehicle')
    }
    if (vehicle.imageSrc && !isPublicUrl(vehicle.imageSrc, publicRoot)) throw new Error(`Vehicle ${vehicle.slug} has non-public media`)
    if (vehicle.model != null && (!isPublicUrl(vehicle.model.src, publicRoot) ||
      (vehicle.model.posterSrc != null && !isPublicUrl(vehicle.model.posterSrc, publicRoot)))) {
      throw new Error(`Vehicle ${vehicle.slug} has non-public model media`)
    }
    if (vehicle.gallery != null && (!Array.isArray(vehicle.gallery) ||
      vehicle.gallery.some((image) => !isPublicUrl(image.src, publicRoot)))) {
      throw new Error(`Vehicle ${vehicle.slug} has non-public gallery media`)
    }
  }
  for (const panel of data.panels) {
    if (panel.published !== true || !isPublicUrl(panel.mediaSrc, publicRoot) || panel.width <= 0 || panel.height <= 0 ||
      !['none', 'bottom', 'full', 'top'].includes(panel.scrim) ||
      !['bottom-left', 'bottom-center', 'center', 'top-left'].includes(panel.anchor) ||
      !['full', 'tall', 'half'].includes(panel.heightMode)) throw new Error(`Invalid public panel ${panel.id}`)
  }
  for (const post of data.posts) {
    if (post.source === 'community' && post.forumPostId != null &&
      (typeof post.forumPostId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(post.forumPostId))) {
      throw new Error(`Post ${post.id} has invalid forum ID`)
    }
    if (post.attachments != null && (!Array.isArray(post.attachments) ||
      post.attachments.some((attachment) => !isPublicUrl(attachment.src, publicRoot) ||
        (attachment.posterSrc != null && !isPublicUrl(attachment.posterSrc, publicRoot))))) {
      throw new Error(`Post ${post.id} has non-public attachments`)
    }
    if (post.published !== true || !SEGMENT.test(post.id) ||
      (post.source === 'legacy' && !SEGMENT.test(post.slug ?? '')) ||
      !post.title || typeof post.displayDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(post.displayDate) ||
      Number.isNaN(Date.parse(`${post.displayDate}T00:00:00Z`)) ||
      new Date(`${post.displayDate}T00:00:00Z`).toISOString().slice(0, 10) !== post.displayDate || !post.contentMd ||
      (post.thumb && !isPublicUrl(post.thumb.src, publicRoot)) || post.contentMd.includes('/api/media/')) {
      throw new Error(`Post ${post.id} is not safe for public export`)
    }
  }
  for (const mission of data.missions) {
    const date = mission.launchDate
    if (mission.published !== true || !UUID.test(mission.id) ||
      !['success', 'partial', 'failure', 'planned'].includes(mission.outcome) ||
      typeof date !== 'string' || !DATE.test(date) ||
      Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
      !mission.title?.trim() || !mission.location?.trim() || !mission.summary?.trim() ||
      typeof mission.bodyMd !== 'string' || !mission.bodyMd.trim() ||
      (mission.vehicleName !== null && (typeof mission.vehicleName !== 'string' || !mission.vehicleName.trim())) ||
      (mission.imageSrc !== null && !isPublicUrl(mission.imageSrc, publicRoot)) ||
      mission.bodyMd.includes('/api/media/') || hasUnsafeMarkdownMedia(mission.bodyMd, publicRoot)) {
      throw new Error(`Mission ${mission.id} is not safe for public export`)
    }
  }
  for (const member of data.members) {
    if (member.published !== true || !member.id || !member.name) throw new Error('Invalid published member')
    if (member.hasPhoto || member.imageSrc !== '/assets/img/member/profile.webp' ||
      /\/api\/media\/|!\[[^\]]*\]\(|<img\b/i.test(member.bioMd ?? '')) {
      throw new Error(`Member ${member.id} has non-public media`)
    }
  }
  for (const url of Object.values(data.media)) if (!isPublicUrl(url, publicRoot)) throw new Error('Non-public media URL')
}

export function loadAndValidateSnapshot(file, pin, publicRoot = resolve(process.cwd(), 'public')) {
  if (!file || !/^[a-f0-9]{64}$/i.test(pin ?? '')) {
    throw new Error('ICAROS_SNAPSHOT and ICAROS_SNAPSHOT_SHA256 are required')
  }
  const bytes = readFileSync(resolve(file))
  if (createHash('sha256').update(bytes).digest('hex') !== pin.toLowerCase()) {
    throw new Error('Snapshot SHA-256 mismatch')
  }
  const data = JSON.parse(bytes.toString('utf8'))
  validateSnapshot(data, publicRoot)
  return data
}

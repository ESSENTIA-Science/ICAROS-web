import 'server-only'
import { loadAndValidateSnapshot } from '../../../scripts/snapshot-contract.mjs'
import type { LandingPanel } from '@/lib/panels'
import type { RocketDetail } from '@/app/(public)/vehicles/_data'
import type { MemberDto } from '@/app/(public)/member/_data'
import type { VehicleTaxonomy } from '@/components/rocket/series'
import { postPageCount } from '@/lib/posts/pagination'

export type PublishedPost = {
  id: string
  forumPostId?: string
  slug?: string
  source: 'community' | 'legacy'
  title: string
  contentMd: string
  displayDate: string
  excerpt: string
  thumb: { kind: 'external' | 'media'; src: string } | null
  published: true
  attachments?: { kind: 'image' | 'pdf' | 'video'; src: string; title: string; posterSrc?: string | null; width?: number; height?: number }[]
}

export type PublishedMission = {
  id: string
  title: string
  launchDate: string
  vehicleName: string | null
  location: string
  outcome: 'success' | 'partial' | 'failure' | 'planned'
  summary: string
  bodyMd: string
  imageSrc: string | null
  published: true
}

export type Snapshot = {
  version: string
  publishedAt: string
  site: Record<string, string>
  sections: { id: string; label: string }[]
  panels: (LandingPanel & { published: true })[]
  taxonomy: VehicleTaxonomy
  vehicles: (RocketDetail & { published: true })[]
  members: (MemberDto & { published: true })[]
  posts: PublishedPost[]
  missions: PublishedMission[]
  media: Record<string, string>
}

let cached: Snapshot | undefined
export function getSnapshot(): Snapshot {
  if (cached) return cached
  const data = loadAndValidateSnapshot(process.env.ICAROS_SNAPSHOT, process.env.ICAROS_SNAPSHOT_SHA256) as Snapshot
  for (const post of data.posts) {
    if (typeof post.displayDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(post.displayDate) ||
      Number.isNaN(Date.parse(`${post.displayDate}T00:00:00Z`)) ||
      new Date(`${post.displayDate}T00:00:00Z`).toISOString().slice(0, 10) !== post.displayDate) {
      throw new Error(`Post ${post.id} has invalid displayDate`)
    }
  }
  cached = data
  return data
}

export function exportedRoutes(): string[] {
  const snapshot = getSnapshot()
  return [
    '/', '/vehicles', '/member', '/posts', '/missions',
    ...Array.from({ length: postPageCount(snapshot.posts.length) - 1 }, (_, index) => `/posts/page/${index + 2}`),
    ...snapshot.taxonomy.types.map((type) => `/vehicles/types/${type.id}`),
    ...snapshot.taxonomy.series.map((series) => `/vehicles/types/${series.typeId}/${series.id}`),
    ...snapshot.vehicles.map((vehicle) => `/vehicles/${vehicle.slug}`),
    ...snapshot.missions.map((mission) => `/missions/${mission.id}`),
    ...snapshot.posts.map((post) => post.source === 'legacy' ? `/posts/legacy/${post.slug}` : `/posts/${post.id}`),
  ]
}

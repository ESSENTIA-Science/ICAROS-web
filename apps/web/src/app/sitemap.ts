import type { MetadataRoute } from 'next'
import { exportedRoutes, getSnapshot } from '@/lib/content/snapshot'

export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = getSnapshot().publishedAt
  return exportedRoutes().map((route) => ({
    url: new URL(route, 'https://icaros.kr').toString(),
    lastModified,
  }))
}

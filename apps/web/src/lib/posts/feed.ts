import 'server-only'
import { getSnapshot } from '@/lib/content/snapshot'
import { visiblePosts } from './visible.mjs'
export type FeedThumb = { readonly kind: 'media' | 'external'; readonly src: string }
export type FeedItem = { readonly id: string; readonly href: string; readonly title: string; readonly displayDate: string; readonly source: 'community' | 'legacy'; readonly excerpt: string; readonly thumb: FeedThumb | null }
export type Feed = { readonly items: readonly FeedItem[]; readonly hasNext: boolean; readonly communityUnavailable: boolean }
export function getFeed(page: number, size: number): Feed {
  const posts = visiblePosts(getSnapshot().posts).map((post): FeedItem => ({
    id: post.id, href: post.source === 'legacy' ? `/posts/legacy/${post.slug}` : `/posts/${post.id}`,
    title: post.title, displayDate: post.displayDate, source: post.source, excerpt: post.excerpt, thumb: post.thumb,
  })).sort((a, b) => b.displayDate.localeCompare(a.displayDate) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id))
  return { items: posts.slice(page * size, (page + 1) * size), hasNext: posts.length > (page + 1) * size, communityUnavailable: false }
}

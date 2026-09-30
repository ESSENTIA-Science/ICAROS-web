import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSnapshot } from '@/lib/content/snapshot'
import { PostsListing } from '../../PostsListing'

export const dynamicParams = false
export function generateStaticParams(): { page: string }[] {
  const count = Math.ceil(getSnapshot().posts.length / 12) - 1
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({ page: String(index + 2) }))
}
export async function generateMetadata({ params }: { params: Promise<{ page: string }> }): Promise<Metadata> {
  const { page } = await params
  return { title: `Posts · ${page}`, alternates: { canonical: `/posts/page/${page}` } }
}
export default async function PostsPageNumber({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params
  const number = Number(page)
  if (!Number.isInteger(number) || number < 2 ||
    (number > Math.ceil(getSnapshot().posts.length / 12) && getSnapshot().posts.length > 12)) notFound()
  return <PostsListing page={number - 1} />
}

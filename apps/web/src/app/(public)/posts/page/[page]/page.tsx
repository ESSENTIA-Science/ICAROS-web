import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSnapshot } from '@/lib/content/snapshot'
import { postPageCount } from '@/lib/posts/pagination'
import { PostsListing } from '../../PostsListing'
import { pageMetadata } from '@/lib/seo'

export const dynamicParams = true
export const revalidate = 3600
export function generateStaticParams(): { page: string }[] {
  const count = postPageCount(getSnapshot().posts.length) - 1
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({ page: String(index + 2) }))
}
export async function generateMetadata({ params }: { params: Promise<{ page: string }> }): Promise<Metadata> {
  const { page } = await params
  return pageMetadata({ title: `Posts · ${page}`, description: `ICAROS의 제작·시험·발사 기록 ${page}페이지입니다.`, path: `/posts/page/${page}` })
}
export default async function PostsPageNumber({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params
  const number = Number(page)
  if (!Number.isInteger(number) || number < 2 || number > postPageCount(getSnapshot().posts.length)) notFound()
  return <PostsListing page={number - 1} />
}

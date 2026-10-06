import type { Metadata } from 'next'
import { PostsListing } from './PostsListing'
import { pageMetadata } from '@/lib/seo'
export const revalidate = 3600
export const metadata: Metadata = pageMetadata({ title: 'Posts', description: 'ICAROS 학생 항공우주팀의 기체 제작, 시험, 발사 과정을 기록합니다.', path: '/posts' })
export default function PostsPage() { return <PostsListing page={0} /> }

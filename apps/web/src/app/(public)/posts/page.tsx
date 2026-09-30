import type { Metadata } from 'next'
import { PostsListing } from './PostsListing'
export const metadata: Metadata = { title: 'Posts', description: 'ICAROS의 제작·시험·발사 기록.', alternates: { canonical: '/posts' } }
export default function PostsPage() { return <PostsListing page={0} /> }

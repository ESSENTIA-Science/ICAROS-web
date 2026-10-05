import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PostMarkdown from '@/components/posts/PostMarkdown'
import { getSnapshot } from '@/lib/content/snapshot'
import { pageMetadata, excerptDescription } from '@/lib/seo'
import styles from '../../[id]/page.module.css'
export const dynamicParams = true
export const revalidate = 3600
export function generateStaticParams() {
  const posts = getSnapshot().posts.filter(post => post.source === 'legacy')
  return posts.map(post => ({ slug: post.slug! }))
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = getSnapshot().posts.find(post => post.source === 'legacy' && post.slug === slug)
  return post ? pageMetadata({ title: post.title, description: excerptDescription(post.excerpt || post.contentMd, 'ICAROS의 제작·시험·발사 기록.'), path: `/posts/legacy/${slug}`, image: post.thumb?.src, type: 'article' }) : { title: '기록을 찾을 수 없습니다', robots: { index: false } }
}
export default async function LegacyPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getSnapshot().posts.find(post => post.source === 'legacy' && post.slug === slug)
  if (!post) notFound()
  return <section data-section-theme="ink" data-palette="mono" className={styles.section}>
    <div className={`container ${styles.inner}`}>
      <Link href="/posts" className={styles.back}>목록으로</Link>
      <h1 className={styles.title}>{post.title}</h1>
      <p className={styles.meta}><time dateTime={post.displayDate} className="num">{post.displayDate}</time></p>
      <div className={styles.prose}><PostMarkdown content={post.contentMd} attachments={post.attachments} /></div>
    </div>
  </section>
}

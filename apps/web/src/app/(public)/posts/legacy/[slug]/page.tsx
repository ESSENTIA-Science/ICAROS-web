import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PostAttachments from '@/components/posts/PostAttachments'
import { getSnapshot } from '@/lib/content/snapshot'
import styles from '../../[id]/page.module.css'
export const dynamicParams = false
export function generateStaticParams() { return getSnapshot().posts.filter(post => post.source === 'legacy').map(post => ({ slug: post.slug! })) }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = getSnapshot().posts.find(post => post.source === 'legacy' && post.slug === slug)
  return { title: post?.title ?? '기록', alternates: { canonical: `/posts/legacy/${slug}` } }
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
      <div className={styles.prose}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{post.contentMd}</ReactMarkdown></div>
      <PostAttachments attachments={post.attachments} />
    </div>
  </section>
}

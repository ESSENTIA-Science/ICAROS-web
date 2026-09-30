import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PostAttachments from '@/components/posts/PostAttachments'
import { getSnapshot } from '@/lib/content/snapshot'
import styles from './page.module.css'
export const dynamicParams = false
export function generateStaticParams() {
  const posts = getSnapshot().posts.filter(post => post.source === 'community')
  // Static export needs one parameter even when the local archive has no ESSENTIA posts.
  // The placeholder is removed from out/ by postbuild.
  return posts.length ? posts.map(post => ({ id: post.id })) : [{ id: '__empty-community' }]
}
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const post = getSnapshot().posts.find(post => post.source === 'community' && post.id === id)
  return { title: post?.title ?? '기록', alternates: { canonical: `/posts/${id}` } }
}
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const post = getSnapshot().posts.find(post => post.source === 'community' && post.id === id)
  if (!post) notFound()
  return <section data-section-theme="ink" data-palette="mono" className={styles.section}>
    <article className={`container ${styles.inner}`}>
      <Link href="/posts" className={styles.back}>목록으로</Link>
      <h1 className={styles.title}>{post.title}</h1>
      <p className={styles.meta}><time dateTime={post.displayDate} className="num">{post.displayDate}</time></p>
      <div className={styles.prose}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{post.contentMd}</ReactMarkdown></div>
      <PostAttachments attachments={post.attachments} />
      <div className={styles.footer}><Link href="/posts" className={styles.back}>목록으로</Link>
      {post.forumPostId ? <a className={styles.link} href={`https://www.essentia-sci.org/community/${encodeURIComponent(post.forumPostId)}`} target="_blank" rel="noreferrer">ESSENTIA 커뮤니티에서 보기</a> : null}</div>
    </article>
  </section>
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getIcarosPost } from '@/lib/community/client'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const r = await getIcarosPost(id)
  if (!r.ok) return { title: '기록' }
  return {
    title: r.data.title,
    description: r.data.excerpt || undefined,
    alternates: { canonical: `/posts/${id}` },
  }
}

const fmtDate = (iso: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export default async function PostDetailPage({ params }: Params) {
  const { id } = await params
  const r = await getIcarosPost(id)

  // 상류 장애와 "없는 글"을 구분한다. 장애를 404 로 만들면 색인에서 글이 사라진다.
  if (!r.ok && (r.reason === 'not_found' || r.reason === 'bad_response')) notFound()

  if (!r.ok) {
    return (
      <section data-section-theme="ink" className={styles.section}>
        <div className={`container ${styles.inner}`}>
          <p role="alert" className={styles.notice}>지금 이 기록을 불러올 수 없습니다.</p>
          <Link href="/posts" className={styles.back}>목록으로</Link>
        </div>
      </section>
    )
  }

  const post = r.data
  return (
    <section data-section-theme="ink" className={styles.section}>
      <article className={`container ${styles.inner}`}>
        <h1 className={styles.title}>{post.title}</h1>
        <p className={styles.meta}>
          <time dateTime={post.createdAt} className="num">{fmtDate(post.createdAt)}</time>
          <span>{post.authorName}</span>
        </p>

        {/* skipHtml: 상류 본문은 우리가 통제하지 않는다. 원시 HTML 을 렌더하지 않는다. */}
        <div className={styles.prose}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {post.contentMd}
          </ReactMarkdown>
        </div>

        <div className={styles.footer}>
          <Link href="/posts" className={styles.back}>목록으로</Link>
          <a
            className={styles.link}
            href={`https://www.essentia-sci.org/community/${post.id}`}
            target="_blank"
            rel="noreferrer"
          >
            ESSENTIA 커뮤니티에서 보기
          </a>
        </div>
      </article>
    </section>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getIcarosPost } from '@/lib/community/client'
import styles from './page.module.css'

/**
 * **시간 기반 ISR 5분.** 이 화면의 원본은 ESSENTIA Community 이고 글은 **우리 밖에서** 고쳐진다 —
 * `revalidatePath` 를 부를 주체가 우리 쪽에 없으므로 시간이 유일한 무효화 신호다.
 * 목록(`/posts`)의 60초보다 길게 잡은 것은 상세가 수정 빈도가 더 낮기 때문이다.
 *
 * 대가를 적어 둔다: 상류가 `unreachable` 일 때 이 페이지는 200 + "지금 불러올 수 없습니다" 를
 * 렌더하는데(색인에서 사라지지 않게 404 로 만들지 않는다 — D23), 그 응답도 캐시된다.
 * 즉 상류 장애가 잠깐이어도 그 글은 **최대 5분** 안내 문구로 굳는다.
 */
export const revalidate = 300

/**
 * 빈 배열이 이 라우트를 `● (SSG)` 로 만든다 — 이 함수가 없으면 `revalidate` 값과 무관하게
 * `ƒ (Dynamic)` 으로 남아 엣지 캐시가 0이다(2026-09-06 빌드 표로 실측).
 * 상류 목록을 여기서 읽어 오지 말 것 — 배포 빌드가 ESSENTIA 도달성에 묶인다.
 */
export function generateStaticParams(): { id: string }[] {
  return []
}

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

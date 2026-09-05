import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { legacyPosts } from '@/lib/db/schema'
import styles from '../../[id]/page.module.css'

/**
 * 레거시 기록 상세 — **우리 DB 가 원본**이다 (D23 개정).
 *
 * 신규 글(`/posts/[id]`)은 ESSENTIA 에서 오고, 이 라우트는 이관된 19건만 다룬다.
 * 조판은 신규 상세와 **같은 CSS 모듈을 공유**한다 — 원본이 어디냐는 우리 사정이지
 * 읽는 사람이 화면에서 느낄 차이가 아니다.
 *
 * `loading.tsx` 를 두지 않는다. `notFound()` 위에 loading 경계가 생기면 셸이 먼저 flush 되어
 * 404 가 200 으로 굳는다.
 */
/**
 * **만료되지 않는 ISR.** 이관된 19건짜리 고정 아카이브라 늘지도 바뀌지도 않는다.
 *
 * 단서를 남겨 둔다: 이 라우트를 무효화하는 `revalidatePath` 가 **저장소 어디에도 없다.**
 * `/admin` 에 `legacy_posts` 편집기가 없기 때문인데(PostsPanel 은 읽기 전용), 뒤집어 말하면
 * 누가 SQL 로 `published=false` 를 해도 **다음 배포 전까지 캐시된 페이지가 계속 보인다.**
 * 이 아카이브에 쓰기 경로가 생기면 그 액션에 `revalidatePath('/posts/legacy/[slug]', 'page')` 를
 * 같이 붙이거나, 여기를 시간 기반(예: 3600)으로 바꿔라.
 */
export const revalidate = false

/**
 * 빈 배열이 이 라우트를 `● (SSG)` 로 만든다 — 이 함수가 없으면 `revalidate` 값과 무관하게
 * `ƒ (Dynamic)` 으로 남아 엣지 캐시가 0이다(2026-09-06 빌드 표로 실측).
 * **여기서 slug 를 DB 로 읽어 오지 말 것.** 읽는 순간 배포 빌드가 RDS 도달성을 필수로 요구한다.
 */
export function generateStaticParams(): { slug: string }[] {
  return []
}

type Params = { params: Promise<{ slug: string }> }

async function load(slug: string) {
  const rows = await db
    .select({
      title: legacyPosts.title,
      contentMd: legacyPosts.contentMd,
      publishedAt: legacyPosts.publishedAt,
    })
    .from(legacyPosts)
    // 내린 글은 상세도 404 다. 목록에서만 감추면 링크를 아는 사람에게는 그대로 보인다.
    .where(and(eq(legacyPosts.slug, slug), eq(legacyPosts.published, true)))
    .limit(1)
  return rows[0] ?? null
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await load(slug)
  if (!post) return { title: '기록' }
  return { title: post.title, alternates: { canonical: `/posts/legacy/${slug}` } }
}

const fmtDate = (d: Date): string => {
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10)
}

export default async function LegacyPostPage({ params }: Params) {
  const { slug } = await params
  const post = await load(slug)
  if (!post) notFound()

  return (
    <section data-section-theme="ink" data-palette="mono" className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <Link href="/posts" className={styles.back}>목록으로</Link>

        <h1 className={styles.title}>{post.title}</h1>
        <p className={styles.meta}>
          <time dateTime={post.publishedAt.toISOString()} className="num">
            {fmtDate(post.publishedAt)}
          </time>
        </p>

        {/* 본문의 이미지 URL 은 이관 때 `/api/media/{id}` 로 치환됐다.
            레거시 스토리지 호스트가 남아 있으면 DB CHECK 가 애초에 저장을 막는다. */}
        <div className={styles.prose}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.contentMd}</ReactMarkdown>
        </div>
      </div>
    </section>
  )
}

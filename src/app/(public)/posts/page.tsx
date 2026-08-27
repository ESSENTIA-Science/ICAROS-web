import type { Metadata } from 'next'
import Link from 'next/link'
import { getFeed } from '@/lib/posts/feed'
import styles from './page.module.css'

/**
 * 기록 목록 — **두 원본을 이어 붙인다** (D23 개정).
 *
 * 최신은 ESSENTIA Community, 그 뒤는 우리 DB 의 레거시 19건이다. 두 집합은 겹치지 않으므로
 * "복제하지 않는다"는 원칙은 그대로다 — 각 글의 원본이 정확히 한 곳이다.
 * 합치는 규칙과 페이지 경계 처리는 `lib/posts/feed.ts` 한 곳에 있다.
 *
 * 캐시하지 않는다. ESSENTIA 에서 글을 쓰면 여기 즉시 나와야 한다는 것이 요구사항이다.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Posts',
  description: 'ICAROS의 제작·시험·발사 기록.',
}

const PAGE_SIZE = 12

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page
  const parsed = Number(raw)
  const page = Number.isInteger(parsed) && parsed > 0 ? parsed : 0

  const feed = await getFeed(page, PAGE_SIZE)

  return (
    <section data-section-theme="ink" className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <p className="eyebrow" lang="en">Posts</p>
        <h1 className={styles.title}>기록</h1>

        {feed.items.length === 0 ? (
          feed.communityUnavailable ? (
            <div role="alert" className={styles.notice}>
              <p>지금 기록을 불러올 수 없습니다.</p>
              <a className={styles.link} href="https://www.essentia-sci.org/community" target="_blank" rel="noreferrer">
                ESSENTIA 커뮤니티에서 보기
              </a>
            </div>
          ) : (
            <p className={styles.notice}>아직 올라온 기록이 없습니다.</p>
          )
        ) : (
          <>
            {/* 상류가 죽어도 레거시는 보인다. 그 상태를 숨기지 않고 한 줄로 적는다 —
                목록이 짧아진 이유를 방문자가 알 수 있어야 한다. */}
            {feed.communityUnavailable ? (
              <p role="alert" className={styles.notice}>
                최신 기록을 지금 불러올 수 없습니다. 아래는 이전 기록입니다.
              </p>
            ) : null}

            <ol className={styles.list}>
              {feed.items.map((p, i) => (
                <li key={p.id} className={styles.item}>
                  <Link href={p.href} className={styles.card}>
                    <span className={styles.index}>{String(page * PAGE_SIZE + i + 1).padStart(2, '0')}</span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardTitle}>{p.title}</span>
                      <span className={styles.meta}>
                        <time dateTime={p.date} className="num">{p.date}</time>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>

            <nav className={styles.pager} aria-label="페이지">
              {page > 0 ? (
                <Link href={page === 1 ? '/posts' : `/posts?page=${page - 1}`} className={styles.link}>
                  이전
                </Link>
              ) : null}
              <span className={`${styles.pageNum} num`}>{page + 1}</span>
              {feed.hasNext ? (
                <Link href={`/posts?page=${page + 1}`} className={styles.link}>다음</Link>
              ) : null}
            </nav>
          </>
        )}

        <p className={styles.source}>
          최신 기록은 ESSENTIA 커뮤니티의 ICAROS 게시판이 원본이고, 그 이전 기록은 ICAROS 가 직접 보관합니다.
        </p>
      </div>
    </section>
  )
}

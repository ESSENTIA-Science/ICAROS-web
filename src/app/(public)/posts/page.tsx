import type { Metadata } from 'next'
import Link from 'next/link'
import { listIcarosPosts } from '@/lib/community/client'
import styles from './page.module.css'

/**
 * ESSENTIA Community 의 ICAROS 게시판을 그대로 보여준다 (DECISIONS D1).
 * 우리 DB 에 복제하지 않으므로 **양쪽이 항상 같은 글을 보여준다** — 동기화 코드가 없으니 갈라질 수도 없다.
 *
 * 캐시하지 않는다. ESSENTIA 에서 글을 쓰면 여기 즉시 나와야 한다는 것이 요구사항이다.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Posts',
  description: 'ICAROS의 제작·시험·발사 기록.',
}

const PAGE_SIZE = 12

const fmtDate = (iso: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page
  const parsed = Number(raw)
  const page = Number.isInteger(parsed) && parsed > 0 ? parsed : 0

  const result = await listIcarosPosts(page, PAGE_SIZE)

  return (
    <section data-section-theme="ink" className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <p className="eyebrow" lang="en">Posts</p>
        <h1 className={styles.title}>기록</h1>

        {!result.ok ? (
          <div role="alert" className={styles.notice}>
            <p>지금 기록을 불러올 수 없습니다.</p>
            <a className={styles.link} href="https://www.essentia-sci.org/community" target="_blank" rel="noreferrer">
              ESSENTIA 커뮤니티에서 보기
            </a>
          </div>
        ) : result.data.items.length === 0 ? (
          <p className={styles.notice}>아직 올라온 기록이 없습니다.</p>
        ) : (
          <>
            <ol className={styles.list}>
              {result.data.items.map((p, i) => (
                <li key={p.id} className={styles.item}>
                  <Link href={`/posts/${p.id}`} className={styles.card}>
                    <span className={styles.index}>{String(page * PAGE_SIZE + i + 1).padStart(2, '0')}</span>
                    <span className={styles.cardBody}>
                      <span className={styles.cardTitle}>{p.title}</span>
                      {p.excerpt ? <span className={styles.excerpt}>{p.excerpt}</span> : null}
                      <span className={styles.meta}>
                        <time dateTime={p.createdAt} className="num">{fmtDate(p.createdAt)}</time>
                        <span>{p.authorName}</span>
                        {p.commentCount > 0 ? <span className="num">댓글 {p.commentCount}</span> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>

            {result.data.totalPages > 1 ? (
              <nav className={styles.pager} aria-label="페이지">
                {page > 0 ? (
                  <Link href={page === 1 ? '/posts' : `/posts?page=${page - 1}`} className={styles.link}>
                    이전
                  </Link>
                ) : null}
                <span className={`${styles.pageNum} num`}>
                  {page + 1} / {result.data.totalPages}
                </span>
                {page + 1 < result.data.totalPages ? (
                  <Link href={`/posts?page=${page + 1}`} className={styles.link}>다음</Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}

        <p className={styles.source}>
          이 기록은 ESSENTIA 커뮤니티의 ICAROS 게시판과 같은 원본입니다.
        </p>
      </div>
    </section>
  )
}

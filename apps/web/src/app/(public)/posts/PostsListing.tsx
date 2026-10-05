import Link from 'next/link'
import PostCard from '@/components/posts/PostCard'
import { instagramHandle, instagramUrl } from '@/lib/content'
import { getSnapshot } from '@/lib/content/snapshot'
import { getFeed } from '@/lib/posts/feed'
import { POSTS_PAGE_SIZE, postPageCount } from '@/lib/posts/pagination'
import { visiblePosts } from '@/lib/posts/visible.mjs'
import styles from './page.module.css'

/** 외부 링크 표시. 아이콘 폰트도 글리프도 쓰지 않는다 — Contact 행 끝의 1px 화살표와 같은 도형이다. */
function ExternalArrow() {
  return (
    <svg viewBox="0 0 16 16" className={styles.socialArrow} aria-hidden="true">
      <path
        d="M3 13 13 3M6 3h7v7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="square"
      />
    </svg>
  )
}

export function PostsListing({ page }: { page: number }) {
  const snapshot = getSnapshot()
  const feed = getFeed(page, POSTS_PAGE_SIZE)
  const content = snapshot.site
  const totalPages = postPageCount(visiblePosts(snapshot.posts).length)
  // 값이 없으면 아무것도 그리지 않는다. 랜딩 섹션들과 같은 규칙이다.
  const instagram = content['contact.instagram']

  /**
   * 선점으로 받을 사진 한 장. **"첫 카드"가 아니라 "사진이 있는 첫 카드"다.**
   *
   * 첫 카드에 사진이 없는 일이 실제로 흔하다 — 상류 글 다수가 본문에 쓸 수 있는 사진이
   * 없어서 대체 면으로 나가고, 목록은 날짜순이라 그런 글이 맨 앞에 오는 것을 우리가 정할 수
   * 없다. `i === 0` 으로 두면 그 순간 선점이 아무 데도 걸리지 않고 LCP 이미지는 다시
   * `lazy` 가 된다 (2026-08-28 실측: 첫 칸이 사진 없는 글이었다).
   *
   * 첫 세 카드 밖은 켜지 않는다. 한 열에서도 첫 화면에 걸칠 수 있는 범위만 선점한다.
   */
  const found = feed.items.findIndex((p) => p.thumb !== null)
  const lcpIndex = found >= 0 && found < 3 ? found : -1

  return (
    <section data-section-theme="ink" className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <header className={styles.head}>
          <h1 className={styles.title}>기록</h1>

          {instagram ? (
            <a
              className={styles.social}
              href={instagramUrl(instagram)}
              target="_blank"
              rel="noreferrer"
            >
              <span className={styles.socialLabel} lang="en">Instagram</span>
              <span className={styles.socialHandle}>@{instagramHandle(instagram)}</span>
              <ExternalArrow />
            </a>
          ) : null}
        </header>

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

            {/* 번호를 뗐다. 괘선 목록에서는 위치가 정보였지만, 격자에서 "07" 은 몇 번째 열
                몇 번째 행인지와 어긋나 오히려 읽는 사람을 헷갈리게 한다. */}
            <ol className={styles.grid}>
              {feed.items.map((p, i) => (
                <PostCard key={p.id} post={p} priority={i === lcpIndex} />
              ))}
            </ol>

            <nav className={styles.pager} aria-label="페이지">
              {page > 0 ? (
                <Link href={page === 1 ? '/posts' : `/posts/page/${page}`} className={styles.link}>
                  이전
                </Link>
              ) : null}
              <ol className={styles.pageList}>
                {Array.from({ length: totalPages }, (_, index) => (
                  <li key={index}>
                    <Link
                      href={index === 0 ? '/posts' : `/posts/page/${index + 1}`}
                      className={styles.pageNum}
                      aria-current={index === page ? 'page' : undefined}
                      aria-label={`${index + 1}페이지`}
                    >
                      {index + 1}
                    </Link>
                  </li>
                ))}
              </ol>
              {feed.hasNext ? (
                <Link href={`/posts/page/${page + 2}`} className={styles.link}>다음</Link>
              ) : null}
            </nav>
          </>
        )}
      </div>
    </section>
  )
}

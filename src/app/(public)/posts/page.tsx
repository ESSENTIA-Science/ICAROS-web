import type { Metadata } from 'next'
import Link from 'next/link'
import styles from './page.module.css'

/**
 * `/posts` 임시 페이지.
 *
 * 헤더 내비가 이 경로를 링크하는데 라우트가 없어 **사이트 스스로 404 로 보내고 있었다.**
 * 실제 목록은 ESSENTIA Community 의 ICAROS 게시판이 단일 원본이고(DECISIONS D1),
 * 서비스 토큰이 붙기 전까지는 읽기조차 불가능하다 — RDS 가 VPC 안이라 DB 직접 조회도 막혔다.
 *
 * 그래서 가짜 목록을 만들지 않고 상태를 그대로 보여준다.
 * 링크는 ESSENTIA 커뮤니티로 보낸다 — 거기에 ICAROS 글이 실제로 있다.
 */
export const metadata: Metadata = {
  title: 'Posts',
  description: 'ICAROS의 제작·시험·발사 기록.',
  robots: { index: false, follow: true },
}

export default function PostsPage() {
  return (
    <section data-section-theme="ink" className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <p className="eyebrow" lang="en">Posts</p>
        <h1 className={styles.title}>기록</h1>
        <p className={styles.body}>
          ICAROS의 제작·시험·발사 기록은 ESSENTIA 커뮤니티의 ICAROS 게시판에 있습니다.
          {'\n'}이 페이지에서 바로 보여드리는 연동은 준비 중입니다.
        </p>
        <a
          className={styles.link}
          href="https://www.essentia-sci.org/community"
          target="_blank"
          rel="noreferrer"
        >
          ESSENTIA 커뮤니티에서 보기
        </a>
        <Link className={styles.back} href="/">홈으로</Link>
      </div>
    </section>
  )
}

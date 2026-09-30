import { getSiteContentSafe } from '@/lib/content'
import styles from './Footer.module.css'

/**
 * **던지지 않는 `getSiteContentSafe` 를 쓴다** (W4, 2026-09-06). Header 와 같은 사정이다 —
 * `(public)/layout.tsx` 에 있어 `/`·`/member` 의 빌드 타임 프리렌더에 같이 들어가고,
 * 던지면 RDS 에 닿지 못하는 빌드가 배포를 통째로 죽인다(D27).
 * 실패하면 저작권 줄이 빈다 — 랜딩 섹션들과 같은 규칙("값이 없으면 그 자리를 비운다")이다.
 */
export default async function Footer() {
  const c = await getSiteContentSafe()
  return (
    <footer className={styles.footer} data-theme="dark">
      <div className="container">
        <p className={styles.copy}>{c['footer.copyright']}</p>
      </div>
    </footer>
  )
}

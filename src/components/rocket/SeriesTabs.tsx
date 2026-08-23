import Link from 'next/link'
import { SERIES, type RocketSeries } from './series'
import styles from './SeriesTabs.module.css'

type Props = {
  active: RocketSeries
  counts: Record<RocketSeries, number>
}

/**
 * 탭을 버튼이 아니라 링크로 둔 이유: 시리즈가 URL(`?series=B`)에 남아야 공유·뒤로가기가 되고,
 * 그러면 상태가 서버에 있으니 이 컴포넌트에 클라이언트 JS 가 하나도 필요 없다.
 */
export default function SeriesTabs({ active, counts }: Props) {
  return (
    <nav className={styles.tabs} aria-label="로켓 시리즈">
      <ul className={styles.list}>
        {SERIES.map((s) => {
          const current = s.id === active
          return (
            <li key={s.id}>
              <Link
                href={s.id === 'A' ? '/rocket' : `/rocket?series=${s.id}`}
                className={styles.tab}
                data-active={current || undefined}
                aria-current={current ? 'page' : undefined}
                scroll={false}
              >
                <span lang="en">{s.label}</span>
                <span className={`${styles.count} num`} aria-hidden="true">
                  {counts[s.id]}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

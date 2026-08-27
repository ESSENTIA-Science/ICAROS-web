import Link from 'next/link'
import { seriesHref, type RocketSeries, type RocketSeriesOption } from './series'
import styles from './SeriesTabs.module.css'

type Props = {
  active: RocketSeries
  /** 카테고리 목록. `icaros.rocket_series` 행이 원본이라 상수로 들고 있지 않는다. */
  all: readonly RocketSeriesOption[]
  counts: Record<string, number>
}

/**
 * 탭을 버튼이 아니라 링크로 둔 이유: 시리즈가 URL(`?series=B`)에 남아야 공유·뒤로가기가 되고,
 * 그러면 상태가 서버에 있으니 이 컴포넌트에 클라이언트 JS 가 하나도 필요 없다.
 */
export default function SeriesTabs({ active, all, counts }: Props) {
  // 카테고리가 하나뿐이면 탭이 선택지를 주지 못한다 — 고를 것이 없는 내비게이션은 지운다.
  if (all.length < 2) return null

  return (
    <nav className={styles.tabs} aria-label="로켓 시리즈">
      <ul className={styles.list}>
        {all.map((s) => {
          const current = s.id === active
          return (
            <li key={s.id}>
              <Link
                href={seriesHref(s.id, all)}
                className={styles.tab}
                data-active={current || undefined}
                aria-current={current ? 'page' : undefined}
                scroll={false}
              >
                <span lang="en">{s.label}</span>
                <span className={`${styles.count} num`} aria-hidden="true">
                  {counts[s.id] ?? 0}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

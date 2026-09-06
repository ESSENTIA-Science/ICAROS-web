import Link from 'next/link'
import { textLang } from '@/components/landing/text-lang'
import styles from './TabNav.module.css'

export type TabItem = {
  id: string
  label: string
  href: string
}

type Props = {
  items: readonly TabItem[]
  /** 현재 선택된 항목의 id. */
  active: string
  /** `aria-label`. 한 화면에 탭 줄이 둘이라 이름이 없으면 스크린리더가 둘을 구분하지 못한다. */
  label: string
  /**
   * `primary` 는 분류(ROCKETS/SATELLITES/UAVs), `secondary` 는 그 안의 시리즈다.
   * 두 줄이 같은 크기로 붙어 있으면 어느 쪽이 어느 쪽을 좁히는지 읽히지 않는다.
   */
  level: 'primary' | 'secondary'
}

/**
 * 탭 줄. 분류·시리즈가 같은 컴포넌트를 쓴다 — 둘은 계층만 다르고 성격이 같다.
 *
 * 탭을 버튼이 아니라 링크로 둔 이유: 선택이 URL(`?type=uavs&series=B`)에 남아야 공유·뒤로가기가
 * 되고, 그러면 상태가 서버에 있으니 이 컴포넌트에 클라이언트 JS 가 하나도 필요 없다.
 */
export default function TabNav({ items, active, label, level }: Props) {
  // 선택지가 하나뿐이면 탭이 고를 것을 주지 못한다 — 고를 것이 없는 내비게이션은 지운다.
  if (items.length < 2) return null

  return (
    <nav className={styles.tabs} data-level={level} aria-label={label}>
      <ul className={styles.list}>
        {items.map((item) => {
          const current = item.id === active
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className={styles.tab}
                data-active={current || undefined}
                aria-current={current ? 'page' : undefined}
                scroll={false}
              >
                {/* 라벨은 CMS 자유 텍스트다 — 언어를 값에서 판별한다.
                    `lang="en"` 을 박아 두면 한국어 라벨에 mono 자간 0.06em 이 그대로 걸린다. */}
                <span className={styles.label} lang={textLang(item.label)}>
                  {item.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

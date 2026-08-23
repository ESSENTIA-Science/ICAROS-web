import Section, { type SectionTheme } from './Section'
import styles from './Mission.module.css'

/**
 * Mission — 본문 + 리스트 도입문 + 활동 목록.
 * 레거시는 "주요 활동은 다음과 같습니다."를 JSX 에 하드코딩했었다 (요구사항 B5).
 * 지금은 mission.list_intro 키로 내려온다 — 값이 없으면 그 줄을 아예 그리지 않는다.
 */
export default function Mission({
  id,
  label,
  index,
  theme,
  body,
  listIntro,
  items,
}: {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  body: string | undefined
  listIntro: string | undefined
  items: readonly string[]
}) {
  return (
    <Section id={id} label={label} index={index} theme={theme}>
      <div className={styles.layout}>
        {body ? <p className={styles.body}>{body}</p> : null}

        {items.length > 0 ? (
          <div className={styles.listWrap}>
            {listIntro ? <p className={styles.listIntro}>{listIntro}</p> : null}
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item} className={styles.item}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

import Section, { type SectionTheme } from './Section'
import styles from './Mission.module.css'

export type MissionContent = {
  body: string | undefined
  listIntro: string | undefined
  items: readonly string[]
}

/**
 * 빈 섹션 규칙. listIntro 는 목록이 있을 때만 그려지므로 그것만으로는 내용으로 치지 않는다 —
 * 도입문 한 줄과 텅 빈 <ul> 만 남기는 게 정확히 피하려는 상태다.
 */
export function hasMissionContent(c: MissionContent): boolean {
  return Boolean(c.body) || c.items.length > 0
}

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
}: MissionContent & {
  id: string
  label: string
  index: number
  theme?: SectionTheme
}) {
  if (!hasMissionContent({ body, listIntro, items })) return null

  return (
    <Section id={id} label={label} index={index} theme={theme}>
      <div className={styles.layout}>
        {body ? <p className={styles.body}>{body}</p> : null}

        {items.length > 0 ? (
          <div className={styles.listWrap}>
            {listIntro ? <p className={styles.listIntro}>{listIntro}</p> : null}
            <ul className={styles.list}>
              {/* 자유 텍스트라 같은 줄이 두 번 들어올 수 있다 — 본문을 key 로 쓰면 중복 key 가 난다 */}
              {items.map((item, i) => (
                <li key={`${i}-${item}`} className={styles.item}>
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

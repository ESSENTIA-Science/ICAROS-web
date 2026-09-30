import Reveal, { type RevealVariant } from './Reveal'
import { textLang } from './text-lang'
import styles from './Section.module.css'

/**
 * 섹션 테마 5값 (tokens.css `[data-section-theme]`).
 * 사용 비율은 밝은 쪽 ~80% / 어두운 쪽 ~20% — 배분은 page.tsx 가 한 곳에서 정한다.
 */
export type SectionTheme = 'white' | 'paper' | 'mist' | 'graphite' | 'ink'

/**
 * 섹션 h2 의 id. progressbar 처럼 헤딩을 접근 가능한 이름으로 빌려 쓰는 요소가 있어
 * 규칙을 한 곳에 둔다 — 문자열을 두 군데서 조립하면 조용히 어긋난다.
 */
export const sectionHeadingId = (id: string): string => `${id}-title`

/**
 * 랜딩 섹션 공통 껍데기.
 *
 * 조판의 핵심은 **큰 디스플레이 타입 ↔ 작은 기술 텍스트의 대비**다 (03 §3).
 * 그래서 h2 는 큰 글씨가 아니라 12px 대문자 모노 아이브로로 조판한다 — 큰 자리는 카피가 갖는다.
 * 헤딩 텍스트는 `page_sections.label` 그대로이고, 다만 CMS 편집 대상이라 언어를 값에서 판별한다.
 *
 * 끝단 눈금이 달린 1px 제도 치수선 + 6px 시그널 사각형이 이 껍데기의 전부다.
 * 시그널은 여기서 "면"이 아니라 "마크"로만 쓰인다 (03 §4).
 *
 * `index` 는 **받기만 하고 그리지 않는다.** `01` `02` 라벨은 화면에서 걷어냈지만,
 * 이 prop 을 지우면 Statement·Research·Mission·Donate·Contact 다섯 컴포넌트의
 * 시그니처까지 같이 흔들린다. 번호가 다시 필요해지면 여기서만 되살리면 된다.
 */
export default function Section({
  id,
  label,
  theme = 'paper',
  reveal = 'block',
  children,
}: {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  reveal?: RevealVariant
  children: React.ReactNode
}) {
  const headingId = sectionHeadingId(id)
  return (
    <section
      id={id}
      data-section-theme={theme}
      className={styles.section}
      aria-labelledby={headingId}
    >
      <div className="container">
        <header className={styles.head}>
          <h2 id={headingId} className={styles.label} lang={textLang(label)}>
            {label}
          </h2>
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.tick} aria-hidden="true" />
        </header>

        <Reveal className={styles.content} variant={reveal}>
          {children}
        </Reveal>
      </div>
    </section>
  )
}

import Reveal from './Reveal'
import { textLang } from './text-lang'
import styles from './Section.module.css'

export type SectionTheme = 'dark' | 'tint'

/**
 * 섹션 h2 의 id. progressbar 처럼 헤딩을 접근 가능한 이름으로 빌려 쓰는 요소가 있어
 * 규칙을 한 곳에 둔다 — 문자열을 두 군데서 조립하면 조용히 어긋난다.
 */
export const sectionHeadingId = (id: string): string => `${id}-title`

/**
 * 랜딩 섹션 공통 껍데기.
 *
 * 헤딩(h2)은 page_sections.label 을 그대로 쓴다 — 영문 섹션명이 곧 기술 레지스터의
 * 아이브로다 (요구사항: 섹션 헤딩과 아이브로만 영문). 한국어 카피는 전부 본문 <p> 로 내려간다.
 * 다만 label 은 CMS 편집 대상이라 언어를 값에서 판별한다 (text-lang.ts).
 * 인덱스 번호와 끝단 눈금이 달린 1px 괘선이 "설계도" 느낌을 만드는 유일한 장식이다.
 */
export default function Section({
  id,
  label,
  index,
  theme,
  children,
}: {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  children: React.ReactNode
}) {
  const headingId = sectionHeadingId(id)
  return (
    <section
      id={id}
      data-theme={theme}
      className={styles.section}
      aria-labelledby={headingId}
    >
      <div className="container">
        <header className={styles.head}>
          <h2 id={headingId} className={styles.title} lang={textLang(label)}>
            <span className={styles.index} aria-hidden="true">
              {String(index).padStart(2, '0')}
            </span>
            {label}
          </h2>
          <span className={styles.rule} aria-hidden="true" />
        </header>

        <Reveal className={styles.content}>{children}</Reveal>
      </div>
    </section>
  )
}

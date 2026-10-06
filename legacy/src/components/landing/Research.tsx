import Section, { type SectionTheme } from './Section'
import { textLang } from './text-lang'
import { revealIndex } from './reveal-style'
import styles from './Research.module.css'

export type ResearchBlock = {
  key: string
  title: string | undefined
  body: string | undefined
}

const isFilled = (b: ResearchBlock): boolean => Boolean(b.title || b.body)

/** 빈 섹션 규칙. 세 블록이 모두 비면 섹션을 그리지 않는다. */
export function hasResearchContent(blocks: readonly ResearchBlock[]): boolean {
  return blocks.some(isFilled)
}

/**
 * Research Areas — 3블록. 제목은 연구 분야명(보통 영문), 본문은 한국어.
 *
 * 블록마다 큰 모노 번호 + 1px 괘선으로 열어 준다 — 제원표와 같은 문법이다.
 * 블록이 세 개뿐이라 카드로 감싸지 않는다. 여백과 괘선만으로 세우는 편이
 * 성긴 콘텐츠를 "의도된 것"으로 읽히게 한다 (03 §Anti-patterns 6).
 */
export default function Research({
  id,
  label,
  index,
  theme,
  blocks,
}: {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  blocks: readonly ResearchBlock[]
}) {
  const filled = blocks.filter(isFilled)
  if (filled.length === 0) return null

  return (
    <Section id={id} label={label} index={index} theme={theme} reveal="group">
      <ul className={styles.grid}>
        {filled.map((block, i) => (
          <li key={block.key} className={styles.block} data-reveal-item="" style={revealIndex(i)}>
            <span className={styles.no} aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            {block.title ? (
              <h3 className={styles.title} lang={textLang(block.title)}>
                {block.title}
              </h3>
            ) : null}
            {block.body ? <p className={styles.body}>{block.body}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

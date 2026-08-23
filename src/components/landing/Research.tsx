import Section, { type SectionTheme } from './Section'
import { textLang } from './text-lang'
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

/** Research Areas — 3블록. 제목은 연구 분야명(보통 영문), 본문은 한국어. */
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
    <Section id={id} label={label} index={index} theme={theme}>
      <ul className={styles.grid}>
        {filled.map((block, i) => (
          <li key={block.key} className={styles.block}>
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

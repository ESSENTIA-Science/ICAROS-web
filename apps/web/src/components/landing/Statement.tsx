import Highlight from '@/components/ui/Highlight'
import Section, { type SectionTheme } from './Section'
import Words from './Words'
import { textLang } from './text-lang'
import { revealIndex } from './reveal-style'
import styles from './Statement.module.css'

export type StatementContent = {
  slogan: string | undefined
  body: string | undefined
}

/** 빈 섹션 규칙: 내용이 하나도 없으면 섹션 자체를 그리지 않는다. page.tsx 의 번호 매기기도 이걸 본다. */
export function hasStatementContent(c: StatementContent): boolean {
  return Boolean(c.slogan || c.body)
}

/**
 * About / Vision — 구조가 같다(슬로건 1줄 + 본문 1덩어리). 정렬만 다르므로 한 컴포넌트로 둔다.
 * 레거시는 같은 슬로건을 desktop/mobile 두 벌로 DOM 에 찍었는데(요구사항 B4), 여기서는 한 벌만
 * 렌더하고 배치는 CSS 가 바꾼다.
 *
 * `emphasis="words"` 는 슬로건을 단어 단위로 순차 리빌한다 — 레퍼런스가 페이지당 한 번만 쓰는
 * `highlight-text` 장치다 (03 §Anti-patterns: 페이지당 시그니처 1개). 나머지 섹션은 덩어리 리빌.
 */
export default function Statement({
  id,
  label,
  index,
  theme,
  variant,
  emphasis,
  slogan,
  body,
}: StatementContent & {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  variant: 'split' | 'center'
  emphasis?: 'words'
}) {
  if (!hasStatementContent({ slogan, body })) return null

  const words = emphasis === 'words'

  return (
    <Section
      id={id}
      label={label}
      index={index}
      theme={theme}
      reveal={words ? 'group' : 'block'}
    >
      <div className={variant === 'center' ? styles.center : styles.split}>
        {slogan ? (
          <p className={styles.slogan} lang={textLang(slogan)}>
            {words ? <Words text={slogan} /> : <Highlight text={slogan} />}
          </p>
        ) : null}
        {/* group 리빌에서는 부모가 들지 않으므로 본문이 스스로 순번을 갖는다 */}
        {body && words ? (
          <p className={styles.body} data-reveal-item="" style={revealIndex(2)}>
            {body}
          </p>
        ) : null}
        {body && !words ? <p className={styles.body}>{body}</p> : null}
      </div>
    </Section>
  )
}

import Highlight from '@/components/ui/Highlight'
import Section, { type SectionTheme } from './Section'
import styles from './Statement.module.css'

/**
 * About / Vision — 구조가 같다(슬로건 1줄 + 본문 1덩어리). 정렬만 다르므로 한 컴포넌트로 둔다.
 * 레거시는 같은 슬로건을 desktop/mobile 두 벌로 DOM 에 찍었는데(요구사항 B4), 여기서는 한 벌만
 * 렌더하고 배치는 CSS 가 바꾼다.
 */
export default function Statement({
  id,
  label,
  index,
  theme,
  variant,
  slogan,
  body,
}: {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  variant: 'split' | 'center'
  slogan: string | undefined
  body: string | undefined
}) {
  return (
    <Section id={id} label={label} index={index} theme={theme}>
      <div className={variant === 'center' ? styles.center : styles.split}>
        {slogan ? (
          <p className={styles.slogan} lang="en">
            <Highlight text={slogan} />
          </p>
        ) : null}
        {body ? <p className={styles.body}>{body}</p> : null}
      </div>
    </Section>
  )
}

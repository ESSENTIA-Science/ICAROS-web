import Section, { sectionHeadingId, type SectionTheme } from './Section'
import { textLang } from './text-lang'
import styles from './Donate.module.css'

const krw = new Intl.NumberFormat('ko-KR')

export type DonateContent = {
  intro: string | undefined
  usageTitle: string | undefined
  usageItems: readonly string[]
  quote: string | undefined
  outro: string | undefined
  current: number
  goal: number
  ctaLabel: string | undefined
  ctaHref: string | undefined
}

/**
 * 어느 덩어리를 그릴지 한 곳에서 정한다. 값 비움은 정상 운영 경로라(B10 로 폴백을 없앴다)
 * "목표 0원 중 0원, 0%" 같은 의미 없는 진행률이 남지 않도록 조각 단위로 판정한다.
 */
function parts(c: DonateContent) {
  const hasText = Boolean(c.intro || c.usageTitle) || c.usageItems.length > 0
  const hasFigures = c.goal > 0 || c.current > 0
  // 분모가 없으면 진행률이 성립하지 않는다 — 막대와 퍼센트는 목표가 있을 때만
  const hasMeter = c.goal > 0
  const hasCta = Boolean(c.ctaLabel && c.ctaHref)
  const hasPanel = Boolean(c.quote || c.outro) || hasFigures || hasCta
  return { hasText, hasFigures, hasMeter, hasCta, hasPanel }
}

/** 빈 섹션 규칙. 좌우 어느 쪽에도 내용이 없으면 섹션을 그리지 않는다. */
export function hasDonateContent(c: DonateContent): boolean {
  const p = parts(c)
  return p.hasText || p.hasPanel
}

/**
 * Donate — 후원 안내 + 진행률.
 *
 * 레거시의 `후원 문의하기` 버튼은 alert() 를 띄우고 앵커로도 이동했다 (요구사항 B8).
 * 여기서는 alert 없이 앵커만 남긴다. 인용구·마무리 문구도 하드코딩이 아니라 CMS 값이다 (B6).
 */
export default function Donate({
  id,
  label,
  index,
  theme,
  ...content
}: DonateContent & {
  id: string
  label: string
  index: number
  theme?: SectionTheme
}) {
  const { hasText, hasFigures, hasMeter, hasPanel } = parts(content)
  if (!hasText && !hasPanel) return null

  const { intro, usageTitle, usageItems, quote, outro, current, goal, ctaLabel, ctaHref } = content

  // 목표가 0 이거나 값이 깨져 있어도 0~100 밖으로 나가지 않는다
  const ratio = goal > 0 ? (current / goal) * 100 : 0
  const percent = Math.min(100, Math.max(0, ratio))
  const rounded = Math.round(percent)

  // progressbar 에는 이름이 있어야 한다 (WCAG 4.1.2). aria-valuetext 는 값이지 이름이 아니다.
  // 섹션 헤딩("Donate")만으로는 무엇의 진행률인지 모호해서 sr 전용 문구를 덧붙인다.
  const meterLabelId = `${id}-meter-label`

  return (
    <Section id={id} label={label} index={index} theme={theme}>
      <div className={styles.layout} data-single={hasText && hasPanel ? undefined : true}>
        {hasText ? (
          <div className={styles.text}>
            {intro ? <p className={styles.intro}>{intro}</p> : null}
            {usageTitle ? <h3 className={styles.usageTitle}>{usageTitle}</h3> : null}
            {usageItems.length > 0 ? (
              <ul className={styles.usageList}>
                {/* 자유 텍스트라 같은 줄이 두 번 들어올 수 있다 — 본문을 key 로 쓰면 중복 key 가 난다 */}
                {usageItems.map((item, i) => (
                  <li key={`${i}-${item}`} className={styles.usageItem}>
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {hasPanel ? (
          <div className={styles.panel}>
            <span className={styles.corner} aria-hidden="true" />

            {quote ? (
              <p className={styles.quote} lang={textLang(quote)}>
                {quote}
              </p>
            ) : null}

            {hasFigures ? (
              <div className={styles.figures}>
                <span className={styles.current}>{krw.format(current)}</span>
                {goal > 0 ? <span className={styles.goal}>/ {krw.format(goal)}</span> : null}
              </div>
            ) : null}

            {hasMeter ? (
              <>
                <span id={meterLabelId} className="sr-only">
                  모금 진행률
                </span>
                <div
                  className={styles.meter}
                  role="progressbar"
                  aria-labelledby={`${sectionHeadingId(id)} ${meterLabelId}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={rounded}
                  aria-valuetext={`목표 ${krw.format(goal)}원 중 ${krw.format(current)}원 모금, ${rounded}퍼센트`}
                >
                  <span className={styles.fill} style={{ width: `${percent}%` }} />
                </div>

                <p className={styles.percent} aria-hidden="true">
                  {rounded}%
                </p>
              </>
            ) : null}

            {ctaLabel && ctaHref ? (
              <a className={styles.cta} href={ctaHref}>
                <span className={styles.ctaWipe} aria-hidden="true" />
                <span className={styles.ctaText}>{ctaLabel}</span>
              </a>
            ) : null}

            {outro ? <p className={styles.outro}>{outro}</p> : null}
          </div>
        ) : null}
      </div>
    </Section>
  )
}

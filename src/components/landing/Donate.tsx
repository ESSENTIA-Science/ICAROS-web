import Section, { type SectionTheme } from './Section'
import styles from './Donate.module.css'

const krw = new Intl.NumberFormat('ko-KR')

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
  intro,
  usageTitle,
  usageItems,
  quote,
  outro,
  current,
  goal,
  ctaLabel,
  ctaHref,
}: {
  id: string
  label: string
  index: number
  theme?: SectionTheme
  intro: string | undefined
  usageTitle: string | undefined
  usageItems: readonly string[]
  quote: string | undefined
  outro: string | undefined
  current: number
  goal: number
  ctaLabel: string | undefined
  ctaHref: string | undefined
}) {
  // 목표가 0 이거나 값이 깨져 있어도 0~100 밖으로 나가지 않는다
  const ratio = goal > 0 ? (current / goal) * 100 : 0
  const percent = Math.min(100, Math.max(0, ratio))
  const rounded = Math.round(percent)

  return (
    <Section id={id} label={label} index={index} theme={theme}>
      <div className={styles.layout}>
        <div className={styles.text}>
          {intro ? <p className={styles.intro}>{intro}</p> : null}
          {usageTitle ? <h3 className={styles.usageTitle}>{usageTitle}</h3> : null}
          {usageItems.length > 0 ? (
            <ul className={styles.usageList}>
              {usageItems.map((item) => (
                <li key={item} className={styles.usageItem}>
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className={styles.panel}>
          <span className={styles.corner} aria-hidden="true" />

          {quote ? (
            <p className={styles.quote} lang="en">
              {quote}
            </p>
          ) : null}

          <div className={styles.figures}>
            <span className={styles.current}>{krw.format(current)}</span>
            <span className={styles.goal}>/ {krw.format(goal)}</span>
          </div>

          <div
            className={styles.meter}
            role="progressbar"
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

          {ctaLabel && ctaHref ? (
            <a className={styles.cta} href={ctaHref}>
              <span className={styles.ctaWipe} aria-hidden="true" />
              <span className={styles.ctaText}>{ctaLabel}</span>
            </a>
          ) : null}

          {outro ? <p className={styles.outro}>{outro}</p> : null}
        </div>
      </div>
    </Section>
  )
}

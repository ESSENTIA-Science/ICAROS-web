import Section, { sectionHeadingId, type SectionTheme } from './Section'
import { textLang } from './text-lang'
import { revealIndex } from './reveal-style'
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
  /**
   * 금액 옆에 붙는 후원 차수 표기(`1–3차` 처럼). CMS 자유 텍스트라 형식을 강제하지 않는다.
   * 차수를 쓰지 않는 시기가 정상이므로 **비면 표기가 사라지는 것이 정상 동작**이다.
   */
  roundLabel: string | undefined
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
  /**
   * 차수는 금액을 **수식하는** 라벨이라 금액 밴드에 종속시킨다 (`hasFigures &&`).
   * 금액이 둘 다 0인데 "1–3차" 만 남은 상태는 아무 정보가 아니고, 그것으로 밴드를 세우면
   * 0원이 화면 폭만 한 숫자로 그려진다 — 차수가 단독으로 섹션을 살리면 안 되는 이유다.
   */
  const hasRound = hasFigures && Boolean(c.roundLabel)
  // 분모가 없으면 진행률이 성립하지 않는다 — 막대와 퍼센트는 목표가 있을 때만
  const hasMeter = c.goal > 0
  const hasCta = Boolean(c.ctaLabel && c.ctaHref)
  const hasNote = Boolean(c.quote || c.outro) || hasCta
  return { hasText, hasFigures, hasRound, hasMeter, hasCta, hasNote }
}

/**
 * 빈 섹션 규칙. 어느 덩어리에도 내용이 없으면 섹션을 그리지 않는다.
 *
 * `hasRound` 는 **의도적으로 빠져 있다.** 정의상 `hasFigures` 를 함의하므로 더해도 결과가 같고,
 * 더하는 순간 "차수만 있으면 섹션이 선다"로 읽혀 다음 사람이 `hasFigures &&` 를 떼게 된다.
 */
export function hasDonateContent(c: DonateContent): boolean {
  const p = parts(c)
  return p.hasText || p.hasFigures || p.hasNote
}

/**
 * Donate — 모금 현황 + 후원 안내.
 *
 * 모금액이 이 섹션의 주인공이라 폭을 통째로 준다 (03 §3 "big-number treatment"):
 * 디스플레이 서체 · Expanded 폭 · 음수 자간 · `tabular-nums`. 그 밑에 2px 진행률 막대와
 * 12px 모노 퍼센트만 붙는다. 큰 숫자 ↔ 작은 기술 텍스트의 낙차가 이 섹션의 전부다.
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
  const { hasText, hasFigures, hasRound, hasMeter, hasNote } = parts(content)
  if (!hasText && !hasFigures && !hasNote) return null

  const { intro, usageTitle, usageItems, quote, outro, ctaLabel, ctaHref } = content
  const { current, goal, roundLabel } = content

  // 목표가 0 이거나 값이 깨져 있어도 0~100 밖으로 나가지 않는다
  const ratio = goal > 0 ? (current / goal) * 100 : 0
  const percent = Math.min(100, Math.max(0, ratio))
  const rounded = Math.round(percent)

  // progressbar 에는 이름이 있어야 한다 (WCAG 4.1.2). aria-valuetext 는 값이지 이름이 아니다.
  // 섹션 헤딩("Donate")만으로는 무엇의 진행률인지 모호해서 sr 전용 문구를 덧붙인다.
  const meterLabelId = `${id}-meter-label`

  return (
    <Section id={id} label={label} index={index} theme={theme} reveal="group">
      <div className={styles.layout}>
        {hasFigures ? (
          <div className={styles.band} data-reveal-item="" style={revealIndex(0)}>
            <div className={styles.figures}>
              <span className={styles.current}>{krw.format(current)}</span>
              {goal > 0 ? <span className={styles.goal}>/ {krw.format(goal)}</span> : null}

              {/* 차수 표기. 큰 숫자 옆의 작은 기술 텍스트 — 이 섹션의 조판 원리 그대로다 (03 §3).
                  `aria-valuetext` 가 아니라 실제 텍스트로 둔다: 차수는 진행률 막대의 **값**이 아니고,
                  막대는 `goal > 0` 일 때만 존재해서 목표 미설정 시 표기가 접근성 트리에서만 사라진다.
                  대신 숫자에 곧바로 붙어 읽히지 않도록 sr 전용 이름을 앞에 세운다. */}
              {hasRound && roundLabel ? (
                <>
                  <span className="sr-only">후원 차수</span>
                  <span className={styles.round} lang={textLang(roundLabel)}>
                    {roundLabel}
                  </span>
                </>
              ) : null}
            </div>

            {hasMeter ? (
              <div className={styles.meterRow}>
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
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={styles.cols} data-single={hasText && hasNote ? undefined : true}>
          {hasText ? (
            <div className={styles.text} data-reveal-item="" style={revealIndex(1)}>
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

          {hasNote ? (
            <div className={styles.panel} data-reveal-item="" style={revealIndex(2)}>
              <span className={styles.corner} aria-hidden="true" />

              {quote ? (
                <p className={styles.quote} lang={textLang(quote)}>
                  {quote}
                </p>
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
      </div>
    </Section>
  )
}

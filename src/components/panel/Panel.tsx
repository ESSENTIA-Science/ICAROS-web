import Image from 'next/image'
import Link from 'next/link'

import Reveal from './Reveal'

import type { LandingPanel } from '@/lib/panels'
import styles from './Panel.module.css'

/**
 * 패널 하나 = 사진 한 장 + 그 위 텍스트.
 *
 * **레코드가 조판을 정한다.** 초점·스크림·정렬·높이가 전부 `PanelRecord` 필드이고,
 * 이 컴포넌트는 그 값을 CSS 커스텀 프로퍼티와 `data-*` 로 옮기기만 한다.
 * 컴포넌트가 패널마다 분기하기 시작하면 CMS 로 고칠 수 있는 범위가 코드에 갇힌다.
 *
 * `priority` 는 첫 패널에만 준다 — 나머지는 화면 밖이고, 전부 우선 로드하면
 * LCP 가 되는 첫 장이 나머지 네 장과 대역폭을 나눠 갖는다.
 *
 * `media.placeholder` 는 **화면에 그리지 않는다.** 교체할 사진을 표시하는 것은 우리 쪽 메모이지
 * 방문자에게 할 말이 아니다. 값은 `_panels.ts` 에 남아 있고 그게 교체 목록 역할을 한다.
 */
export default function Panel({ panel, first }: { panel: LandingPanel; first: boolean }) {

  return (
    <section
      className={styles.panel}
      data-height={panel.heightMode}
      data-scrim={panel.scrim}
      data-anchor={panel.anchor}
      style={
        {
          '--focal-x': `${panel.focalX}%`,
          '--focal-y': `${panel.focalY}%`,
        } as React.CSSProperties
      }
    >
      <div className={styles.media}>
        {/* 바이트는 `/api/media/[id]` 가 S3 에서 그대로 흘려 준다 (D15).
            302 가 아니다 — Next 이미지 최적화기가 `Location` 을 따라가지 않아 0바이트로 끝난다. */}
        <Image
          src={`/api/media/${panel.mediaId}`}
          width={panel.width}
          height={panel.height}
          alt={panel.alt}
          sizes="100vw"
          priority={first}
          quality={82}
        />
      </div>
      <div className={styles.scrim} aria-hidden="true" />

      <div className={styles.inner}>
        <Reveal>
          <div className={styles.text}>
          {panel.eyebrow ? (
            <p className={styles.eyebrow} lang="en">
              {panel.eyebrow}
            </p>
          ) : null}

          {/* 첫 패널만 h1. 나머지는 h2 — 사진 다섯 장이 전부 h1 이면 문서에 제목이 다섯 개다. */}
          {first ? (
            <h1 className={styles.headline} lang="en">
              {panel.headline}
            </h1>
          ) : (
            <h2 className={styles.headline} lang="en">
              {panel.headline}
            </h2>
          )}

          {panel.body ? (
            <p className={styles.body} lang="ko">
              {panel.body}
            </p>
          ) : null}

          {panel.ctaLabel && panel.ctaHref ? (
            <Link href={panel.ctaHref} className={styles.cta} lang="ko">
              {panel.ctaLabel}
              <span className={styles.ctaArrow} aria-hidden="true">
                →
              </span>
            </Link>
          ) : null}
          </div>
        </Reveal>

        {panel.credit ? (
          <p className={styles.credit}>
            <span lang="ko">{panel.credit}</span>
          </p>
        ) : null}

        {first ? (
          <p className={styles.scrollCue} aria-hidden="true">
            <span className={styles.scrollWord} lang="en">
              Scroll
            </span>
            <span className={styles.scrollLine} />
          </p>
        ) : null}
      </div>
    </section>
  )
}

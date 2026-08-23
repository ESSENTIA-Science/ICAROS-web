import Image from 'next/image'
import logo from '@/assets/logo_white.svg'
import Crosshairs from './Crosshairs'
import Initials from './Initials'
import { textLang } from './text-lang'
import styles from './Hero.module.css'

/**
 * Hero — 유일하게 Section 껍데기를 쓰지 않는 섹션. 라벨·인덱스 없이 로고와 태그라인만 세운다.
 *
 * 조판: 콘텐츠를 하단에 붙이고, 남는 위쪽을 3D 타깃 박스가 가져간다 (03 §1 · Vast 히어로와 동일).
 * 태그라인은 랜딩에서 가장 큰 활자다 — 디스플레이 서체를 Expanded 폭으로 세우고,
 * ICAROS 이니셜만 시그널 컬러로 찍는다. 그 아래는 전부 12px 모노다. 그 낙차가 이 디자인이다.
 *
 * 아래 화살표는 "다음에 켜져 있는 섹션"으로 간다 — CMS 에서 About 을 꺼도 죽은 앵커가 되지 않는다.
 */
export default function Hero({
  tagline,
  nextSectionId,
}: {
  tagline: string | undefined
  nextSectionId: string | undefined
}) {
  return (
    <section
      id="hero"
      data-section-theme="ink"
      className={styles.hero}
      aria-labelledby="hero-title"
    >
      {/*
        3D 트랙이 얹는 고정 캔버스(`position: fixed; inset: 0; pointer-events: none`)가
        이 박스의 rect 를 읽어 모델을 그 안에 프레이밍한다. **캔버스는 여기서 만들지 않는다** —
        레퍼런스 두 곳(Vast `.webgl-home-space-station`, Hanwha `.mesh-area`)이 독립적으로
        같은 계약에 도달했고, 우리도 그대로 따른다: HTML/CSS 가 레이아웃을 소유하고 캔버스는 읽기만 한다.
      */}
      <div className={`container ${styles.stageRow}`}>
        <div className={styles.stage} data-webgl-target="home-hero" aria-hidden="true">
          <Crosshairs />
        </div>
      </div>

      <div className={`container ${styles.copy}`}>
        <h1 id="hero-title" className={styles.brand}>
          <Image src={logo} alt="ICAROS" className={styles.logo} priority />
        </h1>

        {tagline ? (
          <p className={styles.tagline} lang={textLang(tagline)}>
            <Initials text={tagline} />
          </p>
        ) : null}
      </div>

      <div className={`container ${styles.foot}`}>
        {nextSectionId ? (
          /* 보이는 글자는 아이브로(영문) 장식이고, 실제 접근성 이름은 한국어로 준다 */
          <a href={`#${nextSectionId}`} className={styles.scroll} aria-label="다음 섹션으로 이동">
            <span className={styles.scrollLabel} lang="en" aria-hidden="true">
              Scroll
            </span>
            <span className={styles.scrollTrack} aria-hidden="true">
              <svg viewBox="0 0 12 24" className={styles.chevron}>
                <path
                  d="M6 2v18M1.5 16.5 6 21l4.5-4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="square"
                />
              </svg>
            </span>
          </a>
        ) : null}
        <span className={styles.footRule} aria-hidden="true" />
      </div>
    </section>
  )
}

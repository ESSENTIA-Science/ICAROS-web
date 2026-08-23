import Image from 'next/image'
import logo from '@/assets/logo_white.svg'
import Initials from './Initials'
import styles from './Hero.module.css'

/**
 * Hero — 유일하게 Section 껍데기를 쓰지 않는 섹션. 라벨·인덱스 없이 로고와 태그라인만 세운다.
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
    <section id="hero" data-theme="dark" className={styles.hero} aria-labelledby="hero-title">
      <div className={`container ${styles.inner}`}>
        <h1 id="hero-title" className={styles.brand}>
          <Image src={logo} alt="ICAROS" className={styles.logo} priority />
        </h1>

        {tagline ? (
          <p className={styles.tagline} lang="en">
            <Initials text={tagline} />
          </p>
        ) : null}
      </div>

      {nextSectionId ? (
        <div className={`container ${styles.foot}`}>
          {/* 보이는 글자는 아이브로(영문) 장식이고, 실제 접근성 이름은 한국어로 준다 */}
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
        </div>
      ) : null}
    </section>
  )
}

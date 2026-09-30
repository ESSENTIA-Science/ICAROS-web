import styles from './Crosshairs.module.css'

/**
 * 영역 네 모서리에 찍는 12px 십자 마크 (03 §6a).
 *
 * 장식이지만 목적이 있다 — 영역을 "디자인된 것"이 아니라 "측정된 것"으로 읽히게 한다.
 * `currentColor` 라 섹션 테마를 그대로 따라가고, DOM 은 빈 span 네 개가 전부다.
 */
export default function Crosshairs() {
  return (
    <span className={styles.wrap} aria-hidden="true">
      <span className={`${styles.mark} ${styles.tl}`} />
      <span className={`${styles.mark} ${styles.tr}`} />
      <span className={`${styles.mark} ${styles.bl}`} />
      <span className={`${styles.mark} ${styles.br}`} />
    </span>
  )
}

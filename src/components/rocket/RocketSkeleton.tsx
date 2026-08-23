import styles from './RocketSkeleton.module.css'

/**
 * 목록 페이지가 dark 섹션이라 스켈레톤도 같은 테마를 쓴다 —
 * 밝은 스켈레톤이 먼저 깔렸다가 어두워지면 그게 더 큰 깜빡임이다.
 * 기본 2장은 시리즈당 실제 기체 수와 같아서 로드 후 격자가 움직이지 않는다.
 */
export function RocketGridSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className={styles.shell} data-theme="dark" role="status" aria-live="polite">
      <span className="sr-only">기체 목록을 불러오는 중</span>
      <div className={styles.wrap} aria-hidden="true">
        <div className={styles.head}>
          <span className={`${styles.bar} ${styles.eyebrow}`} />
          <span className={`${styles.bar} ${styles.title}`} />
          <span className={`${styles.bar} ${styles.lede}`} />
        </div>
        <div className={styles.tabs}>
          <span className={`${styles.bar} ${styles.tab}`} />
          <span className={`${styles.bar} ${styles.tab}`} />
        </div>
        <ul className={styles.grid}>
          {Array.from({ length: count }, (_, i) => (
            <li key={i} className={styles.card}>
              <span className={`${styles.bar} ${styles.figure}`} />
              <span className={`${styles.bar} ${styles.name}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function RocketDetailSkeleton() {
  return (
    <div className={styles.shell} data-theme="dark" role="status" aria-live="polite">
      <span className="sr-only">기체 정보를 불러오는 중</span>
      <div className={styles.wrap} aria-hidden="true">
        <div className={styles.detail}>
          <span className={`${styles.bar} ${styles.figure}`} />
          <div className={styles.detailBody}>
            <span className={`${styles.bar} ${styles.eyebrow}`} />
            <span className={`${styles.bar} ${styles.title}`} />
            <div className={styles.specs}>
              <span className={`${styles.bar} ${styles.spec}`} />
              <span className={`${styles.bar} ${styles.spec}`} />
              <span className={`${styles.bar} ${styles.spec}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

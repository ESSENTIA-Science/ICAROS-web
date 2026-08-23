import styles from './MemberSkeleton.module.css'

export default function MemberSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <span className="sr-only">부원 명단을 불러오는 중</span>
      <div className={styles.head} aria-hidden="true">
        <span className={`${styles.bar} ${styles.eyebrow}`} />
        <span className={`${styles.bar} ${styles.title}`} />
        <span className={`${styles.bar} ${styles.lede}`} />
      </div>
      <span className={`${styles.bar} ${styles.squadTitle}`} aria-hidden="true" />
      <ul className={styles.grid} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className={styles.card}>
            <span className={`${styles.bar} ${styles.figure}`} />
            <span className={`${styles.bar} ${styles.name}`} />
            <span className={`${styles.bar} ${styles.role}`} />
          </li>
        ))}
      </ul>
    </div>
  )
}

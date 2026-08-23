import styles from './RocketSkeleton.module.css'

/**
 * 목록 페이지의 탭 + 격자 자리를 지키는 스켈레톤.
 *
 * 테마를 스스로 칠하지 않는다 — 이 스켈레톤은 목록 페이지의 dark 섹션 **안쪽** Suspense
 * fallback 으로만 쓰이므로 배경·전경이 이미 맞다. (예전 버전은 상세 페이지용 셸까지
 * `data-theme="dark"` 로 칠했는데, 실제 상세는 dark hero + light detail 이라 로드 직후 뒤집혔다.)
 *
 * 상세 페이지에는 스켈레톤을 두지 않는다: getRocket() 이 notFound() 를 던지는데
 * 그 호출을 Suspense 경계 안으로 넣으면 fallback shell 이 먼저 나가면서 HTTP 상태가
 * 200 으로 확정된다(soft 404). 루트 loading.tsx 를 지운 이유와 같은 문제다.
 *
 * 기본 2장은 시리즈당 실제 기체 수와 같아서 로드 후 격자가 움직이지 않는다.
 */
export function RocketFleetSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">기체 목록을 불러오는 중</span>
      <div aria-hidden="true">
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

/** 현행 SPA 의 Suspense fallback={null}(빈 화면)을 대체한다 — 요구사항 A6. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: '60vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
      }}
    >
      <span className="sr-only">불러오는 중</span>
      <span
        aria-hidden="true"
        style={{
          width: '12rem',
          height: '1px',
          background: 'var(--rule)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--sig)',
            transformOrigin: 'left',
            animation: 'icaros-rail 900ms var(--ease-primary) infinite',
          }}
        />
      </span>
    </div>
  )
}

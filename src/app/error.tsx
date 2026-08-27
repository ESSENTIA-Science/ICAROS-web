'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 에러 객체를 통째로 흘리지 않는다 — 자격증명이 새는 가장 흔한 경로다.
    console.error('[icaros] render error', error.digest ?? error.message)
  }, [error])

  return (
    <div
      data-theme="dark"
      style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--fg)' }}
    >
      <div className="container" style={{ textAlign: 'center' }}>
        <p className="eyebrow" lang="en">Error</p>
        <h2 style={{ marginBlock: 'var(--sp-5)' }}>문제가 발생했습니다</h2>
        <button
          type="button"
          onClick={reset}
          style={{
            border: '1px solid var(--rule-strong)',
            background: 'transparent',
            color: 'var(--fg)',
            padding: 'var(--sp-3) var(--sp-6)',
            cursor: 'pointer',
          }}
        >
          다시 시도
        </button>
      </div>
    </div>
  )
}

import Link from 'next/link'

/** FuzzyText 캔버스 글리치는 P5 에서 이식한다 (prefers-reduced-motion 존중 필요). */
export default function NotFound() {
  return (
    <div
      data-theme="dark"
      style={{ minHeight: '80vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--fg)' }}
    >
      <div className="container" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--fs-stat)', letterSpacing: 'var(--tr-stat)', lineHeight: 1 }}>404</h1>
        <p className="eyebrow" lang="en" style={{ marginBottom: 'var(--sp-7)' }}>page not found</p>
        <Link href="/" className="eyebrow" lang="en" style={{ color: 'var(--sig)' }}>
          Back to home
        </Link>
      </div>
    </div>
  )
}

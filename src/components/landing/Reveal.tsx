'use client'

import { useEffect, useRef } from 'react'
import styles from './Reveal.module.css'

/**
 * 뷰포트에 들어올 때 한 번만 재생되는 리빌.
 *
 * 스크롤 라이브러리를 쓰지 않는다 — 레퍼런스(Vast)의 1.5MB 번들에도 pin·snap 은 0건이고
 * 사실상 전부 임계값 기반 일회성 트리거였다 (03 §2). IntersectionObserver 하나면 충분하다.
 *
 * 상태를 두지 않고 DOM 속성을 직접 켠다. 리빌은 렌더 결과가 아니라 외부(뷰포트) 동기화이고,
 * state 로 두면 섹션마다 불필요한 리렌더가 한 번씩 더 난다.
 *
 * 감속 처리는 두 겹이다:
 *  - prefers-reduced-motion 이면 CSS 에서 초기 상태 자체를 없앤다 (Reveal.module.css)
 *  - JS 가 없으면 page.tsx 의 <noscript> 스타일이 숨김을 해제한다
 * 둘 다 없으면 스크립트가 죽었을 때 본문이 영원히 안 보인다.
 */
export default function Reveal({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const show = () => el.setAttribute('data-shown', '')

    if (typeof IntersectionObserver === 'undefined') {
      show()
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        // 일회성 — 한 번 보이면 관찰을 끊는다. 되감기 애니메이션은 없다.
        if (entries.some((e) => e.isIntersecting)) {
          show()
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -20% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-reveal=""
      className={className ? `${styles.reveal} ${className}` : styles.reveal}
    >
      {children}
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'

export type RevealVariant = 'block' | 'group'

/**
 * 뷰포트에 들어올 때 한 번만 재생되는 리빌.
 *
 * 스크롤 라이브러리를 쓰지 않는다 — 레퍼런스(Vast)의 1.5MB 번들에 `pin:` 은 0건, `scrub` 은 3건뿐이고
 * 나머지는 전부 `top 60~80%` 임계값 기반 일회성 트리거였다 (03 §2). IntersectionObserver 하나면 충분하다.
 * `rootMargin` 의 `-30%` 가 그 `top 70%` 에 해당한다.
 *
 * 상태를 두지 않고 DOM 속성을 직접 켠다. 리빌은 렌더 결과가 아니라 외부(뷰포트) 동기화이고,
 * state 로 두면 섹션마다 불필요한 리렌더가 한 번씩 더 난다.
 *
 * `variant`:
 *  - `block` — 이 요소 자체가 든다.
 *  - `group` — 이 요소는 그대로 있고, 안의 `[data-reveal-item]` / `[data-word]` 만 순차로 든다.
 *    부모까지 페이드하면 불투명도가 곱해져 계단이 뭉갠다.
 *
 * 스타일은 globals.css 에 데이터 속성으로 둔다 — CSS Modules 의 해시 클래스명은
 * page.tsx 의 `<noscript>` 해제 스타일에서 지목할 수 없기 때문이다.
 *
 * 감속 처리는 세 겹이다:
 *  - `--motion: 0` 이 모든 duration 을 0 으로 만든다
 *  - `prefers-reduced-motion` 이면 초기 상태 자체를 없앤다 (globals.css)
 *  - JS 가 없으면 page.tsx 의 `<noscript>` 스타일이 숨김을 해제한다
 */
export default function Reveal({
  children,
  className,
  variant = 'block',
}: {
  children: React.ReactNode
  className?: string
  variant?: RevealVariant
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
      { rootMargin: '0px 0px -30% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} data-reveal={variant} className={className}>
      {children}
    </div>
  )
}

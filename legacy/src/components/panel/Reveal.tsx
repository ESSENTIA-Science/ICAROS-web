'use client'

import { useEffect, useRef } from 'react'

/**
 * 패널이 화면에 들어올 때 한 번만 떠오른다.
 *
 * **한 번만**이다. 나갈 때 되돌리면 위로 스크롤할 때 글이 다시 사라졌다 나타나고,
 * 그 순간 페이지가 장난감이 된다.
 *
 * 초기 상태를 CSS 가 아니라 여기서 붙이는 이유: JS 가 없거나 실패하면 글이 **영원히 숨는다.**
 * 그래서 숨김 클래스를 마운트 후에 붙이고, 관찰이 시작되면 바로 푼다.
 * `prefers-reduced-motion` 이면 아무것도 하지 않는다.
 */
export default function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!('IntersectionObserver' in window)) return

    el.dataset.reveal = 'pending'

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          if (e.target instanceof HTMLElement) e.target.dataset.reveal = 'in'
          io.unobserve(e.target)
        }
      },
      // 패널이 화면 아래 1/5 쯤 들어왔을 때 시작한다. 0 이면 이미 다 보인 뒤에 뜬다.
      { rootMargin: '0px 0px -20% 0px', threshold: 0.01 }
    )

    io.observe(el)
    return () => io.disconnect()
  }, [])

  return <div ref={ref}>{children}</div>
}

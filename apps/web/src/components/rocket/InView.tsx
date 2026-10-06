'use client'

import { useEffect, useRef } from 'react'

/**
 * 뷰포트에 처음 들어오는 순간 `data-shown` 을 켜는 것만 한다. 표현은 전부 globals.css 의
 * `[data-reveal-item]` / `[data-reveal="block"]` 이 갖고 있다.
 *
 * 상태를 클래스가 아니라 **데이터 속성**으로만 두는 이유: JS 가 없을 때 페이지의 `<noscript>`
 * 인라인 스타일이 숨김을 풀어야 하는데, CSS Modules 의 해시 클래스명은 그 스타일에서 지목할 수 없다.
 * (globals.css 의 리빌 블록 주석과 같은 근거.)
 *
 * 스크롤 라이브러리도, pinning·snapping 도 쓰지 않는다 (03 §2). 일회성 트리거 하나면 된다.
 *
 * 이 파일이 rocket 아래 있는 것은 소유 경로 제약 때문이다 — member 도 같은 것을 쓴다.
 * 성격상 src/components 공용 자리로 옮겨야 한다 (landing/text-lang.ts 와 같은 사정).
 */
export default function InView({
  children,
  className,
  block = false,
}: {
  children: React.ReactNode
  /** true 면 덩어리째 든다. 기본값은 자식(`[data-reveal-item]`)만 순차로 드는 모드다. */
  block?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const show = () => el.setAttribute('data-shown', '')

    // IO 가 없는 환경(아주 오래된 브라우저·일부 프리렌더러)에서는 즉시 보여 준다.
    if (typeof IntersectionObserver === 'undefined') {
      show()
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        // 일회성 — 한 번 보이면 관찰을 끊는다. 되감기는 없다.
        // `top < 0` 을 함께 보는 이유: 새로고침·뒤로가기로 스크롤이 복원되면 뷰포트 **위쪽**
        // 섹션은 교차 이벤트를 한 번도 못 받아 영구히 opacity 0 으로 남는다.
        // 실측: 하단에서 새로고침 시 부원 27명 중 19명이 빈 면이 됐다.
        // (landing/Reveal.tsx 가 같은 회귀를 먼저 고쳤고 이 파일은 그 수정 전 복사본이었다.)
        if (entries.some((e) => e.isIntersecting || e.boundingClientRect.top < 0)) {
          show()
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -15% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} data-reveal={block ? 'block' : ''} className={className}>
      {children}
    </div>
  )
}

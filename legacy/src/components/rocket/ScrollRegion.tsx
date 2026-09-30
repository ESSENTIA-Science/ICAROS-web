'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 넘침 상태. 이 넷을 구분하지 않으면 어포던스가 거짓말을 한다.
 *
 * - `unknown` — 아직 재지 않았다(SSR 출력·하이드레이션 직전).
 *   포커스 정지점은 **켠 채로 둔다**: JS 가 죽어도 데스크톱에서 잘린 본문에
 *   키보드로 도달할 수 있어야 한다 (WCAG 2.1.1). 대신 "더 있다"는 캡션은 아직 내지 않는다 —
 *   짧은 설명에 캡션이 붙으면 그건 거짓이고, 거짓 어포던스는 없는 것만 못하다.
 * - `more`  — 넘치고 아직 바닥이 아니다. 페이드 + 캡션 + 포커스 정지점.
 * - `end`   — 넘치지만 바닥에 닿았다. 포커스 정지점만 남기고 페이드·캡션은 **끈다**.
 * - `none`  — 넘치지 않는다(모바일 1열에서는 `overflow: visible` 이라 항상 여기). 전부 끈다.
 */
type Overflow = 'unknown' | 'more' | 'end' | 'none'

/**
 * 스크롤이 **실제로 있을 때만** 랜드마크·탭 정지점·잘림 표시를 만드는 스크롤 상자.
 *
 * 서버 컴포넌트는 뷰포트를 모른다. `tabIndex=0` + `role=region` 을 마크업에 못박아 두면
 * 데스크톱에서는 옳지만(스크롤이 있다) 모바일 1열에서는 아무것도 하지 않는 탭 정지점과
 * 이름뿐인 랜드마크가 남는다 — 그래서 이 한 조각만 클라이언트로 내린다.
 *
 * 클라이언트로 넘어가는 것은 이 래퍼뿐이다. `children` 은 서버에서 렌더된 엘리먼트로
 * 넘어오므로 react-markdown 은 브라우저 번들에 들어가지 않는다.
 */
export default function ScrollRegion({
  className,
  wrapClassName,
  hintClassName,
  labelledBy,
  hint,
  children,
}: {
  className?: string
  /** 스크롤 상자의 기준면. 상자가 흐름 밖에 있어야 안쪽 스크롤이 성립한다 — page.module.css 참고. */
  wrapClassName?: string
  hintClassName?: string
  /** 영역 이름이 될 요소의 id. 이름 없는 랜드마크는 만들지 않는다. */
  labelledBy: string
  /** 잘렸다는 사실을 글로도 알리는 캡션. 페이드(시각)의 짝이다. */
  hint: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState<Overflow>('unknown')

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      // 1px 여유 — 소수 픽셀 레이아웃에서 scrollHeight 가 clientHeight 를 0.5px 넘긴다
      if (el.scrollHeight - el.clientHeight <= 1) {
        setOverflow('none')
        return
      }
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      setOverflow(atEnd ? 'end' : 'more')
    }

    measure()
    el.addEventListener('scroll', measure, { passive: true })

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => {
        el.removeEventListener('scroll', measure)
        window.removeEventListener('resize', measure)
      }
    }

    // 상자와 **내용**을 함께 본다. 컨테이너만 관찰하면 상자 크기는 레이아웃이 고정하므로
    // 웹폰트가 늦게 들어 글이 한 줄 늘어나도 알림이 오지 않는다.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)

    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [])

  const focusable = overflow !== 'none'

  return (
    <div className={wrapClassName}>
      <div
        ref={ref}
        className={className}
        data-overflow={overflow}
        role={focusable ? 'region' : undefined}
        aria-labelledby={focusable ? labelledBy : undefined}
        tabIndex={focusable ? 0 : undefined}
      >
        {children}
      </div>
      {/* 시각 전용이다. 스크린리더는 잘림과 무관하게 본문 전체를 읽는다 —
          안 읽히는 글이 있다고 알리면 그쪽이 거짓말이 된다.
          흐름 밖에 둔다: 캡션이 뜰 때마다 상자가 줄면 그게 다시 넘침 측정을 흔든다. */}
      {overflow === 'more' ? (
        <p className={hintClassName} aria-hidden="true">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

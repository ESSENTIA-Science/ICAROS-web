'use client'

import { useEffect, useRef } from 'react'

const krw = new Intl.NumberFormat('ko-KR')
const duration = 1400

export default function DonationCounter({ amount, className }: { amount: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (amount <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof IntersectionObserver === 'undefined') {
      el.textContent = krw.format(amount)
      return
    }

    let frame = 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        observer.disconnect()
        const started = performance.now()
        const tick = (now: number) => {
          const progress = Math.min((now - started) / duration, 1)
          const eased = 1 - (1 - progress) ** 3
          el.textContent = krw.format(Math.round(amount * eased))
          if (progress < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      },
      { rootMargin: '0px 0px -20% 0px' }
    )

    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [amount])

  return (
    <>
      <span ref={ref} className={className} data-donation-counter="" aria-hidden="true">0</span>
      <span className="sr-only">현재 후원액 {krw.format(amount)}원</span>
      <noscript>
        <style>{'[data-donation-counter]{display:none}'}</style>
        <span className={className}>{krw.format(amount)}</span>
      </noscript>
    </>
  )
}

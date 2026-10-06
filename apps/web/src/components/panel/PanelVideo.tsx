'use client'

import { useEffect, useRef, useState } from 'react'

export default function PanelVideo({ src, width, height, first }: { src: string; width: number; height: number; first: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const observer = new IntersectionObserver(([entry]) => {
      const visible = Boolean(entry?.isIntersecting) && !reduced.matches
      setActive(visible)
      if (!visible) video.pause()
    }, { rootMargin: first ? '0px' : '200px' })
    observer.observe(video)
    return () => observer.disconnect()
  }, [first])
  useEffect(() => { if (active) void ref.current?.play().catch(() => undefined) }, [active])
  return <video ref={ref} src={active ? src : undefined} width={width} height={height} muted loop playsInline preload="none" aria-hidden="true" />
}

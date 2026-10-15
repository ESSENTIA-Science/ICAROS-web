'use client'
/* eslint-disable @next/next/no-img-element -- Poster is a published static asset behind the video. */

import { useEffect, useRef, useState } from 'react'

export default function PanelVideo({ src, poster, width, height, first }: { src: string; poster?: string | null; width?: number | null; height?: number | null; first: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(false)
  const [playingSrc, setPlayingSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = false
    const update = () => {
      const next = visible && !reduced.matches
      setActive(next)
      if (!next) { video.pause(); setPlayingSrc(null) }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting)
      update()
    }, { rootMargin: first ? '0px' : '200px' })
    observer.observe(video)
    reduced.addEventListener('change', update)
    return () => { observer.disconnect(); reduced.removeEventListener('change', update); video.pause() }
  }, [first])
  useEffect(() => {
    if (!active || failedSrc === src) return
    let cancelled = false
    void ref.current?.play().catch(() => {
      if (!cancelled) { setFailedSrc(src); setPlayingSrc(null) }
    })
    return () => { cancelled = true }
  }, [active, src, failedSrc])
  return <>
    {poster ? <img src={poster} width={width ?? undefined} height={height ?? undefined} alt="" aria-hidden="true" decoding="async" loading={first ? 'eager' : 'lazy'} /> : null}
    <video ref={ref} src={active && failedSrc !== src ? src : undefined} poster={poster ?? undefined} width={width ?? undefined} height={height ?? undefined} muted loop playsInline preload="none" aria-hidden="true"
      style={{ opacity: playingSrc === src ? 1 : 0 }} onPlaying={() => setPlayingSrc(src)} onError={() => { setFailedSrc(src); setPlayingSrc(null) }} />
  </>
}

'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './ModelStage.module.css'

const ModelViewer = dynamic(() => import('./ModelViewer'), { ssr: false })

export default function ModelStage({ src, label, children }: { src: string; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [active, setActive] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      const timeout = window.setTimeout(() => setActive(true), 0)
      return () => window.clearTimeout(timeout)
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setActive(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
      if (event.key === 'Tab') {
        event.preventDefault()
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [expanded])

  const onReady = useCallback(() => setReady(true), [])
  const onError = useCallback(() => setError(true), [])

  return (
    <>
      {expanded ? <button type="button" tabIndex={-1} className={styles.backdrop} aria-label="3D 모델 확대 보기 닫기" onClick={() => setExpanded(false)} /> : null}
      <div
        ref={ref}
        className={styles.stage}
        data-expanded={expanded ? '' : undefined}
        role={expanded ? 'dialog' : undefined}
        aria-modal={expanded ? true : undefined}
        aria-label={expanded ? `${label} 3D 모델 크게 보기` : undefined}
      >
        <div className={styles.poster} data-ready={ready ? '' : undefined}>{children}</div>
        {active && !error ? <ModelViewer src={src} label={label} onReady={onReady} onError={onError} /> : null}
        {error ? <p className={styles.status}>3D 모델을 불러오지 못했습니다. 사진을 표시합니다.</p> : null}
        <button
          ref={buttonRef}
          type="button"
          className={styles.expand}
          onClick={() => {
            setActive(true)
            setExpanded((open) => !open)
          }}
          aria-label={expanded ? `${label} 3D 모델 확대 보기 닫기` : `${label} 3D 모델 크게 보기`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            {expanded ? <path d="M9 3v6H3m12 12v-6h6M3 9l6-6m6 18 6-6" /> : <path d="M9 3H3v6m12-6h6v6M3 3l7 7m11-7-7 7M3 21h6v-6m12 6h-6v-6M3 21l7-7m11 7-7-7" />}
          </svg>
        </button>
      </div>
    </>
  )
}

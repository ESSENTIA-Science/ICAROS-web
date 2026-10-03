import type { ReactNode } from 'react'
import styles from './BodyMedia.module.css'

export type BodyMediaKind = 'pdf' | 'video'

export function bodyMediaKind(title: string | undefined): BodyMediaKind | null {
  return title === 'icaros:pdf' ? 'pdf' : title === 'icaros:video' ? 'video' : null
}

/** Markdown cannot choose API routes, blob/data URLs, credentials, or active schemes. */
export function publicBodyMediaUrl(value: string | undefined): string | null {
  if (!value || /[\s\\]/.test(value)) return null
  if (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes('..')) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      !url.pathname.includes('/api/') && !/%(?:2e|2f|5c)/i.test(value) ? url.href : null
  } catch { return null }
}

/** Source is supplied by a validated link or a trusted CMS upload, never raw HTML. */
export default function BodyMedia({ src, kind, children, label, posterSrc }: {
  src: string; kind: BodyMediaKind; children: ReactNode; label: string; posterSrc?: string
}) {
  return <span className={styles.media} data-body-media={kind}>
    {kind === 'pdf'
      ? <iframe className={styles.pdf} src={src} title={`${label} PDF 미리보기`} sandbox="" loading="lazy" referrerPolicy="no-referrer" />
      : <video className={styles.video} src={src} poster={publicBodyMediaUrl(posterSrc) ?? undefined} aria-label={`${label} 영상 미리보기`} controls playsInline preload="none" />}
    <a className={styles.link} href={src} target="_blank" rel="noopener noreferrer">{children} · {kind === 'pdf' ? 'PDF 열기' : '영상 열기'}</a>
  </span>
}

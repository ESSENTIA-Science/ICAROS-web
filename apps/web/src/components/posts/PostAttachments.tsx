'use client'
/* eslint-disable @next/next/no-img-element -- 공개 스냅샷 이미지 크기를 알 수 없고 정적 export에는 최적화 서버가 없다. */

import { useState } from 'react'
import styles from './PostAttachments.module.css'

export type PostAttachment = { kind: 'image' | 'pdf' | 'video'; src: string; title: string; posterSrc?: string | null }

function safeUrl(value: string): boolean {
  if (value.trim() !== value || value.includes('\\')) return false
  if (value.startsWith('/assets/')) return /^\/assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.includes('..')
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
      !url.pathname.includes('/api/media/') && !url.hostname.includes('amazonaws.com')
  } catch { return false }
}

export default function PostAttachments({ attachments }: { attachments?: PostAttachment[] }) {
  const [opened, setOpened] = useState<Record<number, boolean>>({})
  const safe = attachments?.filter(item => safeUrl(item.src) && (!item.posterSrc || safeUrl(item.posterSrc))) ?? []
  if (!safe.length) return null
  return <section className={styles.section} aria-label="첨부 자료">
    <h2>첨부 자료</h2>
    <ul>{safe.map((item, index) => <li key={`${item.src}-${index}`}>
      {item.kind === 'image' ? <figure><img className={styles.image} src={item.src} alt={item.title} loading="lazy" /><figcaption>{item.title}</figcaption></figure> : item.kind === 'pdf' ? <details onToggle={event => { const open = event.currentTarget.open; setOpened(previous => ({ ...previous, [index]: open })) }}>
        <summary>PDF 미리보기: {item.title}</summary>
        {opened[index] ? <iframe className={styles.pdfPreview} src={item.src} title={`${item.title} PDF 미리보기`} loading="lazy" sandbox="allow-same-origin" referrerPolicy="no-referrer" /> : null}
        <a href={item.src} target="_blank" rel="noopener noreferrer">PDF 새 창에서 열기</a>
      </details> :
        <details><summary>영상 보기: {item.title}</summary><video controls playsInline preload="none" poster={item.posterSrc ?? undefined} src={item.src}>영상 재생을 지원하지 않는 브라우저입니다.</video><a href={item.src} target="_blank" rel="noopener noreferrer">영상 파일 열기</a></details>}
    </li>)}</ul>
  </section>
}

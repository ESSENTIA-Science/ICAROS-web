import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSnapshot } from '@/lib/content/snapshot'
import styles from './page.module.css'

const markdownComponents: Components = {
  img: ({ src, alt }) => {
    if (!src) return null
    // Snapshot validation limits image sources to public URLs.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? ''} loading="lazy" decoding="async" />
  },
}

export const dynamicParams = false
const outcomeLabel = { success: '성공', partial: '부분 성공', failure: '실패', planned: '예정' } as const

export function generateStaticParams() {
  const missions = getSnapshot().missions
  return missions.length ? missions.map((mission) => ({ id: mission.id })) : [{ id: '__empty-mission' }]
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const mission = getSnapshot().missions.find((item) => item.id === id)
  return { title: mission?.title ?? 'Missions', alternates: { canonical: `/missions/${id}` } }
}

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const mission = getSnapshot().missions.find((item) => item.id === id)
  if (!mission) notFound()
  return <section data-section-theme="ink" data-palette="mono" className={styles.section}>
    <article className={`container ${styles.inner}`}>
      <Link href="/missions" className={styles.back}>임무 목록으로</Link>
      <header className={styles.header}><h1 className={styles.title}>{mission.title}</h1><p className={styles.summary}>{mission.summary}</p></header>
      <dl className={styles.facts}>
        <div><dt>발사일</dt><dd><time dateTime={mission.launchDate}>{mission.launchDate}</time></dd></div>
        <div><dt>결과</dt><dd>{outcomeLabel[mission.outcome]}</dd></div>
        <div><dt>기체</dt><dd>{mission.vehicleName ?? '미정'}</dd></div>
        <div><dt>장소</dt><dd>{mission.location}</dd></div>
      </dl>
      {/* Snapshot images have no dimensions; static export serves the approved URL directly. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {mission.imageSrc && <figure className={styles.figure}><img src={mission.imageSrc} alt={`${mission.title} 임무 사진`} /></figure>}
      <div className={styles.prose}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={markdownComponents} allowedElements={['img', 'p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h2', 'h3', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td']}>{mission.bodyMd}</ReactMarkdown></div>
      <Link href="/missions" className={styles.back}>임무 목록으로</Link>
    </article>
  </section>
}

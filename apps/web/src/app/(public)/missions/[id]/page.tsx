import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PostMarkdown from '@/components/posts/PostMarkdown'
import { getSnapshot } from '@/lib/content/snapshot'
import { pageMetadata } from '@/lib/seo'
import styles from './page.module.css'

export const dynamicParams = true
export const revalidate = 3600
const outcomeLabel = { success: '성공', partial: '부분 성공', failure: '실패', planned: '예정' } as const
const allowedBodyElements = ['img', 'p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h2', 'h3', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div']

export function generateStaticParams() {
  const missions = getSnapshot().missions
  return missions.map((mission) => ({ id: mission.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const mission = getSnapshot().missions.find((item) => item.id === id)
  return mission ? pageMetadata({ title: mission.title, description: mission.summary, path: `/missions/${id}`, image: mission.imageSrc, type: 'article' }) : { title: '임무를 찾을 수 없습니다', robots: { index: false } }
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
      <div className={styles.prose}><PostMarkdown content={mission.bodyMd} allowedElements={allowedBodyElements} /></div>
      <Link href="/missions" className={styles.back}>임무 목록으로</Link>
    </article>
  </section>
}

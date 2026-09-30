import type { Metadata } from 'next'
import Link from 'next/link'
import { getSnapshot } from '@/lib/content/snapshot'
import styles from './page.module.css'

export const metadata: Metadata = { title: 'Missions', description: 'ICAROS의 발사 임무와 결과.', alternates: { canonical: '/missions' } }
const outcomeLabel = { success: '성공', partial: '부분 성공', failure: '실패', planned: '예정' } as const

export default function MissionsPage() {
  const missions = [...getSnapshot().missions].sort((a, b) => b.launchDate.localeCompare(a.launchDate))
  return <section data-section-theme="ink" data-palette="mono" className={styles.section}>
    <div className={`container ${styles.inner}`}>
      <header className={styles.header}><h1 className={styles.title}>Missions</h1><p className={styles.intro}>발사 임무의 계획과 결과를 기록합니다.</p></header>
      {missions.length === 0 ? <p className={styles.empty}>공개된 임무가 아직 없습니다.</p> : <ol className={styles.list}>{missions.map((mission) => <li key={mission.id} className={styles.item}>
        <Link href={`/missions/${mission.id}`} className={styles.itemLink}>
          <time dateTime={mission.launchDate} className={styles.date}>{mission.launchDate}</time>
          <span className={styles.main}><span className={styles.itemTitle}>{mission.title}</span><span className={styles.summary}>{mission.summary}</span></span>
          <span className={styles.facts}><span>{outcomeLabel[mission.outcome]}</span><span>{mission.vehicleName ?? '기체 미정'}</span><span>{mission.location}</span></span>
        </Link>
      </li>)}</ol>}
    </div>
  </section>
}

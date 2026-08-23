import type { Metadata } from 'next'
import MemberCard from '@/components/member/MemberCard'
import { groupBySquad, listMembers } from './_data'
import styles from './page.module.css'

/**
 * ISR 을 쓰지 않는다. published=false 전환이 revalidate 주기 동안(+stale-while-revalidate)
 * 명단에 그대로 노출돼 E5 를 깬다 (rocket/[slug]/page.tsx 와 같은 근거).
 */
export const dynamic = 'force-dynamic'

/**
 * 소속이 비어 있는 그룹의 표시 라벨. DAL 은 센티널을 null 로만 내보내고 이름은 여기서 붙인다 —
 * 운영자가 실제 부서명을 '기타'로 넣어도 두 그룹이 합쳐지거나 key 가 겹치지 않는다.
 */
const UNASSIGNED_SQUAD_LABEL = '기타'

export const metadata: Metadata = {
  title: 'Members',
  description: 'ICAROS를 구성하는 추진공학부·전자부·비행제어부 등 부서별 부원 명단.',
  alternates: { canonical: '/member' },
}

export default async function MemberPage() {
  const squads = groupBySquad(await listMembers())

  return (
    <section className={styles.page}>
      <div className="container">
        <header className={styles.head}>
          <p className="eyebrow" lang="en">Crew</p>
          <h1 lang="en">Members</h1>
          <p className={styles.lede}>
            설계부터 발사 운용까지, 각 부서에서 실제로 손을 대는 사람들입니다.
          </p>
        </header>

        {squads.length === 0 ? (
          <p className={styles.empty}>공개된 부원이 아직 없습니다.</p>
        ) : (
          squads.map((squad) => (
            <section key={squad.key} className={styles.squad}>
              <h2 className={styles.squadTitle}>
                {squad.squad ?? UNASSIGNED_SQUAD_LABEL}
                <span className={`${styles.squadCount} num`} aria-hidden="true">
                  {squad.members.length}
                </span>
              </h2>
              <ul className={styles.grid}>
                {squad.members.map((m) => (
                  <MemberCard key={m.id} member={m} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </section>
  )
}

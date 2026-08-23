import type { Metadata } from 'next'
import MemberCard from '@/components/member/MemberCard'
import { groupBySquad, listMembers } from './_data'
import styles from './page.module.css'

/** 정적 프리렌더 + 5분 상한. 근거는 rocket/[slug]/page.tsx 의 같은 상수 주석 참조. */
// ISR 을 쓰지 않는다. published=false 전환이 최대 5분(+stale-while-revalidate) 동안
// 상세/명단에 그대로 노출돼 C8·E5 를 깬다. 어드민이 revalidatePath 를 붙이기 전까지는
// 요청 시각 렌더가 유일하게 올바른 동작이다 (04-architecture.md §Caching posture).
export const dynamic = 'force-dynamic'

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
            <section key={squad.label} className={styles.squad}>
              <h2 className={styles.squadTitle}>
                {squad.label}
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

import type { Metadata } from 'next'
import MemberCard from '@/components/member/MemberCard'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
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
    // 여기에 loading.tsx 를 다시 만들지 말 것. 이 라우트는 force-dynamic 이라 로딩 경계가
    // 생기면 Next 가 fallback 셸을 먼저 흘려보내고 본문은 문서 끝의 hidden 조각으로 붙는다.
    // 실측: 그 상태에서 /member 의 HTML 은 스켈레톤이 3.8KB 지점, 본문은 hidden 안에 있었다 —
    // JS 없는 클라이언트·크롤러에게는 명단이 통째로 사라진다.
    /* `paper`(밝은 면)가 mono 아래에서 검정으로 뒤집힌다 — 멤버 사진이 어두운 면 위에서
       더 또렷하고, 랜딩·기체 페이지와 면이 이어진다. */
    <section className={styles.page} data-section-theme="paper" data-palette="mono">
      <RevealNoScript />
      <div className="container">
        <header className={styles.head}>
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
              {/* 인원 수는 표시하지 않는다 — 바로 옆 카드 목록이 그 자리에서 세어진다 */}
              <div className={styles.squadHead}>
                <h2 className={styles.squadTitle}>{squad.squad ?? UNASSIGNED_SQUAD_LABEL}</h2>
              </div>

              {/* 리빌은 카드 격자에만. 부서 제목은 문서 구조라 항상 그려져 있어야 한다 */}
              <InView>
                <ul className={styles.grid}>
                  {squad.members.map((m) => (
                    <MemberCard key={m.id} member={m} />
                  ))}
                </ul>
              </InView>
            </section>
          ))
        )}
      </div>
    </section>
  )
}

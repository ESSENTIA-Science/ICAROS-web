import type { Metadata } from 'next'
import MemberCard from '@/components/member/MemberCard'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import { groupBySquad, listMembersSafe } from './_data'
import styles from './page.module.css'

/**
 * **온디맨드 무효화 + 60초 백스톱.** `force-dynamic` 이었다 (W4, 2026-09-06 전환).
 *
 * 공개 여부는 시간이 아니라 액션이 무효화한다 — `_actions/members.ts` 의 세 mutation 전부가
 * `revalidatePath('/member')` 를 부르므로 `published=false` 가 남아 있는 창은 0이다.
 * CLAUDE.md 지뢰 "ISR 로 공개 여부를 감싸지 말 것"이 경고한 것은 **시간이 유일한 신호일 때**다.
 *
 * 그러면 60초는 왜 두는가. `/member` 는 동적 세그먼트가 없어 `revalidate` 를 주면 빌드가 반드시
 * 한 번 프리렌더한다(`generateStaticParams(): []` 우회는 동적 세그먼트 전용이다). 빌드가 RDS 에
 * 닿지 못하는 날에는 `listMembersSafe()` 가 실패를 삼켜 **빈 명단이 프리렌더돼 캐시에 들어간다.**
 * 배포 성공 웹훅(`POST /api/revalidate`)이 그 창을 즉시 닫지만, 훅이 조용히 실패하면
 * 시간 말고는 스스로 낫는 길이 없다. 60초가 그 상한이다. `revalidate = false` 였다면 영구다.
 *
 * 배포 빌드를 RDS 도달성에 묶지 않는다는 규칙(D27)이 TTFB 보다 위라는 점은 그대로다 —
 * 던지는 `listMembers()` 대신 `listMembersSafe()` 를 쓰는 이유가 그것이다.
 */
export const revalidate = 60

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
  const squads = groupBySquad(await listMembersSafe())

  return (
    // 여기에 loading.tsx 를 다시 만들지 말 것. 로딩 경계가 생기면 Next 가 fallback 셸을 먼저
    // 흘려보내고 본문은 문서 끝의 hidden 조각으로 붙는다.
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

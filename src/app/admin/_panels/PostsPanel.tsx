import Notice from '@/components/admin/Notice'
import ui from '@/components/admin/ui.module.css'

/**
 * Posts 탭 (F1) — **의도적으로 CRUD 가 없다.**
 *
 * 게시글의 단일 원본은 ESSENTIA Community 의 ICAROS 게시판이고(D1), 이 레포에 게시글 테이블을
 * 새로 만들지 않기로 확정돼 있다. 여기에 가짜 CRUD 를 붙이면 쓰기 경로가 둘이 되어
 * 어느 쪽이 진짜인지 알 수 없게 된다 — 요구사항이 명시적으로 금지하는 상태다.
 *
 * 그래서 이 화면은 "지금 무엇이 막혀 있고, 무엇이 풀리면 열리는가"만 정확히 알려 준다.
 */
const STATUS: readonly { term: string; detail: string }[] = [
  {
    term: '단일 원본',
    detail:
      'ESSENTIA Community 의 ICAROS 게시판 하나. 이 레포에 게시글 테이블을 따로 만들지 않습니다 — 만드는 순간 같은 글이 두 곳에 생기고 동기화 문제가 시작됩니다.',
  },
  {
    term: '게시판',
    detail:
      '이미 존재합니다. ESSENTIA 쪽 프로젝트 행에 ICAROS 카테고리가 붙어 있어 새로 만들 필요가 없습니다.',
  },
  {
    term: '작성자 귀속',
    detail:
      'ICAROS 서비스 계정 한 곳으로 모읍니다. 레거시 데이터에 작성자 정보가 전혀 없어 글별 실명 복원이 불가능하고, 서비스 계정은 탈퇴하지 않아 익명화 공백이 생기지 않습니다.',
  },
  {
    term: '남은 작업',
    detail:
      'ESSENTIA 백엔드의 서비스 토큰 발급. 착수 시점이 이 레포 밖에서 정해집니다. 토큰이 나오면 이 탭에서 작성·수정·삭제·게시일 지정이 열립니다.',
  },
  {
    term: '이전 대상',
    detail:
      '레거시 20건 중 18~19건. 1건은 제목·날짜가 완전히 같은 확정 중복이라 제외하고, 1건은 같은 발사를 다룬 글이라 본문 대조 후 사람이 판단해야 합니다.',
  },
]

export default function PostsPanel() {
  return (
    <>
      <div className={ui.panelHead}>
        <div>
          <h2 className={ui.panelTitle} lang="en">
            Posts
          </h2>
          <p className={ui.panelLede}>
            게시글은 ESSENTIA Community 연동을 기다리는 중입니다. 이 탭에서는 아직 아무것도
            작성하거나 수정할 수 없습니다.
          </p>
        </div>
      </div>

      <Notice tone="warn" title="ESSENTIA Community 연동 대기">
        연동이 열리기 전까지 게시글 작성·수정 경로를 만들지 않습니다. 임시 저장소를 두면 공개
        게시판과 내용이 갈라지고, 나중에 어느 쪽을 버려야 할지 판단할 수 없게 됩니다.
      </Notice>

      <div className={ui.card}>
        <h3 className={ui.cardTitle}>현재 상태</h3>
        <dl className={ui.blockedList}>
          {STATUS.map((s) => (
            <div className={ui.blockedItem} key={s.term}>
              <dt className={ui.blockedKey}>{s.term}</dt>
              <dd>{s.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  )
}

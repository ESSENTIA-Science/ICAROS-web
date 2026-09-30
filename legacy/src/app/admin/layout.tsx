import type { Metadata } from 'next'
import { getAdminSession } from '@/lib/auth/guard'
import LoginForm from '@/components/admin/LoginForm'
import Notice from '@/components/admin/Notice'
import ui from '@/components/admin/ui.module.css'
import { logoutAction } from './_actions/auth'
import { findDeactivatedAdmin } from './_data/session'

/**
 * 인증·DB·argon2 가 전부 이 세그먼트 아래에서 돌아간다. Edge 로 새면 그 자리에서 깨진다 (H18).
 * `'use server'` 모듈은 async 함수 외의 export 를 허용하지 않으므로, 액션들의 런타임도
 * 그 액션을 호출하는 이 세그먼트 설정이 결정한다.
 */
export const runtime = 'nodejs'
/** 쿠키를 읽어 화면이 갈리므로 캐시 대상이 아니다. */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin',
  // 관리 화면이 검색 결과에 뜰 이유가 없다.
  robots: { index: false, follow: false, nocache: true },
}

/** 로그인 전/차단 상태의 공통 껍데기. 헤더도 탭도 없다 — 할 수 있는 일이 하나뿐이다. */
function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={ui.gate}>
      <div className={ui.gateCard}>
        <h1 className={ui.gateTitle} lang="en">
          ICAROS Admin
        </h1>
        <p className={ui.gateLede}>{title}</p>
        {children}
      </div>
    </div>
  )
}

/**
 * `/admin` 전체의 인증 게이트 (F2).
 *
 * `(public)` 레이아웃과 분리돼 있어 Header/Footer 가 붙지 않는다.
 * 미인증이면 children 을 트리에 넣지 않는다 — 서버 컴포넌트는 트리에 없으면 실행되지도 않으므로
 * 패널의 DB 조회가 아예 일어나지 않는다.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession()

  if (!session) {
    /**
     * `resolveSession()` 은 `is_active = true` 를 판정 조건에 넣기 때문에 비활성 관리자는
     * 미로그인과 구분되지 않는다. 그대로 로그인 폼을 보여 주면 본인은 비밀번호를 계속
     * 다시 입력하다 rate limit 에 걸린다. 무슨 일이 벌어졌는지는 알려 준다.
     */
    const deactivated = await findDeactivatedAdmin()

    if (deactivated) {
      return (
        <Gate title="이 계정은 현재 사용할 수 없습니다.">
          <Notice tone="warn" title="계정이 비활성화되었습니다">
            <p>{deactivated.email} 계정은 관리자에 의해 비활성화되었습니다.</p>
            <p>다시 사용하려면 다른 관리자에게 활성화를 요청해 주세요.</p>
          </Notice>
          <form action={logoutAction}>
            <button type="submit" className={ui.btn}>
              로그아웃
            </button>
          </form>
        </Gate>
      )
    }

    return (
      <Gate title="관리자 계정으로 로그인해 주세요.">
        <LoginForm />
      </Gate>
    )
  }

  return (
    <div className={ui.shell}>
      <a href="#admin-main" className="skip-link">
        본문으로 건너뛰기
      </a>

      <header className={ui.topbar}>
        <div className={ui.topbarInner}>
          <div className={ui.brand}>
            <span className={ui.brandMark} lang="en">
              ICAROS
            </span>
            <span className={ui.brandRole} lang="en">
              Admin
            </span>
          </div>
          <div className={ui.who}>
            <span>{session.displayName ?? session.email}</span>
            <form action={logoutAction}>
              <button type="submit" className={`${ui.btn} ${ui.btnSmall}`}>
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  )
}

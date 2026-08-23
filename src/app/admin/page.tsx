import Link from 'next/link'
import { getAdminSession } from '@/lib/auth/guard'
import ui from '@/components/admin/ui.module.css'
import LandingPanel from './_panels/LandingPanel'
import MembersPanel from './_panels/MembersPanel'
import PostsPanel from './_panels/PostsPanel'
import RocketsPanel from './_panels/RocketsPanel'
import { ADMIN_TABS, adminHref, firstParam, parseTab } from './_tabs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 어드민 콘솔 (F1).
 *
 * 탭·편집 대상·삭제 확인이 전부 URL 쿼리에 있다. 그래서 새로고침·공유·뒤로가기가 그대로 동작하고,
 * 이 페이지 전체가 상태 없는 서버 컴포넌트로 남는다 — `'use client'` 는 입력이 실제로 필요한
 * 폼 잎에만 붙어 있다.
 */
export default async function AdminPage({
  searchParams,
}: {
  // Next 16 에서 searchParams 는 Promise 다.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  /**
   * 레이아웃 게이트가 미인증이면 children 을 트리에 넣지 않으므로 여기까지 오지 않는다.
   * 그래도 한 번 더 본다 — 인가 판정이 레이아웃 한 곳에만 있으면, 나중에 레이아웃을 손대는
   * 사람이 그게 보안 경계였다는 걸 모른다.
   */
  const session = await getAdminSession()
  if (!session) return null

  const sp = await searchParams
  const tab = parseTab(sp['tab'])
  const create = firstParam(sp['new']) === '1'
  const editId = firstParam(sp['edit'])
  const deleteId = firstParam(sp['delete'])
  const saved = firstParam(sp['saved'])

  return (
    <>
      <nav className={ui.tabs} aria-label="관리 영역">
        <div className={ui.tabList}>
          {ADMIN_TABS.map((t) => (
            <Link
              key={t.id}
              className={ui.tab}
              href={adminHref({ tab: t.id })}
              aria-current={t.id === tab ? 'page' : undefined}
              lang="en"
            >
              {t.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className={ui.main} id="admin-main">
        {tab === 'posts' ? <PostsPanel /> : null}
        {tab === 'rockets' ? (
          <RocketsPanel create={create} editId={editId} deleteId={deleteId} saved={saved} />
        ) : null}
        {tab === 'members' ? (
          <MembersPanel create={create} editId={editId} deleteId={deleteId} saved={saved} />
        ) : null}
        {tab === 'landing' ? <LandingPanel saved={saved} /> : null}
      </main>
    </>
  )
}

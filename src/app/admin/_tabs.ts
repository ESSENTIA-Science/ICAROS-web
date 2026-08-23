/**
 * 탭 상태는 URL 에 둔다 (`?tab=rockets`).
 * 새로고침·공유·뒤로가기가 되어야 하고, 그러면 탭 전환에 클라이언트 JS 가 한 줄도 필요 없다.
 */
export const ADMIN_TABS = [
  { id: 'posts', label: 'Posts' },
  { id: 'rockets', label: 'Rockets' },
  { id: 'members', label: 'Members' },
  { id: 'landing', label: 'Landing' },
] as const

export type AdminTab = (typeof ADMIN_TABS)[number]['id']

/**
 * 기본 탭이 Posts 가 아닌 이유: Posts 는 D1(ESSENTIA 서비스 토큰) 대기라 지금 할 수 있는 일이 없다.
 * `/admin` 을 열었을 때 곧바로 작업 가능한 화면이 떠야 한다 (F13 — 생산성 우선).
 */
export const DEFAULT_TAB: AdminTab = 'rockets'

export function parseTab(raw: string | string[] | undefined): AdminTab {
  const first = Array.isArray(raw) ? raw[0] : raw
  return ADMIN_TABS.find((t) => t.id === first)?.id ?? DEFAULT_TAB
}

/**
 * searchParams 는 임의 입력이다. 형태를 여기서 한 번 좁혀 두면
 * 패널마다 같은 방어를 반복하지 않아도 된다.
 */
export function firstParam(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed === '' || trimmed.length > 200 ? undefined : trimmed
}

export type AdminHref = {
  tab: AdminTab
  /** 새 항목 폼 열기 */
  create?: boolean
  /** 편집할 항목 id */
  edit?: string
  /** 삭제 확인 UI 를 띄울 항목 id */
  remove?: string
  /** 저장 직후 상태 배너 키 */
  saved?: string
}

/** `/admin` 쿼리스트링을 만드는 유일한 지점. 문자열을 여기저기서 조립하지 않는다. */
export function adminHref(h: AdminHref): string {
  const p = new URLSearchParams({ tab: h.tab })
  if (h.create) p.set('new', '1')
  if (h.edit) p.set('edit', h.edit)
  if (h.remove) p.set('delete', h.remove)
  if (h.saved) p.set('saved', h.saved)
  return `/admin?${p.toString()}`
}

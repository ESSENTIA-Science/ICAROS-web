/**
 * 탭 상태는 URL 에 둔다 (`?tab=rockets`).
 * 새로고침·공유·뒤로가기가 되어야 하고, 그러면 탭 전환에 클라이언트 JS 가 한 줄도 필요 없다.
 */
export const ADMIN_TABS = [
  { id: 'posts', label: 'Posts' },
  { id: 'panels', label: 'Panels' },
  /**
   * 라벨은 Vehicles 인데 **id 는 `rockets` 그대로다.**
   *
   * 공개 라우트가 `/rocket` → `/vehicles` 로 옮겨 갈 때는 301 을 남길 수 있었지만
   * `?tab=` 에는 그럴 자리가 없다 — `parseTab` 이 모르는 값을 **조용히 기본 탭으로 접는다.**
   * 지금 기본 탭이 마침 이 탭이라 옛 `?tab=rockets` 북마크가 우연히 맞게 떨어지지만,
   * 그건 `DEFAULT_TAB` 을 언젠가 옮기는 순간 사라지는 우연이다. 그때 증상은
   * "북마크가 엉뚱한 탭을 연다"이고 원인은 이 줄에 있는데 여기를 보게 될 이유가 없다.
   *
   * id 는 화면에 나오지 않는다(라벨이 나온다). 바꿔서 얻는 것이 없다.
   */
  { id: 'rockets', label: 'Vehicles' },
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

/**
 * 탭 안의 하위 화면. 둘 다 Vehicles 탭의 택소노미 관리다 —
 * `series` 는 시리즈(`rocket_series`), `types` 는 그 상위 분류(`vehicle_types`).
 *
 * 탭을 새로 만들지 않은 이유: 둘 다 기체를 등록하려고 들어가는 곳이지 그 자체가
 * 목적지가 아니다. 최상위 탭으로 올리면 평소에 쓰지 않는 탭이 하나(이제 둘) 늘어난다.
 * 분류는 시리즈보다 더 드물게 바뀌므로 근거가 더 강하다.
 */
export const ADMIN_SUBVIEWS = ['series', 'types'] as const

export type AdminSubview = (typeof ADMIN_SUBVIEWS)[number]

export function parseSubview(raw: string | string[] | undefined): AdminSubview | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw
  return ADMIN_SUBVIEWS.find((s) => s === first)
}

export type AdminHref = {
  tab: AdminTab
  /** 탭 안의 하위 화면 (`?sub=series` · `?sub=types`). 없으면 탭의 기본 화면. */
  sub?: AdminSubview
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
  // 하위 화면이 탭 바로 뒤에 와야 URL 을 눈으로 읽을 때 계층이 그대로 보인다.
  if (h.sub) p.set('sub', h.sub)
  if (h.create) p.set('new', '1')
  if (h.edit) p.set('edit', h.edit)
  if (h.remove) p.set('delete', h.remove)
  if (h.saved) p.set('saved', h.saved)
  return `/admin?${p.toString()}`
}

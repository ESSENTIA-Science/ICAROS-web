import 'server-only'

/**
 * ESSENTIA Community 어댑터.
 *
 * `/posts` 의 단일 원본은 ESSENTIA 게시판의 ICAROS 프로젝트다 (DECISIONS D1).
 * 우리 DB 에 복제하지 않는다 — 복제하는 순간 두 곳이 갈라지고, 그걸 막는 동기화 코드가
 * 다시 갈라짐의 원인이 된다.
 *
 * **읽기는 인증이 필요 없다.** 서비스 토큰(D1)은 *쓰기* 에만 필요하다.
 * **호출은 서버 사이드에서만 한다** (D22) — 나중에 토큰이 붙으면 브라우저에 노출되면 안 되므로,
 * 지금부터 그 경계를 지킨다.
 */

const API_BASE = process.env.ESSENTIA_API_BASE ?? 'https://api.essentia-sci.org'

/** ICAROS 프로젝트. 카테고리는 텍스트라 이름이 바뀌면 따라가지만 이 UUID 는 불변이다. */
export const ICAROS_PROJECT_ID = '2cb1ee87-9a24-4ea8-b38c-6c9d30eea042'
const ICAROS_CATEGORY = 'ICAROS'

export type CommunityPostSummary = {
  id: string
  title: string
  excerpt: string
  authorName: string
  createdAt: string
  views: number
  commentCount: number
}

export type CommunityPostDetail = CommunityPostSummary & {
  contentMd: string
  updatedAt: string | null
}

export type CommunityPage = {
  items: CommunityPostSummary[]
  page: number
  totalPages: number
  total: number
}

/** 상류 장애를 예외가 아니라 값으로 다룬다 — 게시판이 죽어도 나머지 사이트는 살아 있어야 한다. */
export type CommunityResult<T> =
  | { ok: true; data: T }
  /**
   * `not_found`  — 상류가 404. 그 글은 없다. **우리도 404 여야 한다.**
   * `unreachable`— 타임아웃·DNS·5xx. 글은 있을 수 있다. 404 로 만들면 색인에서 사라지므로
   *                "지금 불러올 수 없다"로 보여준다.
   * `bad_response`— 200 인데 모양이 다르다. 상류 계약이 바뀐 것이므로 404 로 감춘다.
   */
  | { ok: false; reason: 'not_found' | 'unreachable' | 'bad_response' }

type RawSummary = {
  id?: unknown
  title?: unknown
  excerpt?: unknown
  authorName?: unknown
  createdAt?: unknown
  views?: unknown
  commentCount?: unknown
  projectId?: unknown
}

type CallResult = { kind: 'ok'; body: unknown } | { kind: 'not_found' } | { kind: 'unreachable' }

async function call(path: string): Promise<CallResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'application/json' },
      // 게시판은 ESSENTIA 쪽에서 언제든 바뀐다. "양쪽이 같은 것을 보여준다"가 요구사항이라
      // 캐시하지 않는다. 트래픽이 늘면 짧은 revalidate 로 바꾼다.
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    // 404 를 장애와 뭉뚱그리면 없는 글이 "잠시 불러올 수 없음"으로 200 을 낸다.
    if (res.status === 404) return { kind: 'not_found' }
    if (!res.ok) return { kind: 'unreachable' }
    return { kind: 'ok', body: (await res.json()) as unknown }
  } catch {
    // 타임아웃·DNS·TLS 전부 여기로 온다. 에러 객체를 흘리지 않는다.
    return { kind: 'unreachable' }
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function toSummary(raw: RawSummary): CommunityPostSummary | null {
  const id = str(raw.id)
  const title = str(raw.title)
  if (!id || !title) return null
  return {
    id,
    title,
    excerpt: str(raw.excerpt),
    authorName: str(raw.authorName),
    createdAt: str(raw.createdAt),
    views: int(raw.views),
    commentCount: int(raw.commentCount),
  }
}

export async function listIcarosPosts(page = 0, size = 12): Promise<CommunityResult<CommunityPage>> {
  const r = await call(
    `/api/forum/posts?category=${encodeURIComponent(ICAROS_CATEGORY)}&page=${page}&size=${size}`
  )
  if (r.kind !== 'ok') return { ok: false, reason: r.kind === 'not_found' ? 'not_found' : 'unreachable' }

  const data = (r.body as { data?: { posts?: Record<string, unknown> } }).data?.posts
  if (!data || !Array.isArray(data.items)) return { ok: false, reason: 'bad_response' }

  // 카테고리 이름으로 물었지만 **projectId 로 한 번 더 거른다.**
  // 카테고리는 텍스트라 이름이 겹치거나 바뀔 수 있고, 그때 남의 글이 섞이면 안 된다.
  const items = (data.items as RawSummary[])
    .filter((r) => str(r.projectId) === ICAROS_PROJECT_ID)
    .map(toSummary)
    .filter((p): p is CommunityPostSummary => p !== null)

  return {
    ok: true,
    data: { items, page: int(data.page), totalPages: int(data.totalPages), total: int(data.total) },
  }
}

export async function getIcarosPost(id: string): Promise<CommunityResult<CommunityPostDetail>> {
  // 경로에 그대로 붙이므로 UUID 형태가 아니면 상류를 부르지 않는다.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, reason: 'bad_response' }

  const r = await call(`/api/forum/posts/${id}`)
  if (r.kind !== 'ok') return { ok: false, reason: r.kind === 'not_found' ? 'not_found' : 'unreachable' }

  // 상세는 목록과 달리 **한 겹 더 감싸여 있다**: `data.post`.
  // (`data` 에는 comments·canComment·signedIn 도 함께 온다.)
  const p = (r.body as { data?: { post?: RawSummary & { content?: unknown; updatedAt?: unknown } } }).data?.post
  if (!p) return { ok: false, reason: 'bad_response' }

  // 다른 프로젝트 글의 id 를 넣어도 열리면 안 된다.
  if (str(p.projectId) !== ICAROS_PROJECT_ID) return { ok: false, reason: 'bad_response' }

  const base = toSummary(p)
  if (base === null) return { ok: false, reason: 'bad_response' }

  return {
    ok: true,
    data: {
      ...base,
      contentMd: rewriteImageUrls(str(p.content)),
      updatedAt: str(p.updatedAt) || null,
    },
  }
}

/**
 * 본문의 상대 이미지 경로를 절대 URL 로 바꾼다.
 * ESSENTIA 는 이미지를 `/api/forum/image/{name}` 으로 서빙하는데, 그건 **API 호스트 기준**이라
 * 우리 도메인에서 그대로 쓰면 404 가 난다.
 * 레거시 글에는 구 Supabase Storage 절대 URL 도 섞여 있다 — 그건 건드리지 않는다.
 */
function rewriteImageUrls(md: string): string {
  return md.replace(/(!\[[^\]]*\]\()(\/api\/forum\/image\/)/g, `$1${API_BASE}$2`)
}

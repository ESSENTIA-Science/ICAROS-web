import 'server-only'

import { cardExcerpt } from '@/lib/posts/excerpt'

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

/**
 * 목록 API 가 주지 않는 것 — 갤러리 카드에 필요한 대표 사진과 읽을 만한 발췌.
 *
 * `null` 썸네일은 "이 글에 사진이 없다"와 "지금 확인하지 못했다"를 구분하지 않는다.
 * 화면에서 그 둘의 결과가 같기 때문이다(사진 없는 카드). 구분이 필요해지면 그때 나눈다.
 */
export type CommunityPostPreview = {
  /** 본문 첫 이미지의 절대 URL. 상류 호스트라 우리 이미지 최적화기를 통과하지 못한다. */
  thumbnailUrl: string | null
  /** 본문에서 마크다운을 걷어낸 앞부분. 상류 `excerpt` 를 쓸 수 없어서 직접 만든다(아래 참고). */
  excerpt: string
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

/**
 * 목록 항목이 실제로 주는 것 (2026-08-28 실측).
 *
 * `id · category · title · excerpt · authorName · authorRole · createdAt · views ·
 *  commentCount · pinned · projectId · projectSlug · projectTitle`
 *
 * **썸네일·커버 계열 필드는 없다.** 그래서 카드 사진은 `getIcarosPostPreviews` 가 따로 구한다.
 */
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

/** 글 하나를 여는 호출의 상한. 목록·상세가 이걸 쓴다. */
const CALL_TIMEOUT_MS = 8_000

async function call(path: string, timeoutMs = CALL_TIMEOUT_MS): Promise<CallResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'application/json' },
      // 게시판은 ESSENTIA 쪽에서 언제든 바뀐다. "양쪽이 같은 것을 보여준다"가 요구사항이라
      // 캐시하지 않는다. 트래픽이 늘면 짧은 revalidate 로 바꾼다.
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
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

/** 경로에 그대로 붙이므로 이 모양이 아니면 상류를 부르지 않는다. */
const UUID_LIKE = /^[0-9a-f-]{36}$/i

export async function getIcarosPost(id: string): Promise<CommunityResult<CommunityPostDetail>> {
  if (!UUID_LIKE.test(id)) return { ok: false, reason: 'bad_response' }

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

/**
 * ## 카드 사진 — 목록만으로는 못 구한다
 *
 * `/posts` 가 갤러리가 되면서 카드마다 대표 사진이 필요해졌다. 상류 목록 응답에는
 * 썸네일 필드가 없고(위 `RawSummary` 주석), **`excerpt` 에서 뽑는 것도 불가능하다.**
 *
 * 상류는 발췌를 만들 때 마크다운 기호를 지우는데 **하이픈까지 같이 지운다.** 같은 글에서:
 *
 * - 본문:   `/api/forum/image/16bb4baa-8863-4df4-8aca-d5ed13719f92-1000035345.jpg`
 * - 발췌: `/api/forum/image/16bb4baa88634df48acad5ed13719f921000035345.jpg`
 *
 * 뒤엣것은 열리지 않는 URL 이다. 게다가 발췌는 100자에서 잘려서(`…`) 절대 URL 은 대개
 * 중간이 날아간다. 즉 excerpt 는 썸네일 원본으로 쓸 수 없고, 그대로 카드에 찍기에도
 * (`ICX-II` → `ICXII`, 파일명이 본문에 붙어 옴) 나쁘다.
 *
 * 그래서 **화면에 실제로 그릴 글에 한해** 상세를 한 번 더 부른다.
 *
 * ## 대가와 그 상한
 *
 * 목록 12건에 상세 12회는 그 자체로 N+1 이다. 다음 세 가지로 묶어 둔다.
 *
 * 1. **부르는 대상이 현재 페이지에 실제로 그려지는 글뿐이다.** `getFeed` 가 두 원본을 합쳐
 *    자른 **뒤에** 이 함수를 부른다 — 상류에서 20건을 받아 와도 12건 중 커뮤니티 글만 센다.
 * 2. **인스턴스 로컬 TTL 캐시**(D26 의 `/api/media` 와 같은 수법). 본문 첫 이미지는 글이
 *    수정되지 않는 한 변하지 않으므로 낡아 봐야 카드 사진이 TTL 만큼 옛것이다.
 *    제목·날짜·목록 구성은 캐시하지 않으므로 "새 글이 늦게 뜬다"는 일은 없다.
 * 3. **짧은 타임아웃과 개별 실패 삼킴.** 하나가 늦어도 페이지는 사진 없는 카드로 나간다.
 *    상세 목적이 본문 렌더가 아니라 사진 한 장이라 기다릴 이유가 없다.
 * 4. **총 예산**(아래 `PREVIEW_BUDGET_MS`). 위 셋은 *호출 하나*의 상한이지 *단계 전체*의
 *    상한이 아니다. 12건이 각자 4초를 다 쓰면 목록은 이미 나와 있는데 페이지가 4초 더
 *    묶인다 — 사진 때문에 글이 막히는 것은 순서가 뒤집힌 것이다.
 */
const PREVIEW_TTL_MS = 10 * 60_000

/** 한 번의 렌더가 상류에 추가로 낼 수 있는 상세 호출 수. 페이지 크기와 같다. */
const PREVIEW_MAX_LOOKUPS = 12

/** 상한 없는 Map 은 그 자체로 사고 경로다 (media.ts 와 같은 이유). */
const PREVIEW_CACHE_MAX = 64

/** 본문 렌더가 아니라 사진 한 장을 위한 호출이다. 목록(8초)보다 훨씬 짧게 잡는다. */
const PREVIEW_TIMEOUT_MS = 4_000

/**
 * **이 단계 전체가 렌더를 붙잡아 둘 수 있는 시간.**
 *
 * 개별 타임아웃(4초)은 호출 하나의 상한일 뿐이고, `Promise.all` 은 가장 느린 하나를
 * 기다린다. `/posts` 는 `force-dynamic` 에 `loading.tsx` 가 없어서(그건 404 를 200 으로
 * 바꾼다 — 만들지 않는다) 그 대기가 그대로 TTFB 다. 목록은 이미 손에 있는데 사진 한 장
 * 때문에 첫 바이트가 늦는 것은 순서가 뒤집힌 것이다.
 *
 * 그래서 단계 전체에 예산을 걸고, **예산 안에 들어온 것만** 들고 나간다. 늦게 도착한
 * 응답도 버려지지 않는다 — `previewSet` 은 계속 실행되므로 같은 인스턴스의 다음 요청이
 * 캐시로 받는다. 못 받은 카드는 사진 없는 카드(대체 면)로 나가고, 이건 상류에 사진이
 * 아예 없는 글과 화면에서 같은 결과다. 즉 새 상태를 만들지 않는다.
 *
 * 1.5초 근거: 상류 상세는 정상일 때 100~300ms 대에 온다. 그 열 배를 넘겨도 못 받았다면
 * 그건 "느린 것"이 아니라 "안 오는 것"이다.
 */
const PREVIEW_BUDGET_MS = 1_500

const previewCache = new Map<string, { value: CommunityPostPreview; expiresAt: number }>()

function previewGet(id: string): CommunityPostPreview | null {
  const hit = previewCache.get(id)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    previewCache.delete(id)
    return null
  }
  return hit.value
}

function previewSet(id: string, value: CommunityPostPreview): void {
  // Map 은 삽입 순서를 지킨다 — 가장 오래 전에 넣은 것부터 버린다.
  if (previewCache.size >= PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next()
    if (!oldest.done) previewCache.delete(oldest.value)
  }
  previewCache.set(id, { value, expiresAt: Date.now() + PREVIEW_TTL_MS })
}

async function loadPreview(id: string): Promise<CommunityPostPreview | null> {
  if (!UUID_LIKE.test(id)) return null

  const r = await call(`/api/forum/posts/${id}`, PREVIEW_TIMEOUT_MS)
  if (r.kind !== 'ok') return null

  const p = (r.body as { data?: { post?: { content?: unknown; projectId?: unknown } } }).data?.post
  // 목록에서 걸렀지만 상세에서도 한 번 더 본다 — 남의 글 사진을 우리 카드에 걸지 않는다.
  if (!p || str(p.projectId) !== ICAROS_PROJECT_ID) return null

  const md = rewriteImageUrls(str(p.content))
  return { thumbnailUrl: firstImageUrl(md), excerpt: cardExcerpt(md) }
}

/**
 * 카드에 걸어도 되는 사진의 출처. **상류 이미지 서비스 하나뿐이다.**
 *
 * 상세 화면은 본문에 적힌 이미지를 그대로 그리지만(그게 본문이다), 목록은 다르다.
 *
 * 1. **죽은 호스트가 실제로 있다.** 옛 글 두 건의 유일한 이미지가 구 Supabase 프로젝트에
 *    있는데 그 호스트는 이제 NXDOMAIN 이다 (2026-08-28 확인). 그대로 걸면 격자에 깨진
 *    그림이 영구히 박힌다 — 빈 프레임이 그보다 낫다.
 * 2. **본문은 우리가 통제하는 값이 아니다.** 임의 호스트의 사진을 목록에서 12장씩 불러오면
 *    방문자의 IP·UA 가 그 호스트로 나간다. 글 한 편을 열어서 생기는 것과 목록을 열기만
 *    해도 생기는 것은 다르다.
 */
const IMAGE_ORIGIN = ((): string | null => {
  try {
    return new URL(API_BASE).origin
  } catch {
    return null
  }
})()

/**
 * 본문 첫 이미지. 상세 화면이 `skipHtml` 로 원시 HTML 을 그리지 않으므로 **마크다운 이미지만**
 * 센다 — 화면에 나오지도 않는 `<img>` 를 카드 대표 사진으로 삼으면 두 화면이 어긋난다.
 */
function firstImageUrl(md: string): string | null {
  const raw = /!\[[^\]]*\]\(\s*([^)\s]+)/.exec(md)?.[1]
  if (!raw) return null
  try {
    // 상대 경로는 여기서 던진다. `rewriteImageUrls` 를 지난 뒤에도 상대면 우리 도메인에서
    // 404 가 날 주소다. 절대 URL 이어도 출처가 위 하나가 아니면 걸지 않는다.
    const u = new URL(raw)
    return u.origin === IMAGE_ORIGIN ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * `p` 가 끝나거나 `ms` 가 지나거나, 둘 중 먼저인 쪽에서 돌아온다.
 * 타이머는 반드시 회수한다 — 안 그러면 응답을 다 만든 함수가 타이머 때문에 더 살아 있다.
 */
async function within(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    await Promise.race([p.then(() => undefined), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 여러 글의 카드 정보를 한 번에. 실패한 글은 **결과에서 빠질 뿐** 전체를 실패시키지 않는다.
 * 던지지 않는다 — 호출부는 `Map.get` 이 `undefined` 인 경우만 다루면 된다.
 *
 * **예산 안에 도착한 것만 담아서 돌아온다** (`PREVIEW_BUDGET_MS`). 부분 결과가 살아남는
 * 것이 핵심이라 결과 Map 을 밖에서 만들어 각 작업이 도착하는 대로 채운다 — 결과를
 * `Promise.all` 의 반환값으로 받으면 예산이 끊길 때 이미 도착한 것까지 같이 버려진다.
 */
export async function getIcarosPostPreviews(
  ids: readonly string[],
  budgetMs = PREVIEW_BUDGET_MS
): Promise<Map<string, CommunityPostPreview>> {
  const out = new Map<string, CommunityPostPreview>()
  const misses: string[] = []

  for (const id of ids) {
    const hit = previewGet(id)
    if (hit) out.set(id, hit)
    else if (misses.length < PREVIEW_MAX_LOOKUPS) misses.push(id)
  }
  if (misses.length === 0) return out

  await within(
    Promise.all(
      misses.map(async (id) => {
        const value = await loadPreview(id)
        if (!value) return
        // 예산이 끊긴 뒤에 도착해도 캐시에는 넣는다. 이 인스턴스의 다음 요청이 받아 간다.
        previewSet(id, value)
        out.set(id, value)
      })
    ),
    budgetMs
  )

  return out
}

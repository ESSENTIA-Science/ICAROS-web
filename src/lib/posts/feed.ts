import 'server-only'

import { desc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { legacyPosts } from '@/lib/db/schema'
import {
  getIcarosPostPreviews,
  listIcarosPosts,
  type CommunityPostPreview,
} from '@/lib/community/client'
import { mediaUrl } from '@/lib/image/contract'
import { cardExcerpt } from './excerpt'

/**
 * `/posts` 의 통합 피드 — **두 원본을 이어 붙인다.**
 *
 * | 구간 | 원본 | 소유 |
 * |---|---|---|
 * | 최신 | ESSENTIA Community | ESSENTIA |
 * | 그 뒤(레거시 19건) | `icaros.legacy_posts` | ICAROS |
 *
 * "복제하지 않는다"(D23)는 유지된다 — 두 집합은 겹치지 않고 각 글의 원본은 정확히 한 곳이다.
 * 바뀐 것은 "모든 글이 한 원본"에서 "각 글이 한 원본"으로다.
 *
 * ## 소스가 아니라 날짜로 합친다
 *
 * 처음에는 "신규 먼저, 그 뒤 레거시"로 이어 붙였는데 실제로 그리니 08-08 다음에 06-18 이
 * 오고 그 뒤에 08-22 가 나왔다. 기록 목록에서 그건 고장으로 읽힌다.
 * 날짜순으로 합치려면 그 지점까지의 양쪽 항목을 모두 알아야 하고, 두 집합이 각각 스무 건
 * 남짓이라 그렇게 해도 비용이 없다.
 *
 * ## 같은 사건이 두 번 나오지 않게
 *
 * 레거시 중 일부는 ESSENTIA 에 같은 사건의 글이 이미 있다. 그런 행은
 * `legacy_posts.published = false` 로 내린다 — 지우지 않는 이유는 스키마 주석에 있다.
 *
 * ## 상류가 죽어도 레거시는 보인다
 *
 * ESSENTIA 가 닿지 않으면 그 사실을 값으로 들고 오되(D23 — 404 로 만들지 않는다) 레거시는
 * 그대로 그린다. 우리 것이 남의 장애로 사라질 이유가 없다.
 */

/**
 * 카드 썸네일. **두 종류를 타입으로 갈라 둔다** — 그리는 방법이 다르기 때문이다.
 *
 * `media` 는 우리 프록시(`/api/media/{id}`)라 same-origin 이고 `next/image` 최적화 대상이다.
 * `external` 은 ESSENTIA·구 스토리지 호스트다. `next.config.ts` 의 `remotePatterns: []`(D15)
 * 때문에 최적화기를 통과할 수 없다 — 카드가 `<img>` 로 직접 그린다.
 * 이 구분을 컴포넌트가 URL 문자열로 추측하게 두면 언젠가 틀린다.
 */
export type FeedThumb =
  | { readonly kind: 'media'; readonly src: string }
  | { readonly kind: 'external'; readonly src: string }

export type FeedItem = {
  readonly id: string
  readonly href: string
  readonly title: string
  readonly date: string
  readonly source: 'community' | 'legacy'
  /**
   * 카드 두 줄. 없으면 빈 문자열 — 제목만으로도 카드는 성립한다.
   * **`cardExcerpt` 를 통과한 값만 들어온다** (`lib/posts/excerpt.ts`).
   */
  readonly excerpt: string
  /** 사진 없는 글도 있다. 그때 카드는 대체 면(`PostCard` 의 `.blank`)을 그린다. */
  readonly thumb: FeedThumb | null
}

export type Feed = {
  readonly items: readonly FeedItem[]
  readonly hasNext: boolean
  /** 상류가 닿지 않았다. 레거시만 보여 주는 중이라는 뜻이다. */
  readonly communityUnavailable: boolean
}

const iso = (v: string | Date | null | undefined): string => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/**
 * 발췌를 만들 만큼만 본문을 읽는다. 전량(19건 × 본문 전체)을 매 요청 끌어오면 발췌 두 줄을
 * 위해 수십 KB 를 왕복시키는 셈이다. 이미지 마크다운 한 줄이 60자 남짓이라 이 정도면
 * 첫 문단이 들어온다.
 */
const LEGACY_HEAD_CHARS = 600

/**
 * 앞에서 N자만 읽으면 **절단면이 마크다운 토큰 한가운데**일 수 있다 —
 * `![IMG_1420.jpeg](/api/media/38d6069c-7364` 처럼 닫는 `)` 도 확장자도 없는 조각이 남는다.
 * 그 조각은 이미지 규칙 어디에도 걸리지 않으므로 그대로 카드로 샌다.
 *
 * 자르는 쪽에서 토큰 경계를 찾는 대신 **읽는 쪽에서 구조적으로 막았다**
 * (`excerpt.ts` 의 `DANGLING_TAIL`). 상류 발췌도 100자에서 잘려서 오기 때문에 같은 결함이
 * 두 원본 모두에 있고, 여기 상수만 고치면 그중 하나만 막힌다.
 */

/** 레거시는 더 이상 늘지 않는 고정 집합(19건)이라 전량을 읽고 메모리에서 자른다. */
async function allLegacy(): Promise<FeedItem[]> {
  const rows = await db
    .select({
      id: legacyPosts.id,
      slug: legacyPosts.slug,
      title: legacyPosts.title,
      publishedAt: legacyPosts.publishedAt,
      coverMediaId: legacyPosts.coverMediaId,
      // 상수를 바인드 파라미터로 넘기지 않는다 — `substring(text from int for $1)` 은
      // 오버로드 해석이 걸리는 자리다. 값은 모듈 상수이므로 그대로 박아도 안전하다.
      contentHead: sql<string>`substring(${legacyPosts.contentMd} from 1 for ${sql.raw(String(LEGACY_HEAD_CHARS))})`,
    })
    .from(legacyPosts)
    // 공개 조건을 여기에 박아 둔다 — 목록이 실수로 숨긴 글을 그릴 방법이 없다.
    .where(eq(legacyPosts.published, true))
    .orderBy(desc(legacyPosts.publishedAt), desc(legacyPosts.id))

  return rows.map((r) => ({
    id: r.id,
    href: `/posts/legacy/${r.slug}`,
    title: r.title,
    date: iso(r.publishedAt),
    source: 'legacy' as const,
    excerpt: cardExcerpt(r.contentHead ?? ''),
    // 이관 때 본문 첫 이미지를 골라 넣은 값이다. 우리 미디어이므로 `media` 로 표시한다.
    thumb: r.coverMediaId ? { kind: 'media' as const, src: mediaUrl(r.coverMediaId) } : null,
  }))
}

export async function getFeed(page: number, pageSize: number): Promise<Feed> {
  /**
   * 상류에 **이 페이지까지 필요한 만큼**을 한 번에 요청한다 (`(page+1) * pageSize`).
   *
   * 소스별로 잘라 붙이면 날짜가 뒤엉킨다 — 실제로 08-08 다음에 06-18 이 오고 그 뒤에
   * 08-22 가 나왔다. 기록 목록에서 그건 고장으로 읽힌다.
   * 날짜순으로 합치려면 그 지점까지의 양쪽 항목을 **모두** 알아야 하고, 두 집합이 각각
   * 스무 건 남짓이라 그렇게 해도 비용이 없다. 정확한 쪽을 고른다.
   */
  const need = (page + 1) * pageSize

  const [community, legacy] = await Promise.all([
    listIcarosPosts(0, need),
    allLegacy().catch((err) => {
      console.warn('[posts] legacy_posts 조회 실패 — 신규만 렌더합니다', err)
      return [] as FeedItem[]
    }),
  ])

  /* 썸네일은 아직 비워 둔다 — 상류 목록이 주지 않는 값이고, 실제로 그릴 12건이 정해진
     뒤에 그것들만 채우는 편이 상류 호출 수를 최소로 만든다 (아래 참고).

     발췌는 **여기서 이미 `cardExcerpt` 를 통과한다.** 상세 호출이 실패해도 카드에 나가는
     값은 이 함수를 지난 것뿐이다 — 보장을 성공 경로에만 걸어 두지 않는다. */
  const newest: FeedItem[] = community.ok
    ? community.data.items.map((p) => ({
        id: p.id,
        href: `/posts/${p.id}`,
        title: p.title,
        date: iso(p.createdAt),
        source: 'community' as const,
        excerpt: cardExcerpt(p.excerpt),
        thumb: null,
      }))
    : []

  /* 날짜 내림차순. 같은 날이면 신규를 앞에 둔다 — 레거시는 이관된 과거 기록이므로
     같은 날짜에서 최신 글보다 뒤에 오는 편이 읽는 순서에 맞다. */
  const merged = [...newest, ...legacy].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    if (a.source !== b.source) return a.source === 'community' ? -1 : 1
    return a.id < b.id ? 1 : -1
  })

  const start = page * pageSize
  const slice = merged.slice(start, start + pageSize)

  /**
   * 커뮤니티 카드의 사진·발췌를 **여기서** 채운다.
   *
   * 자른 뒤에 채우는 것이 핵심이다. 위에서 상류에 `(page+1) * pageSize` 건을 요청했으므로
   * 2페이지만 가도 24건을 들고 있는데, 그중 실제로 그려지는 것은 12건이다. 합치기 전에
   * 채웠다면 상세 호출을 두 배로 냈을 것이다. 자세한 대가는 `community/client.ts` 에 적었다.
   *
   * **이 단계는 목록을 막지 않는다.** `getIcarosPostPreviews` 가 총 예산(1.5초) 안에 온
   * 것만 들고 오고, 못 받은 카드는 사진 없는 카드로 나간다 — 상류에 사진이 아예 없는 글과
   * 화면에서 같은 결과다. 최악 지연은 `목록 8초 + 1.5초`이고, 예산이 없던 때는
   * `8초 + 상세 4초`였다.
   */
  const ids = slice.filter((i) => i.source === 'community').map((i) => i.id)
  const previews =
    ids.length > 0 ? await getIcarosPostPreviews(ids) : new Map<string, CommunityPostPreview>()

  const items = slice.map((item) => {
    const pv = item.source === 'community' ? previews.get(item.id) : undefined
    if (!pv) return item
    return {
      ...item,
      /* 본문에서 만든 발췌로 **덮는다** — 빈 문자열이어도 그렇다. 상류 발췌는 하이픈이
         지워진 채로 오므로(client.ts) 같은 글이라도 본문 쪽이 언제나 낫다.
         두 값 모두 `cardExcerpt` 를 지났다. 이 줄이 실행되든 안 되든 카드에 원시 파일명이
         남지 않는 이유가 그것이다. */
      excerpt: pv.excerpt,
      thumb: pv.thumbnailUrl ? ({ kind: 'external', src: pv.thumbnailUrl } as const) : null,
    }
  })

  /* 상류에 아직 더 있으면(요청분을 꽉 채워 왔고 총계가 그보다 크면) 다음 페이지가 있다.
     그렇지 않으면 합친 목록의 길이로 판단한다. */
  const moreUpstream = community.ok && community.data.total > newest.length
  return {
    items,
    hasNext: moreUpstream || start + slice.length < merged.length,
    communityUnavailable: !community.ok,
  }
}

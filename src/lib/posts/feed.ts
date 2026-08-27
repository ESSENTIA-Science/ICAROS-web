import 'server-only'

import { desc, eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { legacyPosts } from '@/lib/db/schema'
import { listIcarosPosts } from '@/lib/community/client'

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

export type FeedItem = {
  readonly id: string
  readonly href: string
  readonly title: string
  readonly date: string
  readonly source: 'community' | 'legacy'
  /** 레거시만 갖는다. 목록 카드 썸네일. */
  readonly coverMediaId: string | null
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

/** 레거시는 더 이상 늘지 않는 고정 집합(19건)이라 전량을 읽고 메모리에서 자른다. */
async function allLegacy(): Promise<FeedItem[]> {
  const rows = await db
    .select({
      id: legacyPosts.id,
      slug: legacyPosts.slug,
      title: legacyPosts.title,
      publishedAt: legacyPosts.publishedAt,
      coverMediaId: legacyPosts.coverMediaId,
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
    coverMediaId: r.coverMediaId,
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

  const newest: FeedItem[] = community.ok
    ? community.data.items.map((p) => ({
        id: p.id,
        href: `/posts/${p.id}`,
        title: p.title,
        date: iso(p.createdAt),
        source: 'community' as const,
        coverMediaId: null,
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

  /* 상류에 아직 더 있으면(요청분을 꽉 채워 왔고 총계가 그보다 크면) 다음 페이지가 있다.
     그렇지 않으면 합친 목록의 길이로 판단한다. */
  const moreUpstream = community.ok && community.data.total > newest.length
  return {
    items: slice,
    hasNext: moreUpstream || start + slice.length < merged.length,
    communityUnavailable: !community.ok,
  }
}

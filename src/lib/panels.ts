import 'server-only'

import { asc, eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { media, pagePanels } from '@/lib/db/schema'
import type { PanelAnchor, PanelHeight, PanelScrim } from '@/lib/db/schema'

/**
 * 랜딩 패널 읽기. **공개 라우트가 쓰는 유일한 경로.**
 *
 * 관리 화면은 비공개 패널까지 봐야 하므로 `admin/_data/panels.ts` 가 따로 있다.
 * 여기서 `published` 를 조건에 박아 두면 공개 화면이 실수로 초안을 그릴 방법이 없다.
 */

/** 화면에 나가는 모양. 사진의 크기까지 여기서 확정한다 — `next/image` 가 요구한다. */
export interface LandingPanel {
  readonly id: string
  readonly mediaId: string
  readonly width: number
  readonly height: number
  readonly alt: string
  readonly focalX: number
  readonly focalY: number
  readonly scrim: PanelScrim
  readonly anchor: PanelAnchor
  readonly heightMode: PanelHeight
  readonly headline: string
  readonly body: string | null
  readonly ctaLabel: string | null
  readonly ctaHref: string | null
}

/**
 * 사진 크기를 모르면 그리지 않는다.
 *
 * `next/image` 는 `width`/`height` 없이 `fill` 이 아닌 이미지를 못 그리고, 임의 기본값을 주면
 * 비율이 틀린 채로 레이아웃이 잡혀 첫 페인트가 한 번 튄다. `/confirm` 이 `HeadObject` 로
 * 실측해 넣는 값이라, 비어 있다는 것은 그 업로드가 확정되지 않았다는 뜻이다.
 */
const DEFAULT_ALT = ''

export async function getLandingPanels(): Promise<readonly LandingPanel[]> {
  const rows = await db
    .select({
      id: pagePanels.id,
      mediaId: pagePanels.mediaId,
      focalX: pagePanels.focalX,
      focalY: pagePanels.focalY,
      scrim: pagePanels.scrim,
      anchor: pagePanels.anchor,
      heightMode: pagePanels.height,
      headline: pagePanels.headline,
      body: pagePanels.body,
      ctaLabel: pagePanels.ctaLabel,
      ctaHref: pagePanels.ctaHref,
      width: media.width,
      height: media.height,
      alt: media.originalFilename,
      status: media.status,
      deletedAt: media.deletedAt,
    })
    .from(pagePanels)
    .innerJoin(media, eq(media.id, pagePanels.mediaId))
    .where(eq(pagePanels.published, true))
    .orderBy(asc(pagePanels.sortOrder), asc(pagePanels.id))

  return rows
    .filter((r) => r.status === 'ready' && r.deletedAt === null && r.width !== null && r.height !== null)
    .map((r) => ({
      id: r.id,
      mediaId: r.mediaId,
      width: r.width!,
      height: r.height!,
      alt: r.alt ?? DEFAULT_ALT,
      focalX: r.focalX,
      focalY: r.focalY,
      scrim: r.scrim as PanelScrim,
      anchor: r.anchor as PanelAnchor,
      heightMode: r.heightMode as PanelHeight,
      headline: r.headline,
      body: r.body,
      ctaLabel: r.ctaLabel,
      ctaHref: r.ctaHref,
    }))
}

/**
 * 랜딩이 던지면 안 된다. DB 장애가 곧 전 페이지 500 이 되고, 그러면 `/admin` 으로 들어가
 * 고칠 창구까지 같이 사라진다 — 루트 레이아웃이 `getSiteContentSafe` 를 쓰는 것과 같은 사정이다.
 * 패널이 0개면 랜딩은 아래 정적 섹션만 그린다.
 */
export async function getLandingPanelsSafe(): Promise<readonly LandingPanel[]> {
  try {
    return await getLandingPanels()
  } catch (err) {
    console.warn('[panels] page_panels 조회 실패 — 패널 없이 렌더합니다', err)
    return []
  }
}

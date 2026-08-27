import 'server-only'

import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/lib/db'
import { maxVersionExpr, versionExpr } from '../_lib/version'

/**
 * 관리 화면용 패널 읽기.
 *
 * 공개 화면(`@/lib/panels`)과 따로 두는 이유는 하나다 — **여기는 비공개 패널까지 본다.**
 * 두 곳이 같은 쿼리를 공유하면 `published` 조건을 빼먹은 순간 초안이 공개 랜딩에 나간다.
 * 조건을 각자 자기 파일에 박아 두면 그 사고가 구조적으로 불가능하다.
 */

export type AdminPanel = {
  readonly id: string
  readonly sortOrder: number
  readonly published: boolean
  readonly mediaId: string
  readonly mediaWidth: number | null
  readonly mediaHeight: number | null
  readonly mediaFilename: string | null
  readonly mediaStatus: string
  readonly focalX: number
  readonly focalY: number
  readonly scrim: string
  readonly anchor: string
  readonly height: string
  readonly eyebrow: string | null
  readonly headline: string
  readonly body: string | null
  readonly ctaLabel: string | null
  readonly ctaHref: string | null
  /** 이 행의 낙관적 잠금 토큰. 목록 집계 토큰(`panelsVersion`)과 용도가 다르다. */
  readonly version: string
}

export async function listPanels(): Promise<readonly AdminPanel[]> {
  const rows = await db
    .select({
      id: schema.pagePanels.id,
      sortOrder: schema.pagePanels.sortOrder,
      published: schema.pagePanels.published,
      mediaId: schema.pagePanels.mediaId,
      mediaWidth: schema.media.width,
      mediaHeight: schema.media.height,
      mediaFilename: schema.media.originalFilename,
      mediaStatus: schema.media.status,
      focalX: schema.pagePanels.focalX,
      focalY: schema.pagePanels.focalY,
      scrim: schema.pagePanels.scrim,
      anchor: schema.pagePanels.anchor,
      height: schema.pagePanels.height,
      eyebrow: schema.pagePanels.eyebrow,
      headline: schema.pagePanels.headline,
      body: schema.pagePanels.body,
      ctaLabel: schema.pagePanels.ctaLabel,
      ctaHref: schema.pagePanels.ctaHref,
      version: versionExpr(schema.pagePanels.updatedAt),
    })
    .from(schema.pagePanels)
    .innerJoin(schema.media, eq(schema.media.id, schema.pagePanels.mediaId))
    // sort_order 가 겹쳐도 순서가 흔들리지 않게 id 로 tie-break 한다 — 공개 쿼리와 같은 규칙이다.
    .orderBy(asc(schema.pagePanels.sortOrder), asc(schema.pagePanels.id))

  return rows
}

export async function getPanel(id: string): Promise<AdminPanel | null> {
  const all = await listPanels()
  return all.find((p) => p.id === id) ?? null
}

/**
 * **목록 전체**의 낙관적 잠금 토큰. `updated_at` 최댓값 하나로 만든다 —
 * 순서 바꾸기는 여러 행을 한 번에 건드리므로 행 단위 토큰으로는 충돌을 잡지 못한다.
 *
 * 개별 항목 저장에는 **쓰지 않는다.** 한 패널을 고치면 최댓값이 그 행의 시각으로 옮겨가고,
 * 그 뒤로는 다른 패널을 열 때마다 토큰이 그 행의 `updated_at` 과 어긋나 저장이 전부 막힌다.
 * 실제로 그렇게 만들었다가 "제목을 고쳐도 저장이 안 된다"로 드러났다.
 * 개별 저장은 `AdminPanel.version`(행 토큰)을 쓴다.
 */
export async function panelsVersion(): Promise<string> {
  const [row] = await db
    .select({ v: maxVersionExpr(schema.pagePanels.updatedAt) })
    .from(schema.pagePanels)
  return row?.v ?? ''
}

/** 패널에 붙일 수 있는 사진 후보 — 확정(`ready`)되고 살아 있는 것만. */
export async function listPanelMediaChoices(): Promise<
  readonly { id: string; filename: string | null; width: number | null; height: number | null }[]
> {
  return db
    .select({
      id: schema.media.id,
      filename: schema.media.originalFilename,
      width: schema.media.width,
      height: schema.media.height,
    })
    .from(schema.media)
    .where(eq(schema.media.status, 'ready'))
    .orderBy(asc(schema.media.createdAt))
}

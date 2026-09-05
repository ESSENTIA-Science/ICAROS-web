import 'server-only'

import { cache } from 'react'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import { mediaUrl } from '@/lib/image/contract'
import type { RocketSeries, RocketSeriesOption } from '@/components/rocket/series'

/**
 * 공개 로켓 DAL. 라우트 밖으로 원본 행을 내보내지 않고 DTO 만 돌려준다.
 *
 * `published = false` 는 목록·상세·generateStaticParams 세 경로 모두에서 걸러진다 (C8).
 * 한 군데라도 빠지면 비공개 로켓이 직접 URL 로 새기 때문에 필터를 헬퍼 하나로 모았다.
 */
const isPublic = eq(schema.rockets.published, true)

export type RocketEngineDto = {
  id: string
  type: string
  /** 표시용으로 이미 정규화된 문자열. 단위는 뷰가 붙인다. */
  thrustN: string | null
  burnTimeS: string | null
  count: number
  mode: string | null
}

export type RocketListItem = {
  slug: string
  name: string
  series: RocketSeries
  /** 조인해서 같이 들고 온다. 라벨을 쓰려고 화면에서 시리즈 목록을 또 읽지 않도록. */
  seriesLabel: string
  imageSrc: string | null
  maxAltitudeM: string | null
  sizeM: string | null
  payloadKg: string | null
}

export type RocketDetail = RocketListItem & {
  descriptionMd: string | null
  engines: RocketEngineDto[]
}

/**
 * pg 의 `numeric` 은 드라이버가 정밀도를 보존하려고 문자열로 준다 ('150.00', '1.800').
 * Number 를 거치면 큰 값에서 지수 표기가 튀어나오므로 문자열 그대로 꼬리 0 만 깎는다.
 */
function trimNumeric(raw: string | null): string | null {
  if (raw == null) return null
  const v = raw.trim()
  if (v === '' || !v.includes('.')) return v === '' ? null : v
  return v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/** 신규(S3) 경로를 우선하고, 없으면 레거시 레포 경로로 떨어진다. 둘 다 없으면 null. */
function resolveImageSrc(coverMediaId: string | null, legacyPath: string | null): string | null {
  if (coverMediaId) return mediaUrl(coverMediaId)
  const v = legacyPath?.trim()
  return v ? v : null
}

/**
 * 이미지 소스는 두 세대가 공존한다.
 *   신규: `cover_media_id` → `/api/media/{id}` (S3, 스트리밍 프록시)
 *   레거시: `legacy_image_path` → `/assets/img/...` (레포의 public/)
 * P9 가 레거시를 전부 S3 로 옮기면 뒤엣것을 제거한다.
 *
 * media 를 **left join** 해서 `status='ready'` 이고 삭제되지 않은 행일 때만 신규 경로를 쓴다.
 * 조인 없이 컬럼만 읽으면 미디어가 정리된 뒤에도 죽은 URL 을 계속 내보낸다.
 */
const listColumns = {
  slug: schema.rockets.id,
  name: schema.rockets.name,
  series: schema.rockets.series,
  seriesLabel: schema.rocketSeries.label,
  coverMediaId: schema.media.id,
  legacyImagePath: schema.rockets.legacyImagePath,
  maxAltitudeM: schema.rockets.maxAltitudeM,
  sizeM: schema.rockets.sizeM,
  payloadKg: schema.rockets.payloadKg,
} as const

type RawListRow = {
  slug: string
  name: string
  series: string
  seriesLabel: string | null
  coverMediaId: string | null
  legacyImagePath: string | null
  maxAltitudeM: string | null
  sizeM: string | null
  payloadKg: string | null
}

function toListItem(row: RawListRow): RocketListItem {
  return {
    slug: row.slug,
    name: row.name,
    series: row.series,
    // FK 가 있으니 조인은 항상 맞지만, left join 이라 타입은 null 가능이다.
    seriesLabel: row.seriesLabel ?? row.series,
    imageSrc: resolveImageSrc(row.coverMediaId, row.legacyImagePath),
    maxAltitudeM: trimNumeric(row.maxAltitudeM),
    sizeM: trimNumeric(row.sizeM),
    payloadKg: trimNumeric(row.payloadKg),
  }
}

/**
 * 한 시리즈의 공개 로켓.
 * `(series, sort_order)` 에 unique 가 걸려 있어 동점이 없지만, 인덱스가 바뀌어도
 * 순서가 흔들리지 않도록 slug 를 마지막 tie-break 으로 둔다 (C9).
 */
export async function listRocketsBySeries(series: RocketSeries): Promise<RocketListItem[]> {
  const rows = await db
    .select(listColumns)
    .from(schema.rockets)
    .leftJoin(
      schema.media,
      and(
        eq(schema.media.id, schema.rockets.coverMediaId),
        eq(schema.media.status, 'ready'),
        isNull(schema.media.deletedAt)
      )
    )
    .leftJoin(
      schema.rocketSeries,
      eq(schema.rocketSeries.id, schema.rockets.series)
    )
    .where(and(isPublic, eq(schema.rockets.series, series)))
    .orderBy(asc(schema.rockets.sortOrder), asc(schema.rockets.id))

  return rows.map(toListItem)
}

/**
 * 카테고리 목록. **`/rocket` 탭의 원본**이다.
 *
 * `cache()` 로 감싼 이유는 한 요청 안에서 여러 곳이 부르기 때문이다 —
 * `generateMetadata` 가 canonical 을 정하려고, 페이지가 탭을 그리려고, 상세가 뒤로가기
 * 링크를 만들려고 각각 부른다. 요청 단위 캐시라 관리 화면 수정이 늦게 반영되지는 않는다.
 */
export const listRocketSeries = cache(async (): Promise<RocketSeriesOption[]> => {
  const rows = await db
    .select({ id: schema.rocketSeries.id, label: schema.rocketSeries.label })
    .from(schema.rocketSeries)
    .orderBy(asc(schema.rocketSeries.sortOrder), asc(schema.rocketSeries.id))

  return rows
})

/**
 * 비공개는 없는 것처럼 다룬다 — 상세는 notFound() 로 이어진다 (C8).
 *
 * generateMetadata 와 본문이 각각 부르기 때문에 감싸지 않으면 렌더 1회에 4쿼리가 나간다.
 * React.cache 는 요청 단위라 CMS 수정이 늦게 반영되는 일은 없다 (랜딩의 loadContent 와 동일 관례).
 */
export const getRocket = cache(async (slug: string): Promise<RocketDetail | null> => {
  const rows = await db
    .select({ ...listColumns, descriptionMd: schema.rockets.descriptionMd })
    .from(schema.rockets)
    .leftJoin(
      schema.media,
      and(
        eq(schema.media.id, schema.rockets.coverMediaId),
        eq(schema.media.status, 'ready'),
        isNull(schema.media.deletedAt)
      )
    )
    .leftJoin(
      schema.rocketSeries,
      eq(schema.rocketSeries.id, schema.rockets.series)
    )
    .where(and(isPublic, eq(schema.rockets.id, slug)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const engineRows = await db
    .select({
      id: schema.rocketEngines.id,
      type: schema.rocketEngines.type,
      thrustN: schema.rocketEngines.thrustN,
      burnTimeS: schema.rocketEngines.burnTimeS,
      count: schema.rocketEngines.count,
      mode: schema.rocketEngines.mode,
    })
    .from(schema.rocketEngines)
    .where(eq(schema.rocketEngines.rocketId, slug))
    .orderBy(asc(schema.rocketEngines.sortOrder), asc(schema.rocketEngines.id))

  return {
    ...toListItem(row),
    descriptionMd: row.descriptionMd,
    engines: engineRows.map((e) => ({
      id: e.id,
      type: e.type,
      thrustN: trimNumeric(e.thrustN),
      burnTimeS: trimNumeric(e.burnTimeS),
      count: e.count,
      // 빈 문자열은 값이 없는 것과 같게 취급한다 — CMS 가 빈 입력을 '' 로 저장할 수 있다.
      mode: e.mode && e.mode.trim() !== '' ? e.mode : null,
    })),
  }
})

/** generateStaticParams 용. 비공개는 프리렌더 목록에도 넣지 않는다. */
export async function listPublishedRocketSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.rockets.id })
    .from(schema.rockets)
    .where(isPublic)
    .orderBy(asc(schema.rockets.series), asc(schema.rockets.sortOrder))

  return rows.map((r) => r.slug)
}

import 'server-only'

import { and, asc, eq } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import type { RocketSeries } from '@/components/rocket/series'

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

/** `series` 는 text + CHECK 라 드라이버 타입이 string 이다. 유니온으로 좁혀서 내보낸다. */
function narrowSeries(raw: string): RocketSeries {
  return raw === 'B' ? 'B' : 'A'
}

const listColumns = {
  slug: schema.rockets.id,
  name: schema.rockets.name,
  series: schema.rockets.series,
  imageSrc: schema.rockets.legacyImagePath,
  maxAltitudeM: schema.rockets.maxAltitudeM,
  sizeM: schema.rockets.sizeM,
  payloadKg: schema.rockets.payloadKg,
} as const

type RawListRow = {
  slug: string
  name: string
  series: string
  imageSrc: string | null
  maxAltitudeM: string | null
  sizeM: string | null
  payloadKg: string | null
}

function toListItem(row: RawListRow): RocketListItem {
  return {
    slug: row.slug,
    name: row.name,
    series: narrowSeries(row.series),
    imageSrc: row.imageSrc,
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
    .where(and(isPublic, eq(schema.rockets.series, series)))
    .orderBy(asc(schema.rockets.sortOrder), asc(schema.rockets.id))

  return rows.map(toListItem)
}

/** 시리즈별 공개 개수 — 탭에 표기해 빈 탭을 눌러 보게 만들지 않는다. */
export async function countRocketsBySeries(): Promise<Record<RocketSeries, number>> {
  const rows = await db
    .select({ series: schema.rockets.series })
    .from(schema.rockets)
    .where(isPublic)

  const out: Record<RocketSeries, number> = { A: 0, B: 0 }
  for (const r of rows) out[narrowSeries(r.series)] += 1
  return out
}

/** 비공개는 없는 것처럼 다룬다 — 상세는 notFound() 로 이어진다 (C8). */
export async function getRocket(slug: string): Promise<RocketDetail | null> {
  const rows = await db
    .select({ ...listColumns, descriptionMd: schema.rockets.descriptionMd })
    .from(schema.rockets)
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
}

/** generateStaticParams 용. 비공개는 프리렌더 목록에도 넣지 않는다. */
export async function listPublishedRocketSlugs(): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.rockets.id })
    .from(schema.rockets)
    .where(isPublic)
    .orderBy(asc(schema.rockets.series), asc(schema.rockets.sortOrder))

  return rows.map((r) => r.slug)
}

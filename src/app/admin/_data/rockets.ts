import 'server-only'

import { asc, eq, sql } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import type { RocketSeriesOption } from '@/components/rocket/series'
import { versionExpr } from '../_lib/version'

/**
 * 어드민 로켓 DAL.
 *
 * 공개 DAL(`app/(public)/rocket/_data.ts`)과 달리 `published` 로 거르지 않는다 —
 * 비공개 로켓을 편집할 수 없으면 다시 공개할 방법이 없다.
 * 대신 이 모듈은 인증 게이트 안쪽(`/admin`)에서만 호출된다.
 */

export type AdminEngineRow = {
  id: string
  type: string
  thrustN: string
  burnTimeS: string
  count: number
  mode: string
}

export type AdminSeriesRow = {
  id: string
  label: string
  sortOrder: number
  /** 이 카테고리에 붙은 로켓 수 — 공개·비공개를 모두 센다. 삭제 가능 여부를 이 값이 정한다. */
  rocketCount: number
  /** 낙관적 잠금 토큰 (F12). */
  version: string
}

export type AdminRocketListItem = {
  id: string
  name: string
  series: string
  seriesLabel: string
  sortOrder: number
  published: boolean
  maxAltitudeM: string | null
  sizeM: string | null
  payloadKg: string | null
  engineCount: number
}

export type AdminRocketDetail = {
  id: string
  name: string
  series: string
  sortOrder: number
  published: boolean
  descriptionMd: string
  maxAltitudeM: string
  sizeM: string
  payloadKg: string
  /** 대표 이미지. 미디어 행이 사라졌으면 null 이고, 그때는 legacyImagePath 가 다시 쓰인다. */
  coverMediaId: string | null
  /** 아직 S3 로 옮기지 않은 레포 내 경로. 폼은 읽기만 하고 값을 바꾸지 않는다. */
  legacyImagePath: string | null
  /** 낙관적 잠금 토큰 (F12). */
  version: string
  engines: readonly AdminEngineRow[]
}

/**
 * pg 의 numeric 은 정밀도 보존을 위해 문자열로 온다('150.00'). 폼에 그대로 넣으면
 * 저장할 때마다 꼬리 0 이 늘어나 보이므로 표시용으로만 깎는다. DB 값은 건드리지 않는다.
 */
function trimNumeric(raw: string | null): string {
  if (raw == null) return ''
  const v = raw.trim()
  if (v === '' || !v.includes('.')) return v
  return v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/**
 * 목록 + 로켓별 엔진 수.
 *
 * 상관 서브쿼리를 쓰지 않는다: drizzle 이 `sql` 템플릿 안의 컬럼을 테이블 한정 없이 렌더해서
 * 바깥 `rockets.id`(text)가 안쪽 `rocket_engines.id`(uuid)로 해석돼 버린다. 집계를 따로 뽑아
 * JS 에서 합치면 그 모호함 자체가 생기지 않는다.
 */
export async function listRocketsForAdmin(): Promise<AdminRocketListItem[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: schema.rockets.id,
        name: schema.rockets.name,
        series: schema.rockets.series,
        seriesLabel: schema.rocketSeries.label,
        sortOrder: schema.rockets.sortOrder,
        published: schema.rockets.published,
        maxAltitudeM: schema.rockets.maxAltitudeM,
        sizeM: schema.rockets.sizeM,
        payloadKg: schema.rockets.payloadKg,
      })
      .from(schema.rockets)
      .leftJoin(schema.rocketSeries, eq(schema.rocketSeries.id, schema.rockets.series))
      .orderBy(
        asc(schema.rocketSeries.sortOrder),
        asc(schema.rockets.series),
        asc(schema.rockets.sortOrder),
        asc(schema.rockets.id)
      ),
    db
      .select({
        rocketId: schema.rocketEngines.rocketId,
        engineCount: sql<number>`count(*)::int`,
      })
      .from(schema.rocketEngines)
      .groupBy(schema.rocketEngines.rocketId),
  ])

  const byRocket = new Map(counts.map((c) => [c.rocketId, c.engineCount]))

  // left join 이라 타입은 null 가능이다. FK 가 있으니 실제로는 항상 채워진다.
  return rows.map((r) => ({
    ...r,
    seriesLabel: r.seriesLabel ?? r.series,
    engineCount: byRocket.get(r.id) ?? 0,
  }))
}

export async function getRocketForAdmin(id: string): Promise<AdminRocketDetail | null> {
  const rows = await db
    .select({
      id: schema.rockets.id,
      name: schema.rockets.name,
      series: schema.rockets.series,
      sortOrder: schema.rockets.sortOrder,
      published: schema.rockets.published,
      descriptionMd: schema.rockets.descriptionMd,
      maxAltitudeM: schema.rockets.maxAltitudeM,
      sizeM: schema.rockets.sizeM,
      payloadKg: schema.rockets.payloadKg,
      coverMediaId: schema.rockets.coverMediaId,
      legacyImagePath: schema.rockets.legacyImagePath,
      version: versionExpr(schema.rockets.updatedAt),
    })
    .from(schema.rockets)
    .where(eq(schema.rockets.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const engines = await db
    .select({
      id: schema.rocketEngines.id,
      type: schema.rocketEngines.type,
      thrustN: schema.rocketEngines.thrustN,
      burnTimeS: schema.rocketEngines.burnTimeS,
      count: schema.rocketEngines.count,
      mode: schema.rocketEngines.mode,
    })
    .from(schema.rocketEngines)
    .where(eq(schema.rocketEngines.rocketId, id))
    .orderBy(asc(schema.rocketEngines.sortOrder), asc(schema.rocketEngines.id))

  return {
    id: row.id,
    name: row.name,
    series: row.series,
    sortOrder: row.sortOrder,
    published: row.published,
    descriptionMd: row.descriptionMd ?? '',
    maxAltitudeM: trimNumeric(row.maxAltitudeM),
    sizeM: trimNumeric(row.sizeM),
    payloadKg: trimNumeric(row.payloadKg),
    coverMediaId: row.coverMediaId,
    legacyImagePath: row.legacyImagePath,
    version: row.version,
    engines: engines.map((e) => ({
      id: e.id,
      type: e.type,
      thrustN: trimNumeric(e.thrustN),
      burnTimeS: trimNumeric(e.burnTimeS),
      count: e.count,
      mode: e.mode ?? '',
    })),
  }
}

/**
 * 카테고리 목록 + 각 카테고리에 붙은 로켓 수.
 *
 * 로켓 수를 같이 세는 이유는 **삭제 버튼을 미리 막기 위해서**다. FK 가 `restrict` 라
 * 로켓이 남아 있으면 DB 가 어차피 거부하지만, 눌러 보고 나서 거부당하는 것과
 * 처음부터 못 누르는 것은 다르다.
 */
export async function listRocketSeriesForAdmin(): Promise<AdminSeriesRow[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: schema.rocketSeries.id,
        label: schema.rocketSeries.label,
        sortOrder: schema.rocketSeries.sortOrder,
        version: versionExpr(schema.rocketSeries.updatedAt),
      })
      .from(schema.rocketSeries)
      .orderBy(asc(schema.rocketSeries.sortOrder), asc(schema.rocketSeries.id)),
    db
      .select({ series: schema.rockets.series, n: sql<number>`count(*)::int` })
      .from(schema.rockets)
      .groupBy(schema.rockets.series),
  ])

  const bySeries = new Map(counts.map((c) => [c.series, c.n]))
  return rows.map((r) => ({ ...r, rocketCount: bySeries.get(r.id) ?? 0 }))
}

/** 폼의 시리즈 select 용. 라벨만 있으면 되므로 개수는 세지 않는다. */
export async function listRocketSeriesOptions(): Promise<RocketSeriesOption[]> {
  return db
    .select({ id: schema.rocketSeries.id, label: schema.rocketSeries.label })
    .from(schema.rocketSeries)
    .orderBy(asc(schema.rocketSeries.sortOrder), asc(schema.rocketSeries.id))
}

/** 새 카테고리의 기본 정렬순서 — 마지막 뒤. 중복이 허용되므로 편의값일 뿐이다. */
export async function nextRocketSeriesSortOrder(): Promise<number> {
  const rows = await db
    .select({ next: sql<number>`coalesce(max(${schema.rocketSeries.sortOrder}), -1) + 1` })
    .from(schema.rocketSeries)
  return rows[0]?.next ?? 0
}

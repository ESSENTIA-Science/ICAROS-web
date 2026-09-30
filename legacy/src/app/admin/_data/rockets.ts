import 'server-only'

import { asc, eq, sql } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import type { RocketSeriesOption, VehicleTypeOption } from '@/components/rocket/series'
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
  /** 상위 분류 id (`vehicle_types.id`). NOT NULL 이라 항상 값이 있다. */
  typeId: string
  /** 조인해서 같이 들고 온다 — 목록에 라벨을 그리려고 분류 목록을 또 읽지 않도록. */
  typeLabel: string
  /** 시리즈 설명(마크다운). 값이 없으면 null. */
  descriptionMd: string
  sortOrder: number
  /** 이 카테고리에 붙은 로켓 수 — 공개·비공개를 모두 센다. 삭제 가능 여부를 이 값이 정한다. */
  rocketCount: number
  /** 낙관적 잠금 토큰 (F12). */
  version: string
}

export type AdminVehicleTypeRow = {
  id: string
  label: string
  sortOrder: number
  /** 이 분류에 붙은 시리즈 수. FK 가 `restrict` 라 이 값이 0 이 아니면 삭제되지 않는다. */
  seriesCount: number
  /** 낙관적 잠금 토큰 (F12). */
  version: string
}

/**
 * 로켓 폼의 시리즈 select 용 — 분류로 묶어 그리려고 부모 정보를 같이 들고 온다.
 *
 * `RocketSeriesOption` 을 넓히지 않고 여기에 따로 둔 이유는 그 타입이 공개 화면과 공용이기
 * 때문이다(`components/rocket/series.ts` 주석). 관리 화면에만 필요한 필드를 그쪽에 밀어 넣으면
 * 공개 목록이 쓰지도 않는 컬럼을 매 요청 읽게 된다.
 */
export type AdminSeriesChoice = RocketSeriesOption & {
  typeId: string
  typeLabel: string
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
        typeId: schema.rocketSeries.typeId,
        typeLabel: schema.vehicleTypes.label,
        descriptionMd: schema.rocketSeries.descriptionMd,
        sortOrder: schema.rocketSeries.sortOrder,
        version: versionExpr(schema.rocketSeries.updatedAt),
      })
      .from(schema.rocketSeries)
      .leftJoin(schema.vehicleTypes, eq(schema.vehicleTypes.id, schema.rocketSeries.typeId))
      // 분류 순서가 먼저다 — 목록이 분류별로 뭉쳐 보여야 부모-자식 관계가 눈에 들어온다.
      .orderBy(
        asc(schema.vehicleTypes.sortOrder),
        asc(schema.rocketSeries.typeId),
        asc(schema.rocketSeries.sortOrder),
        asc(schema.rocketSeries.id)
      ),
    db
      .select({ series: schema.rockets.series, n: sql<number>`count(*)::int` })
      .from(schema.rockets)
      .groupBy(schema.rockets.series),
  ])

  const bySeries = new Map(counts.map((c) => [c.series, c.n]))
  // left join 이라 타입은 null 가능이다. FK 가 NOT NULL 이라 실제로는 항상 채워진다.
  return rows.map((r) => ({
    ...r,
    typeLabel: r.typeLabel ?? r.typeId,
    descriptionMd: r.descriptionMd ?? '',
    rocketCount: bySeries.get(r.id) ?? 0,
  }))
}

/**
 * 로켓 폼의 시리즈 select 용. 개수는 세지 않지만 **분류는 같이 읽는다** —
 * select 를 `<optgroup>` 으로 묶으려면 각 시리즈가 어느 분류에 속하는지 알아야 한다.
 * 정렬은 목록과 같다: 분류 순서 → 시리즈 순서. 그래야 그룹이 쪼개지지 않는다.
 */
export async function listRocketSeriesOptions(): Promise<AdminSeriesChoice[]> {
  const rows = await db
    .select({
      id: schema.rocketSeries.id,
      label: schema.rocketSeries.label,
      typeId: schema.rocketSeries.typeId,
      typeLabel: schema.vehicleTypes.label,
    })
    .from(schema.rocketSeries)
    .leftJoin(schema.vehicleTypes, eq(schema.vehicleTypes.id, schema.rocketSeries.typeId))
    .orderBy(
      asc(schema.vehicleTypes.sortOrder),
      asc(schema.rocketSeries.typeId),
      asc(schema.rocketSeries.sortOrder),
      asc(schema.rocketSeries.id)
    )

  return rows.map((r) => ({ ...r, typeLabel: r.typeLabel ?? r.typeId }))
}

/** 새 카테고리의 기본 정렬순서 — 마지막 뒤. 중복이 허용되므로 편의값일 뿐이다. */
export async function nextRocketSeriesSortOrder(): Promise<number> {
  const rows = await db
    .select({ next: sql<number>`coalesce(max(${schema.rocketSeries.sortOrder}), -1) + 1` })
    .from(schema.rocketSeries)
  return rows[0]?.next ?? 0
}

// ── 분류 (`vehicle_types`) ──────────────────────────────────────────────────

/**
 * 분류 목록 + 각 분류에 붙은 시리즈 수.
 *
 * 시리즈 수를 같이 세는 이유는 시리즈에서 로켓 수를 세는 이유와 같다 — **삭제 버튼을
 * 미리 막기 위해서**다. `rocket_series.type_id` FK 가 `restrict` 라 DB 가 어차피 거부하지만,
 * 눌러 보고 나서 거부당하는 것과 처음부터 못 누르는 것은 다르다.
 */
export async function listVehicleTypesForAdmin(): Promise<AdminVehicleTypeRow[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: schema.vehicleTypes.id,
        label: schema.vehicleTypes.label,
        sortOrder: schema.vehicleTypes.sortOrder,
        version: versionExpr(schema.vehicleTypes.updatedAt),
      })
      .from(schema.vehicleTypes)
      .orderBy(asc(schema.vehicleTypes.sortOrder), asc(schema.vehicleTypes.id)),
    db
      .select({ typeId: schema.rocketSeries.typeId, n: sql<number>`count(*)::int` })
      .from(schema.rocketSeries)
      .groupBy(schema.rocketSeries.typeId),
  ])

  const byType = new Map(counts.map((c) => [c.typeId, c.n]))
  return rows.map((r) => ({ ...r, seriesCount: byType.get(r.id) ?? 0 }))
}

/**
 * 시리즈 폼의 분류 select 용.
 *
 * 여기서는 공용 `VehicleTypeOption`(`{ id, label }`)을 그대로 쓴다 — 관리 화면이 더
 * 필요로 하는 것이 없다. 시리즈 쪽(`AdminSeriesChoice`)과 달리 넓힐 이유가 없다는 뜻이다.
 */
export async function listVehicleTypeOptions(): Promise<VehicleTypeOption[]> {
  return db
    .select({ id: schema.vehicleTypes.id, label: schema.vehicleTypes.label })
    .from(schema.vehicleTypes)
    .orderBy(asc(schema.vehicleTypes.sortOrder), asc(schema.vehicleTypes.id))
}

/** 새 분류의 기본 정렬순서 — 마지막 뒤. 중복이 허용되므로 편의값일 뿐이다. */
export async function nextVehicleTypeSortOrder(): Promise<number> {
  const rows = await db
    .select({ next: sql<number>`coalesce(max(${schema.vehicleTypes.sortOrder}), -1) + 1` })
    .from(schema.vehicleTypes)
  return rows[0]?.next ?? 0
}

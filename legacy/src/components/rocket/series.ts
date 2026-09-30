/**
 * 기체 택소노미 헬퍼 — **분류(`vehicle_types`) → 시리즈(`rocket_series`)** 두 층.
 *
 * 예전에는 이 파일에 `SERIES = [{id:'A'},{id:'B'}]` 배열이 있었고 DB 의 CHECK 와 1:1 이었다.
 * 지금은 **행이 원본**이다 — 분류·시리즈의 추가·수정·삭제가 `/admin` 에서 된다.
 *
 * 그래서 여기 남은 것은 **목록을 인자로 받는 순수 함수**뿐이다. 모듈 스코프에 목록을 캐시해 두면
 * 서버 인스턴스마다 다른 시점의 사본을 들고 있게 되고, 분류를 고친 뒤 새로고침할 때마다
 * 라벨이 왔다 갔다 한다. 목록은 항상 호출하는 쪽이 그 요청에서 읽어 넘긴다.
 *
 * **`RocketSeriesOption` 의 모양을 넓히지 말 것.** `/admin` 의 `_data/rockets.ts`·`RocketForm`
 * 이 이 타입을 `{ id, label }` 그대로 만들어 쓴다 — 필드를 추가하면 그쪽이 깨진다.
 * 공개 목록이 더 필요로 하는 것(`typeId`·`descriptionMd`)은 `VehicleSeriesOption` 에 있다.
 */

/** `/admin` 셀렉트 박스가 쓰는 최소 모양. 넓히지 말 것 (위 주석). */
export type RocketSeriesOption = {
  id: string
  label: string
}

/**
 * 시리즈 id. 값 집합이 DB 행이라 유니온으로 좁힐 수 없다 — 좁히면 그 순간
 * 시리즈를 추가할 수 없다는 뜻이 된다. 이름만 남겨 의도를 표시한다.
 */
export type RocketSeries = string

/** 분류 id. `RocketSeries` 와 같은 사정이다. */
export type VehicleType = string

export type VehicleTypeOption = {
  id: VehicleType
  label: string
}

/** 공개 목록이 쓰는 시리즈. 부모 분류와 시리즈 설명을 같이 들고 온다. */
export type VehicleSeriesOption = RocketSeriesOption & {
  typeId: VehicleType
  /** 시리즈 설명(마크다운). 없으면 화면에 아무것도 그리지 않는다. */
  descriptionMd: string | null
}

/** 한 요청에서 읽은 택소노미 전체. 두 목록이 따로 다니면 부모-자식 판정이 어긋난다. */
export type VehicleTaxonomy = {
  types: readonly VehicleTypeOption[]
  series: readonly VehicleSeriesOption[]
}

/** 목록의 첫 번째가 기본이다. 순서는 `sort_order` 가 정하므로 관리 화면에서 바꿀 수 있다. */
export function defaultType(types: readonly VehicleTypeOption[]): VehicleType | null {
  return types[0]?.id ?? null
}

/** 분류 라벨. 목록에 없는 id 는 id 를 그대로 보여 준다 — 빈 문자열보다 낫다. */
export function typeLabel(id: VehicleType, types: readonly VehicleTypeOption[]): string {
  return types.find((t) => t.id === id)?.label ?? id
}

/** 한 분류에 속한 시리즈만. 순서는 호출부가 넘긴 목록의 순서를 그대로 유지한다. */
export function seriesOfType(
  typeId: VehicleType | null,
  series: readonly VehicleSeriesOption[]
): VehicleSeriesOption[] {
  return typeId === null ? [] : series.filter((s) => s.typeId === typeId)
}

/** 목록의 첫 번째가 기본이다. */
export function defaultSeries(all: readonly RocketSeriesOption[]): RocketSeries | null {
  return all[0]?.id ?? null
}

/** 시리즈 라벨. 목록에 없는 id 는 id 를 그대로 보여 준다. */
export function seriesLabel(id: RocketSeries, all: readonly RocketSeriesOption[]): string {
  return all.find((s) => s.id === id)?.label ?? id
}

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * `?type=` 을 신뢰하지 않는다 — 쿼리스트링은 임의 입력이라 목록에 없는 값은 되돌린다.
 *
 * 되돌릴 때 **`?series=` 를 먼저 본다.** `/rocket?series=B` 로 저장된 옛 링크가 301 을 타고
 * `/vehicles?series=B` 로 그대로 넘어오기 때문이다(Next 는 리다이렉트에서 쿼리를 보존한다).
 * 시리즈 id 는 전역 유일하므로 그 한 값이 분류까지 결정한다 — 분류 순서가 나중에 바뀌어도
 * 옛 링크가 엉뚱한 탭으로 떨어지지 않는다.
 *
 * `?type=` 이 명시돼 있으면 그쪽이 이긴다. 둘이 어긋나면(`?type=uavs&series=B`) 시리즈가
 * 그 분류의 기본값으로 접힌다 — 사용자가 마지막으로 누른 것이 분류 탭이라고 보는 쪽이 맞다.
 */
export function parseVehicleType(
  rawType: string | string[] | undefined,
  rawSeries: string | string[] | undefined,
  tax: VehicleTaxonomy
): VehicleType | null {
  const t = firstParam(rawType)
  if (tax.types.some((x) => x.id === t)) return t as VehicleType

  const s = firstParam(rawSeries)
  const owner = tax.series.find((x) => x.id === s)
  if (owner && tax.types.some((x) => x.id === owner.typeId)) return owner.typeId

  return defaultType(tax.types)
}

/**
 * `?series=` 를 신뢰하지 않는다 — 목록에 없는 값은 조용히 기본 시리즈로 되돌린다.
 * 넘기는 목록은 **이미 분류로 걸러진 것**이어야 한다(`seriesOfType`). 시리즈가 하나도 없으면 null.
 */
export function parseSeries(
  raw: string | string[] | undefined,
  all: readonly RocketSeriesOption[]
): RocketSeries | null {
  const first = firstParam(raw)
  return all.some((s) => s.id === first) ? (first as RocketSeries) : defaultSeries(all)
}

/**
 * 목록 URL. 기본값은 쿼리에 넣지 않는다 — 같은 내용이 두 주소를 갖게 되고
 * 검색엔진이 한쪽을 중복으로 접는다. `generateMetadata` 의 canonical 도 이 함수를 쓴다.
 *
 * 목록에 없는 id 는 조용히 기본값으로 접는다. 링크를 만드는 쪽(카드·뒤로가기)은 DB 행에서
 * 값을 받아 오므로 정상 경로에서는 일어나지 않지만, 시리즈가 분류를 잃는 등의 어긋난 상태에서
 * **없는 탭을 가리키는 링크**를 뱉는 것보다 목록 첫 화면으로 보내는 편이 낫다.
 */
export function vehiclesHref(
  typeId: VehicleType | null,
  seriesId: RocketSeries | null,
  tax: VehicleTaxonomy
): string {
  const type = tax.types.some((t) => t.id === typeId) ? typeId : defaultType(tax.types)
  if (type === null) return '/vehicles'

  const params = new URLSearchParams()
  if (type !== defaultType(tax.types)) params.set('type', type)

  const inType = seriesOfType(type, tax.series)
  if (seriesId !== null && seriesId !== defaultSeries(inType) && inType.some((s) => s.id === seriesId)) {
    params.set('series', seriesId)
  }

  const query = params.toString()
  return query === '' ? '/vehicles' : `/vehicles?${query}`
}

/**
 * 기체 상세 URL. `rockets.id` 가 전역 유일한 PK 라 분류·시리즈를 경로에 담지 않는다 —
 * 담으면 시리즈를 옮긴 기체의 옛 주소가 전부 죽는다.
 */
export function vehicleHref(slug: string): string {
  return `/vehicles/${slug}`
}

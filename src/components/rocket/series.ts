/**
 * 로켓 카테고리(시리즈) 헬퍼.
 *
 * 예전에는 이 파일에 `SERIES = [{id:'A'},{id:'B'}]` 배열이 있었고 DB 의 CHECK 와 1:1 이었다.
 * 지금은 **`icaros.rocket_series` 행이 원본**이다 — 카테고리 추가·수정·삭제가 `/admin` 에서 된다.
 *
 * 그래서 여기 남은 것은 **목록을 인자로 받는 순수 함수**뿐이다. 모듈 스코프에 목록을 캐시해 두면
 * 서버 인스턴스마다 다른 시점의 사본을 들고 있게 되고, 카테고리를 고친 뒤 새로고침할 때마다
 * 라벨이 왔다 갔다 한다. 목록은 항상 호출하는 쪽이 그 요청에서 읽어 넘긴다.
 */

export type RocketSeriesOption = {
  id: string
  label: string
}

/**
 * 시리즈 id. 값 집합이 DB 행이라 유니온으로 좁힐 수 없다 — 좁히면 그 순간
 * 카테고리를 추가할 수 없다는 뜻이 된다. 이름만 남겨 의도를 표시한다.
 */
export type RocketSeries = string

/** 목록의 첫 번째가 기본이다. 순서는 `sort_order` 가 정하므로 관리 화면에서 바꿀 수 있다. */
export function defaultSeries(all: readonly RocketSeriesOption[]): RocketSeries | null {
  return all[0]?.id ?? null
}

/** 시리즈 라벨. 목록에 없는 id 는 id 를 그대로 보여 준다 — 빈 문자열보다 낫다. */
export function seriesLabel(id: RocketSeries, all: readonly RocketSeriesOption[]): string {
  return all.find((s) => s.id === id)?.label ?? id
}

/**
 * `?series=` 를 신뢰하지 않는다 — 쿼리스트링은 임의 입력이라
 * 목록에 없는 값은 조용히 기본 시리즈로 되돌린다. 카테고리가 하나도 없으면 null.
 */
export function parseSeries(
  raw: string | string[] | undefined,
  all: readonly RocketSeriesOption[]
): RocketSeries | null {
  const first = Array.isArray(raw) ? raw[0] : raw
  return all.some((s) => s.id === first) ? (first as RocketSeries) : defaultSeries(all)
}

/**
 * 목록 URL. 기본 시리즈는 `?series=` 를 붙이지 않는다 —
 * 같은 내용이 두 주소를 갖게 되고 검색엔진이 한쪽을 중복으로 접는다.
 */
export function seriesHref(id: RocketSeries, all: readonly RocketSeriesOption[]): string {
  return id === defaultSeries(all) ? '/rocket' : `/rocket?series=${encodeURIComponent(id)}`
}

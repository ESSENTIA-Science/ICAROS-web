/**
 * 시리즈는 `icaros.rockets.series` 의 CHECK ('A','B') 와 1:1 이다.
 * 라벨은 레거시 탭 문구를 그대로 옮겼다 — 팀 안에서 통용되는 호칭이라 번역하지 않는다.
 */
export const SERIES = [
  { id: 'A', label: 'ICX 1/2 Series' },
  { id: 'B', label: 'ICX MV Series' },
] as const

export type RocketSeries = (typeof SERIES)[number]['id']

export const DEFAULT_SERIES: RocketSeries = 'A'

/** 시리즈 라벨. CHECK 밖의 값은 DB 가 막으므로 여기서는 폴백만 둔다. */
export function seriesLabel(id: RocketSeries): string {
  return SERIES.find((s) => s.id === id)?.label ?? id
}

/**
 * `?series=` 를 신뢰하지 않는다 — 쿼리스트링은 임의 입력이라
 * 화이트리스트에 없는 값은 조용히 기본 시리즈로 되돌린다.
 */
export function parseSeries(raw: string | string[] | undefined): RocketSeries {
  const first = Array.isArray(raw) ? raw[0] : raw
  return SERIES.some((s) => s.id === first) ? (first as RocketSeries) : DEFAULT_SERIES
}

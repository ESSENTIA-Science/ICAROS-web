import 'server-only'

import { cache } from 'react'
import { db, schema } from '@/lib/db'

export type SiteContent = Record<string, string>

/**
 * 랜딩 카피 전체를 { key: value } 로 읽는다.
 *
 * 레거시 home.jsx 는 DEFAULTS 하드코딩 사본을 두고 DB 값을 그 위에 덮었는데,
 * 두 벌이 어긋난 채로 방치돼 있었다 (01 §5). 폴백 사본을 두지 않는다 —
 * DB 가 유일한 원본이고, 값이 없으면 그 자리는 비워 둔다.
 */
export const getSiteContent = cache(async (): Promise<SiteContent> => {
  const rows = await db
    .select({ key: schema.siteSettings.key, value: schema.siteSettings.value })
    .from(schema.siteSettings)

  const out: SiteContent = {}
  for (const r of rows) if (r.value != null && r.value !== '') out[r.key] = r.value
  return out
})

/** `\n` 구분 리스트를 배열로. 빈 줄은 버린다. */
export const toList = (v: string | undefined): string[] =>
  (v ?? '').split('\n').map((s) => s.trim()).filter(Boolean)

/**
 * 후원 금액 같은 수치 문자열을 숫자로.
 * 운영자가 CMS 에 `3,200,000` 처럼 콤마를 넣어 저장하는 일이 실제로 일어난다.
 * 그대로 Number() 하면 NaN → 0 이 되어 화면에 `/ 0`, `0%` 가 뜨고 에러도 로그도 남지 않는다.
 */
export const toNumber = (v: string | undefined): number => {
  if (v == null) return 0
  const n = Number(String(v).replace(/[,\s_]/g, ''))
  return Number.isFinite(n) ? n : 0
}

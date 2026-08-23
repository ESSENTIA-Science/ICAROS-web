import 'server-only'

import { sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * 낙관적 잠금 토큰 (F12).
 *
 * `updated_at` 을 Date 로 왕복시키면 안 된다: Postgres timestamptz 는 마이크로초까지 있는데
 * JS Date 는 밀리초까지만 담는다. 잘린 값을 그대로 비교하면 아무도 수정하지 않았는데도
 * 항상 충돌로 판정된다. 그래서 **비교를 DB 안에서 문자열로** 한다 —
 * 드라이버의 파싱 정밀도에 의존하지 않는 유일한 방법이다.
 */
function versionSql(column: PgColumn): SQL<string> {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
}

/** SELECT 절에 넣어 폼의 hidden 으로 실어 보낼 토큰. */
export const versionExpr = versionSql

/** 여러 행을 한 폼으로 저장할 때의 집계 토큰 — 그 중 하나라도 바뀌면 값이 달라진다. */
export function maxVersionExpr(column: PgColumn): SQL<string | null> {
  return sql<string | null>`to_char(max(${column}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
}

/** WHERE 절 대조. */
export function versionMatches(column: PgColumn, token: string): SQL<unknown> {
  return sql`${versionSql(column)} = ${token}`
}

const TOKEN_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

/**
 * 토큰은 클라이언트가 돌려주는 값이다. DB 로 흘려보내기 전에 형태를 본다 —
 * 파라미터 바인딩이라 인젝션은 아니지만, 쓰레기 값이 조용히 "충돌 없음"으로 처리되면 안 된다.
 */
export function isVersionToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value)
}

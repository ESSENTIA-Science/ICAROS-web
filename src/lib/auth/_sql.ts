import 'server-only'

import { sql } from 'drizzle-orm'

/**
 * 상수 초 단위를 Postgres interval 로 바꾼다.
 *
 * 파라미터 바인딩(`$1`) 대신 `sql.raw` 를 쓰는 이유: `make_interval(secs => $1)` 는
 * 인자 타입을 추론하지 못해 실패할 수 있다. 여기에 들어오는 값은 전부 호출부의 컴파일 타임 상수라
 * 인젝션 표면이 없고, `Math.trunc` 로 정수만 남긴다.
 */
export function intervalSecs(seconds: number) {
  return sql`make_interval(secs => ${sql.raw(String(Math.trunc(seconds)))})`
}

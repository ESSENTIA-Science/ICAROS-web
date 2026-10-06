import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { intervalSecs } from '@/lib/auth/_sql'
import { loginAttempts } from '@/lib/db/schema'
import { StorageError } from './errors'

/**
 * presign 호출 1건은 **무조건** `icaros.media` 행 하나와 서명 URL 하나를 만든다.
 * 인증만 통과하면 상한이 없어서, 세션 하나가 탈취되면 피해 크기가 정해지지 않는다.
 * 관리자 실수(업로드 컴포넌트의 재시도 루프)로도 같은 일이 벌어진다.
 *
 * **저장소로 `icaros.login_attempts` 를 재사용한다.** 스키마 변경은 이 트랙 범위 밖이고,
 * 서버리스라 in-memory 카운터를 신뢰할 수 없다(06 §6). 그 테이블은 `key` 가 PK 인 범용 키 카운터이고
 * 로그인 쪽은 항상 자기 키 목록(`email:` · `ip:`)을 명시해 조회·삭제하므로 네임스페이스가 겹치지 않는다.
 * 컬럼 의미만 다르게 읽는다: `fail_count` = 창 안의 호출 수, `first_fail_at` = 창 시작 시각.
 * `locked_until` 은 쓰지 않는다 — 여기서 필요한 건 잠금이 아니라 창당 상한이다.
 */
const WINDOW_SEC = 60

/**
 * 창당 상한. 로켓 상세 한 건을 편집하면서 이미지 여러 장을 연속 업로드하는 것이 정상 사용이라
 * 넉넉히 잡되, 자동 루프는 1초 안에 이 값을 넘긴다.
 */
const MAX_PER_WINDOW = 30

/** 관리자별 키. `email:`·`ip:` 와 섞이지 않게 접두사를 나눈다. */
export function presignQuotaKey(adminUserId: string): string {
  return `presign:${adminUserId}`
}

/**
 * 호출 1건을 카운터에 반영하고, 창 상한을 넘었으면 429 로 던진다.
 *
 * 검증보다 **먼저** 부른다 — 형식이 틀린 요청도 서버 일을 만들고, 검증 통과분만 세면
 * 잘못된 요청을 무한히 보내는 쪽이 오히려 공짜가 된다.
 *
 * 증가와 판정을 한 문장으로 처리한다. 읽고-나서-쓰면 동시 요청 사이에 창이 열린다.
 */
export async function consumePresignQuota(adminUserId: string): Promise<void> {
  const windowExpired = sql`(${loginAttempts.firstFailAt} is null or ${loginAttempts.firstFailAt} < now() - ${intervalSecs(WINDOW_SEC)})`
  const nextCount = sql`(case when ${windowExpired} then 1 else ${loginAttempts.failCount} + 1 end)`

  const rows = await db
    .insert(loginAttempts)
    .values({
      key: presignQuotaKey(adminUserId),
      failCount: 1,
      firstFailAt: sql`now()`,
      lastFailAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        failCount: nextCount,
        firstFailAt: sql`case when ${windowExpired} then now() else ${loginAttempts.firstFailAt} end`,
        lastFailAt: sql`now()`,
      },
    })
    .returning({ count: loginAttempts.failCount })

  // 행을 돌려받지 못하는 경우는 없지만, 여기서 조용히 통과시키면 상한이 사라진다. 1 로 보고 넘긴다.
  const count = rows[0]?.count ?? 1
  if (count > MAX_PER_WINDOW) {
    throw new StorageError('rate_limited', '업로드 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.')
  }
}

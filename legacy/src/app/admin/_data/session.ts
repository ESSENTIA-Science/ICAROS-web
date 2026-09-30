import 'server-only'

import { eq } from 'drizzle-orm'
import { db, schema } from '@/lib/db'
import { getSessionUserId } from '@/lib/auth/session'

/**
 * "로그인은 했는데 비활성화된 계정" 화면을 위한 조회.
 *
 * `resolveSession()` 은 `is_active = true` 를 조건에 넣고 판정하므로 비활성 관리자는
 * 미로그인과 구분되지 않는다. 그 상태에서 로그인 폼만 보여 주면 본인은 비밀번호를 계속
 * 다시 입력하다 rate limit 에 걸린다 — 무슨 일이 벌어졌는지 알려 줄 필요가 있다.
 *
 * **이 함수는 아무것도 허가하지 않는다.** 쿠키가 가리키는 계정이 비활성일 때만 값을 돌려주고,
 * 그 값은 안내 문구에만 쓰인다. 인가 판정에 절대 쓰지 말 것.
 */
export async function findDeactivatedAdmin(): Promise<{ email: string } | null> {
  const userId = await getSessionUserId()
  if (!userId) return null

  const rows = await db
    .select({ email: schema.adminUsers.email, isActive: schema.adminUsers.isActive })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, userId))
    .limit(1)

  const row = rows[0]
  if (!row || row.isActive) return null
  return { email: row.email }
}

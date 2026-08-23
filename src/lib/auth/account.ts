import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminUsers } from '@/lib/db/schema'
import { EMAIL_MAX_LENGTH, looksLikeEmail, normalizeEmail } from './email'
import { recordAuthEvent } from './events'
import { assertTrustedOrigin, getRequestMeta, requireAdmin } from './guard'
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from './password'
import { checkLock, clearFailures, rateLimitKeys, registerFailure } from './ratelimit'
import {
  clearSessionCookie,
  getSessionUserId,
  revokeAllSessionsForUser,
  revokeCurrentSession,
  startSession,
} from './session'

/**
 * 로그인 실패는 **이유를 불문하고 이 문장 하나**로만 답한다 (06 §6, H3).
 * 미존재 계정·틀린 비밀번호·비활성 계정·rate limit 잠금이 전부 같은 응답이어야
 * "이 이메일은 존재한다"는 신호가 새지 않는다.
 */
export const LOGIN_FAILED_MESSAGE = '이메일 또는 비밀번호가 올바르지 않습니다.'

export type LoginResult = { ok: true } | { ok: false; message: string }

const loginFailed: LoginResult = { ok: false, message: LOGIN_FAILED_MESSAGE }

/**
 * 로그인 (H3·H5·H13·H15).
 *
 * 쿠키를 세팅하므로 **Server Action 또는 Route Handler 안에서만** 호출할 수 있고,
 * 그 파일에는 `export const runtime = 'nodejs'` 가 있어야 한다 (06 §7).
 *
 * 실패 경로마다 `verifyAgainstDummy()` 를 부르는 것이 핵심이다 — Argon2 검증을 건너뛰면
 * 20~50ms 의 응답 시간 차이가 계정 존재 여부를 알려준다.
 */
export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  const { ip, userAgent } = await getRequestMeta()
  const email = normalizeEmail(input.email).slice(0, EMAIL_MAX_LENGTH)

  // 로그인도 mutation 이다. Route Handler 로 감싸면 Next 내장 방어가 걸리지 않는다.
  try {
    await assertTrustedOrigin()
  } catch {
    await recordAuthEvent({
      kind: 'login_fail',
      emailAttempted: email,
      ip,
      userAgent,
      detail: { reason: 'bad_origin' },
    })
    return loginFailed
  }

  if (!looksLikeEmail(email)) {
    await verifyAgainstDummy(input.password)
    await recordAuthEvent({
      kind: 'login_fail',
      emailAttempted: email,
      ip,
      userAgent,
      detail: { reason: 'malformed_email' },
    })
    return loginFailed
  }

  const keys = rateLimitKeys(email, ip)

  const lock = await checkLock(keys)
  if (lock.locked) {
    // 잠금 사실을 응답 시간으로도 흘리지 않는다.
    await verifyAgainstDummy(input.password)
    await recordAuthEvent({
      kind: 'rate_limited',
      emailAttempted: email,
      ip,
      userAgent,
      detail: { locked_until: lock.until?.toISOString() ?? null },
    })
    return loginFailed
  }

  // 유니크 인덱스가 lower(email) 위에 있으므로 같은 식으로 조회해야 인덱스를 탄다.
  const rows = await db
    .select({
      id: adminUsers.id,
      passwordHash: adminUsers.passwordHash,
      isActive: adminUsers.isActive,
    })
    .from(adminUsers)
    .where(sql`lower(${adminUsers.email}) = ${email}`)
    .limit(1)

  const user = rows[0]

  if (!user) {
    await verifyAgainstDummy(input.password)
    await registerFailure(keys)
    await recordAuthEvent({
      kind: 'login_fail',
      emailAttempted: email,
      ip,
      userAgent,
      detail: { reason: 'unknown_email' },
    })
    return loginFailed
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password)

  if (!passwordOk) {
    await registerFailure(keys)
    await recordAuthEvent({
      kind: 'login_fail',
      emailAttempted: email,
      userId: user.id,
      ip,
      userAgent,
      detail: { reason: 'wrong_password' },
    })
    return loginFailed
  }

  if (!user.isActive) {
    await registerFailure(keys)
    await recordAuthEvent({
      kind: 'login_fail',
      emailAttempted: email,
      userId: user.id,
      ip,
      userAgent,
      detail: { reason: 'inactive' },
    })
    return loginFailed
  }

  await rehashIfWeak(user.id, user.passwordHash, input.password)
  await clearFailures(keys)

  await db
    .update(adminUsers)
    .set({ lastLoginAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(adminUsers.id, user.id))

  await startSession({ userId: user.id, ip, userAgent })

  await recordAuthEvent({
    kind: 'login_success',
    emailAttempted: email,
    userId: user.id,
    ip,
    userAgent,
  })

  return { ok: true }
}

/**
 * 파라미터 상향 시 재해싱 (06 §2). 평문을 합법적으로 쥐고 있는 유일한 시점이 로그인 성공 직후다.
 *
 * `password_changed_at` 은 **건드리지 않는다** — 이건 비밀번호 변경이 아니다.
 * 갱신하면 그 사용자의 다른 기기 세션이 전부 죽는다.
 * 실패해도 로그인은 성공시킨다: 해시 업그레이드가 로그인을 막을 이유가 없다.
 */
async function rehashIfWeak(userId: string, storedHash: string, password: string): Promise<void> {
  if (!needsRehash(storedHash)) return
  try {
    const passwordHash = await hashPassword(password)
    await db
      .update(adminUsers)
      .set({ passwordHash, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, userId))
  } catch {
    console.error('[auth] 비밀번호 재해싱 실패')
  }
}

/** 로그아웃 (H10). 쿠키만 지우면 토큰은 살아 있다 — 서버에서 먼저 폐기한다. */
export async function logout(): Promise<void> {
  await assertTrustedOrigin()
  const { ip, userAgent } = await getRequestMeta()
  const userId = await getSessionUserId()

  await revokeCurrentSession()
  await clearSessionCookie()

  await recordAuthEvent({ kind: 'logout', userId, ip, userAgent })
}

export type ChangePasswordResult = { ok: true } | { ok: false; message: string }

/**
 * 비밀번호 변경 (H16). 이미 인증된 경로라 계정 열거 걱정이 없으므로 구체적인 실패 사유를 돌려준다.
 * 변경 후 **본인의 모든 세션**을 폐기하고 즉시 새 세션을 발급한다 — 다른 브라우저는 그 자리에서 튕긴다.
 */
export async function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<ChangePasswordResult> {
  const session = await requireAdmin()
  const { ip, userAgent } = await getRequestMeta()

  const rows = await db
    .select({ passwordHash: adminUsers.passwordHash })
    .from(adminUsers)
    .where(eq(adminUsers.id, session.userId))
    .limit(1)

  const user = rows[0]
  if (!user) return { ok: false, message: '계정을 찾을 수 없습니다.' }

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    await recordAuthEvent({
      kind: 'login_fail',
      emailAttempted: session.email,
      userId: session.userId,
      ip,
      userAgent,
      detail: { reason: 'password_change_reauth' },
    })
    return { ok: false, message: '현재 비밀번호가 올바르지 않습니다.' }
  }

  // 코드 포인트 기준으로 센다 — 한글·이모지가 섞여도 사용자가 보는 길이와 어긋나지 않는다.
  if ([...input.newPassword].length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` }
  }
  if (input.newPassword === input.currentPassword) {
    return { ok: false, message: '새 비밀번호가 현재 비밀번호와 같습니다.' }
  }

  const passwordHash = await hashPassword(input.newPassword)

  await db
    .update(adminUsers)
    .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(adminUsers.id, session.userId))

  await revokeAllSessionsForUser(session.userId)
  // 새 세션의 created_at 은 방금 갱신된 password_changed_at 이후라 §4 쿼리를 통과한다.
  await startSession({ userId: session.userId, ip, userAgent })

  await recordAuthEvent({
    kind: 'password_changed',
    emailAttempted: session.email,
    userId: session.userId,
    ip,
    userAgent,
  })

  return { ok: true }
}

/**
 * 관리자 활성/비활성 (H15).
 *
 * 비활성화는 revoke 를 돌리지만, 진짜 차단은 세션 판정 쿼리의 `u.is_active` 조건이 한다 —
 * revoke UPDATE 가 실패해도 다음 요청에서 거부된다.
 *
 * `auth_events.kind` CHECK 에 재활성화 값이 없어 비활성화만 기록한다.
 */
export async function setAdminActive(userId: string, isActive: boolean): Promise<void> {
  const actor = await requireAdmin()
  const { ip, userAgent } = await getRequestMeta()

  const rows = await db
    .update(adminUsers)
    .set({ isActive, updatedAt: sql`now()` })
    .where(eq(adminUsers.id, userId))
    .returning({ email: adminUsers.email })

  const target = rows[0]
  if (!target) throw new Error('대상 관리자를 찾을 수 없습니다')

  if (isActive) return

  await revokeAllSessionsForUser(userId)
  await recordAuthEvent({
    kind: 'admin_deactivated',
    emailAttempted: target.email,
    userId,
    ip,
    userAgent,
    detail: { actor_user_id: actor.userId },
  })
}

import 'server-only'

import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminUsers } from '@/lib/db/schema'
import { EMAIL_MAX_LENGTH, looksLikeEmail, normalizeEmail } from './email'
import { recordAuthEvent } from './events'
import { assertTrustedOrigin, requireAdmin } from './guard'
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from './password'
import { checkLock, clearFailures, rateLimitKeys, registerFailure } from './ratelimit'
import { getRequestMeta } from './request'
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
    // ⚠ kind 오버로딩: 이건 **이미 인증된 세션 안의** 재인증 실패지 미인증 로그인 실패가 아니다.
    // `auth_events_kind_ck` 에 맞는 값이 없어 `login_fail` 을 빌려 쓴다.
    // 침해 조사에서 `kind='login_fail'` 을 그대로 집계하면 두 부류가 섞이므로
    // **`detail->>'reason' <> 'password_change_reauth'` 로 걸러야 한다** (06 §10).
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

export type AccountErrorCode = 'admin_not_found' | 'self_deactivate' | 'last_active_admin'

/**
 * 관리자 계정 조작 실패. 이미 인증된 콘솔 안에서만 발생하므로 계정 열거 우려가 없어
 * 메시지를 그대로 보여줘도 된다. `code` 는 호출부가 분기용으로 쓴다.
 */
export class AccountError extends Error {
  readonly code: AccountErrorCode

  constructor(code: AccountErrorCode, message: string) {
    super(message)
    this.name = 'AccountError'
    this.code = code
  }
}

export function isAccountError(error: unknown): error is AccountError {
  return error instanceof AccountError
}

/**
 * 관리자 활성/비활성 (H15).
 *
 * 비활성화는 revoke 를 돌리지만, 진짜 차단은 세션 판정 쿼리의 `u.is_active` 조건이 한다 —
 * revoke UPDATE 가 실패해도 다음 요청에서 거부된다.
 *
 * **잠금 방지 두 겹** — 비활성 관리자는 세션 판정에서 즉시 막히고, bootstrap CLI 없이는 되돌릴
 * 방법이 콘솔 재진입뿐이라 한 번 0명이 되면 DB 직접 조작 말고는 복구 경로가 없다.
 * 1. 자기 자신 비활성화 금지 — 마지막 한 명이 아니어도 막는다. 되돌릴 권한이 방금 사라진 상태가 되고,
 *    관리자 목록에서 실수로 누르기 가장 쉬운 자리다.
 * 2. 마지막 활성 관리자 비활성화 금지 — 트랜잭션 안에서 활성 관리자 행을 전부 잠그고 센다.
 *
 * ⚠ kind 오버로딩: `auth_events_kind_ck` 에 재활성화 값이 없어 **재활성화도 `admin_deactivated`**
 * 로 남기고 `detail.action` 으로만 구분한다. 집계 시 `detail->>'action' = 'deactivated'` 를
 * 반드시 걸어야 한다 (06 §10).
 */
export async function setAdminActive(userId: string, isActive: boolean): Promise<void> {
  const actor = await requireAdmin()
  const { ip, userAgent } = await getRequestMeta()

  const target = await db.transaction(async (tx) => {
    // 활성 관리자 전원을 id 순으로 잠근다.
    // 카운트만 세면 마지막 두 명을 동시에 비활성화하는 두 트랜잭션이 **둘 다** 2를 보고 통과해 0명이 된다.
    // READ COMMITTED 에서 `for update` 는 락을 얻은 뒤 조건을 재평가하므로, 먼저 커밋한 쪽이 반영된 수가 보인다.
    // id 정렬은 락 획득 순서를 고정해 데드락을 막는다.
    const activeAdmins = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.isActive, true))
      .orderBy(adminUsers.id)
      .for('update')

    const rows = await tx
      .select({ email: adminUsers.email, isActive: adminUsers.isActive })
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .limit(1)

    const found = rows[0]
    if (!found) throw new AccountError('admin_not_found', '대상 관리자를 찾을 수 없습니다.')

    if (!isActive) {
      if (userId === actor.userId) {
        throw new AccountError('self_deactivate', '자기 계정은 비활성화할 수 없습니다.')
      }
      // 호출자의 세션이 살아 있으면 보통 활성 관리자가 2명 이상이지만,
      // 다른 트랜잭션이 방금 호출자를 비활성화했다면 여기서 1명이 보인다. 그 경합이 이 검사의 존재 이유다.
      if (found.isActive && activeAdmins.length <= 1) {
        throw new AccountError('last_active_admin', '마지막 활성 관리자는 비활성화할 수 없습니다.')
      }
    }

    // 이미 원하는 상태면 아무 것도 하지 않는다 — 같은 버튼을 두 번 눌러 감사 로그가 부풀지 않게.
    if (found.isActive === isActive) return { email: found.email, changed: false }

    await tx
      .update(adminUsers)
      .set({ isActive, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, userId))

    return { email: found.email, changed: true }
  })

  if (!target.changed) return

  if (isActive) {
    await recordAuthEvent({
      kind: 'admin_deactivated',
      emailAttempted: target.email,
      userId,
      ip,
      userAgent,
      detail: { action: 'reactivated', actor_user_id: actor.userId },
    })
    return
  }

  await revokeAllSessionsForUser(userId)
  await recordAuthEvent({
    kind: 'admin_deactivated',
    emailAttempted: target.email,
    userId,
    ip,
    userAgent,
    detail: { action: 'deactivated', actor_user_id: actor.userId },
  })
}

import 'server-only'

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, gt, gte, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { adminSessions, adminUsers } from '@/lib/db/schema'
import { intervalSecs } from './_sql'
import { recordAuthEvent } from './events'
import { getRequestMeta, type RequestMeta } from './request'

/**
 * `__Host-` 접두사: 서브도메인이 이 쿠키를 덮어쓸 수 없게 못박는다.
 * `icaros.kr` 과 형제 서브도메인이 같은 등록 도메인이라 실제 의미가 있다 (06 §4).
 * 접두사 요구사항 = Secure + Path=/ + Domain 미지정.
 */
export const SESSION_COOKIE = '__Host-icaros_session'

/** 절대 만료 7일 — 갱신 없이 무조건 폐기. */
export const SESSION_ABSOLUTE_TTL_SEC = 7 * 24 * 60 * 60
/** 유휴 만료 8시간 — `last_seen_at` 기준. */
export const SESSION_IDLE_TTL_SEC = 8 * 60 * 60
/** 매 요청 write 를 막는 하한. 5분 안에 다시 와도 UPDATE 를 내지 않는다. */
const LAST_SEEN_THROTTLE_SEC = 5 * 60
/** 만료 후에도 이만큼은 남겨 둔다 — 즉시 지우면 "왜 튕겼는지"를 조사할 근거가 사라진다. */
const SESSION_RETENTION_SEC = 30 * 24 * 60 * 60

export type AdminSession = {
  sessionId: string
  userId: string
  email: string
  displayName: string | null
}

/**
 * 세션 토큰은 비밀번호가 아니다 — 입력이 이미 256비트 CSPRNG 라 사전 공격 대상이 아니고,
 * 느린 KDF 가 필요 없다. DB 에는 이 해시만 들어간다 (06 §4, H7).
 */
function sha256(raw: string): Buffer {
  return createHash('sha256').update(raw, 'utf8').digest()
}

async function readSessionCookie(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(SESSION_COOKIE)?.value ?? null
}

export type CreateSessionInput = {
  userId: string
  ip?: string | null
  userAgent?: string | null
}

/**
 * 세션 행을 만들고 **원문 토큰**을 반환한다. 원문은 여기서 한 번 존재하고 쿠키로만 나간다.
 * 로그·에러·DB 어디에도 남기지 말 것.
 */
export async function createSession(
  input: CreateSessionInput
): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_SEC * 1000)

  const rows = await db
    .insert(adminSessions)
    .values({
      userId: input.userId,
      tokenHash: sha256(token),
      expiresAt,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
    .returning({ id: adminSessions.id })

  const row = rows[0]
  if (!row) throw new Error('세션 생성에 실패했습니다')

  return { sessionId: row.id, token, expiresAt }
}

/** Server Action / Route Handler 안에서만 호출할 수 있다 (렌더 중에는 쿠키를 쓸 수 없다). */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // localhost 는 브라우저가 secure context 로 취급하므로 개발 환경에서도 그대로 둔다.
    // 여기에 환경 분기를 넣으면 프로덕션에서 Secure 가 빠지는 사고가 언젠가 난다.
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    maxAge: SESSION_ABSOLUTE_TTL_SEC,
  })
}

/**
 * `delete()` 대신 동일 속성으로 빈 값을 덮어쓴다 — 속성이 한 글자라도 다르면
 * 브라우저가 다른 쿠키로 보고 원본을 남겨 둔다.
 */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export async function startSession(input: CreateSessionInput): Promise<string> {
  const { sessionId, token, expiresAt } = await createSession(input)
  await setSessionCookie(token, expiresAt)
  return sessionId
}

/** 요청 쿠키 기준 세션 판정. 인가 판정의 표준 진입점이다. */
export async function resolveSession(): Promise<AdminSession | null> {
  const raw = await readSessionCookie()
  if (!raw) return null
  // 메타데이터는 만료 이벤트에만 쓰이지만, 판정 실패 후에는 요청 컨텍스트를 다시 열 이유가 없으므로 미리 읽는다.
  return resolveSessionByToken(raw, await getRequestMeta())
}

/**
 * 세션 판정 본체 (06 §4). **단일 쿼리**로 끝낸다.
 *
 * 마지막 `created_at >= password_changed_at` 조건이 안전망이다:
 * 비밀번호 변경 시의 일괄 revoke UPDATE 가 실패해도, 변경 이전에 발급된 세션은
 * 구조적으로 이 쿼리를 통과하지 못한다 (H16).
 *
 * 쿠키 읽기와 분리해 둔 이유: 판정 로직이 HTTP 요청 컨텍스트 없이도 검증 가능해야 한다.
 */
export async function resolveSessionByToken(
  raw: string,
  meta: RequestMeta = { ip: null, userAgent: null }
): Promise<AdminSession | null> {
  const tokenHash = sha256(raw)

  const rows = await db
    .select({
      sessionId: adminSessions.id,
      storedTokenHash: adminSessions.tokenHash,
      lastSeenAt: adminSessions.lastSeenAt,
      userId: adminUsers.id,
      email: adminUsers.email,
      displayName: adminUsers.displayName,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
    .where(
      and(
        eq(adminSessions.tokenHash, tokenHash),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, sql`now()`),
        gt(adminSessions.lastSeenAt, sql`now() - ${intervalSecs(SESSION_IDLE_TTL_SEC)}`),
        eq(adminUsers.isActive, true),
        gte(adminSessions.createdAt, adminUsers.passwordChangedAt)
      )
    )
    .limit(1)

  const row = rows[0]
  if (!row) {
    // 어떤 조건에서 떨어졌는지는 이 쿼리로 알 수 없다. 만료·유휴인 경우에만 여기서 확정한다.
    await expireSession(tokenHash, meta)
    return null
  }

  // 인덱스 조회만으로 이미 걸러졌지만, 애플리케이션 레벨 비교가 생긴 이상 상수 시간으로 한다 (H17).
  if (
    row.storedTokenHash.length !== tokenHash.length ||
    !timingSafeEqual(row.storedTokenHash, tokenHash)
  ) {
    return null
  }

  await touchSession(row.sessionId, row.lastSeenAt)

  return {
    sessionId: row.sessionId,
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
  }
}

/**
 * 만료·유휴로 판정에서 떨어진 세션을 그 자리에서 폐기하고 `session_expired` 를 남긴다 (06 §10).
 *
 * **요청마다 write 가 나가면 안 된다.** 그래서 폐기와 기록을 한 UPDATE 에 묶는다:
 * `revoked_at is null` 이 조건에 있으므로 같은 쿠키로 몇 번을 더 와도 갱신되는 행이 0이고,
 * 이벤트는 세션당 정확히 한 번만 기록된다. 존재하지 않는 토큰(= 무작위 대입)은 매칭 자체가 안 돼
 * write 도 로그도 발생하지 않는다.
 *
 * `is_active=false` 나 비밀번호 변경으로 떨어진 세션은 만료 조건에 걸리지 않아 여기서 손대지 않는다 —
 * 그 경로는 각자 `revoke` 와 `admin_deactivated`/`password_changed` 를 이미 남긴다.
 */
async function expireSession(tokenHash: Buffer, meta: RequestMeta): Promise<void> {
  try {
    const rows = await db
      .update(adminSessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(adminSessions.tokenHash, tokenHash),
          isNull(adminSessions.revokedAt),
          or(
            lte(adminSessions.expiresAt, sql`now()`),
            lte(adminSessions.lastSeenAt, sql`now() - ${intervalSecs(SESSION_IDLE_TTL_SEC)}`)
          )
        )
      )
      .returning({
        userId: adminSessions.userId,
        absolute: sql<boolean>`${adminSessions.expiresAt} <= now()`,
      })

    const expired = rows[0]
    if (!expired) return

    await recordAuthEvent({
      kind: 'session_expired',
      userId: expired.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { reason: expired.absolute ? 'absolute' : 'idle' },
    })
  } catch {
    // 기록 실패가 판정을 바꾸면 안 된다 — 세션은 어차피 거부된다. 에러 객체는 찍지 않는다 (06 §10).
    console.error('[auth] 만료 세션 폐기 기록 실패')
  }
}

/** 5분 스로틀. WHERE 에 같은 조건을 한 번 더 걸어 동시 요청이 서로를 덮어쓰지 않게 한다. */
async function touchSession(sessionId: string, lastSeenAt: Date): Promise<void> {
  if (Date.now() - lastSeenAt.getTime() < LAST_SEEN_THROTTLE_SEC * 1000) return
  try {
    await db
      .update(adminSessions)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(adminSessions.id, sessionId),
          lt(adminSessions.lastSeenAt, sql`now() - ${intervalSecs(LAST_SEEN_THROTTLE_SEC)}`)
        )
      )
  } catch {
    // 갱신 실패가 인증 실패가 되면 안 된다. 에러 객체는 찍지 않는다 (06 §10).
    console.error('[auth] last_seen_at 갱신 실패')
  }
}

/**
 * 감사 기록 전용 조회. `resolveSession()` 과 달리 유효성 조건을 걸지 않는다 —
 * 이미 만료·폐기된 세션으로 로그아웃해도 "누가 로그아웃했는지"는 남겨야 하기 때문이다.
 * **인가 판정에 쓰지 말 것.**
 */
export async function getSessionUserId(): Promise<string | null> {
  const raw = await readSessionCookie()
  if (!raw) return null
  const rows = await db
    .select({ userId: adminSessions.userId })
    .from(adminSessions)
    .where(eq(adminSessions.tokenHash, sha256(raw)))
    .limit(1)
  return rows[0]?.userId ?? null
}

/** logout 경로 (H10). 쿠키를 지우기 전에 서버에서 먼저 죽인다 — 쿠키만 지우면 토큰이 그대로 유효하다. */
export async function revokeCurrentSession(): Promise<void> {
  const raw = await readSessionCookie()
  if (raw) await revokeSessionByToken(raw)
}

export async function revokeSessionByToken(raw: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(adminSessions.tokenHash, sha256(raw)), isNull(adminSessions.revokedAt)))
}

/** 비밀번호 변경·비활성화·강제 폐기 (06 §4). 현재 세션도 함께 죽는다. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)))
}

/** Vercel Cron 용 정리 작업 (06 §4). 감사 흔적은 auth_events 에 남으므로 세션 행은 지워도 된다. */
export async function deleteStaleSessions(): Promise<number> {
  const rows = await db
    .delete(adminSessions)
    .where(lt(adminSessions.expiresAt, sql`now() - ${intervalSecs(SESSION_RETENTION_SEC)}`))
    .returning({ id: adminSessions.id })
  return rows.length
}

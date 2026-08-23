import 'server-only'

import { and, gt, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { loginAttempts } from '@/lib/db/schema'
import { EMAIL_MAX_LENGTH } from './email'
import { intervalSecs } from './_sql'

/** `first_fail_at` 이 이만큼 지나면 카운터를 0부터 다시 센다 (06 §6). */
const COUNTER_WINDOW_SEC = 24 * 60 * 60

/**
 * 실패 backoff. **내림차순**으로 두고 첫 번째로 만족하는 항목이 이긴다.
 * 1–4회는 잠그지 않는다 — 오타 몇 번으로 관리자를 잠그면 운영이 마비된다.
 */
const BACKOFF = [
  { atLeast: 8, lockSec: 60 * 60 },
  { atLeast: 7, lockSec: 15 * 60 },
  { atLeast: 6, lockSec: 5 * 60 },
  { atLeast: 5, lockSec: 60 },
] as const

/**
 * 이중 키 (06 §6).
 * - `email:` — 여러 IP 에서 한 계정을 두드리는 공격
 * - `ip:` — 한 IP 에서 여러 계정을 훑는 공격
 *
 * IP 를 모르면 `ip:` 키를 **아예 만들지 않는다**. `ip:unknown` 같은 공용 버킷을 두면
 * IP 를 못 읽는 클라이언트끼리 서로를 잠그는 자책골이 된다.
 */
export function rateLimitKeys(normalizedEmail: string, ip: string | null): string[] {
  const keys = [`email:${normalizedEmail.slice(0, EMAIL_MAX_LENGTH)}`]
  if (ip) keys.push(`ip:${ip}`)
  return keys
}

export type LockState = { locked: boolean; until: Date | null }

/**
 * 키 중 **하나라도** 잠겨 있으면 잠긴 것으로 본다.
 * 반환된 `until` 은 감사·로깅용이다 — 사용자에게 노출하면 그 자체가 계정 존재 신호다 (06 §6).
 */
export async function checkLock(keys: readonly string[]): Promise<LockState> {
  if (keys.length === 0) return { locked: false, until: null }

  const rows = await db
    .select({ lockedUntil: loginAttempts.lockedUntil })
    .from(loginAttempts)
    .where(and(inArray(loginAttempts.key, [...keys]), gt(loginAttempts.lockedUntil, sql`now()`)))

  let until: Date | null = null
  for (const row of rows) {
    if (row.lockedUntil && (!until || row.lockedUntil > until)) until = row.lockedUntil
  }
  return { locked: rows.length > 0, until }
}

/**
 * 실패 1회 기록 + 잠금 재계산을 **한 문장**으로 처리한다 (키마다 원자적).
 *
 * CTE 로 쪼개지 않은 이유: 같은 문장 안의 두 하위 문장은 서로의 변경을 보지 못해서,
 * INSERT 로 방금 만든 행을 뒤따르는 UPDATE 가 조용히 건너뛴다.
 */
export async function registerFailure(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return

  const windowExpired = sql`(${loginAttempts.firstFailAt} is null or ${loginAttempts.firstFailAt} < now() - ${intervalSecs(COUNTER_WINDOW_SEC)})`
  const nextCount = sql`(case when ${windowExpired} then 1 else ${loginAttempts.failCount} + 1 end)`

  const whens = BACKOFF.map(
    (step) =>
      sql`when ${nextCount} >= ${sql.raw(String(step.atLeast))} then now() + ${intervalSecs(step.lockSec)}`
  )
  const nextLockedUntil = sql`case ${sql.join(whens, sql` `)} else null end`

  await db
    .insert(loginAttempts)
    .values(
      keys.map((key) => ({
        key,
        failCount: 1,
        firstFailAt: sql`now()`,
        lastFailAt: sql`now()`,
        lockedUntil: null,
      }))
    )
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        failCount: nextCount,
        firstFailAt: sql`case when ${windowExpired} then now() else ${loginAttempts.firstFailAt} end`,
        lastFailAt: sql`now()`,
        lockedUntil: nextLockedUntil,
      },
    })
}

/**
 * 로그인 성공 시 카운터 리셋 (06 §6).
 * 0 으로 UPDATE 하지 않고 행을 지운다 — 리셋과 정리를 한 번에 끝낸다.
 */
export async function clearFailures(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  await db.delete(loginAttempts).where(inArray(loginAttempts.key, [...keys]))
}

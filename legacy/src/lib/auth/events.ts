import 'server-only'

import { db } from '@/lib/db'
import { authEvents } from '@/lib/db/schema'

/** `icaros.auth_events.kind` CHECK 제약과 1:1 로 대응한다. 값을 늘리려면 마이그레이션이 먼저다. */
export type AuthEventKind =
  | 'login_success'
  | 'login_fail'
  | 'logout'
  | 'session_expired'
  | 'password_changed'
  | 'admin_deactivated'
  | 'rate_limited'
  | 'bootstrap'

/** jsonb 에 임의 객체를 넣지 못하게 스칼라로 제한한다 — 에러 객체 통째 저장이 자격증명이 새는 흔한 경로다 (06 §10). */
export type AuthEventDetail = Record<string, string | number | boolean | null>

export type AuthEventInput = {
  kind: AuthEventKind
  emailAttempted?: string | null
  userId?: string | null
  ip?: string | null
  userAgent?: string | null
  detail?: AuthEventDetail
}

/** 이름만 봐도 넣으면 안 되는 것들. 호출부 실수를 저장 직전에 한 번 더 막는다. */
const FORBIDDEN_DETAIL_KEY = /pass|pwd|token|hash|secret|cookie|authorization|credential|session/i

function scrubDetail(detail: AuthEventDetail): AuthEventDetail {
  const out: AuthEventDetail = {}
  for (const [key, value] of Object.entries(detail)) {
    if (FORBIDDEN_DETAIL_KEY.test(key)) continue
    out[key] = typeof value === 'string' ? value.slice(0, 200) : value
  }
  return out
}

/**
 * 감사 로그 (H14).
 *
 * **절대 throw 하지 않는다.** 감사 기록 실패로 로그인·로그아웃이 500 이 되면
 * auth_events 테이블 하나가 서비스 전체의 단일 장애점이 된다.
 * 대신 고정 문자열만 남긴다 — 에러 객체를 그대로 찍으면 §10 규칙을 우리가 어기게 된다.
 */
export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  try {
    await db.insert(authEvents).values({
      kind: input.kind,
      emailAttempted: input.emailAttempted ?? null,
      userId: input.userId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      detail: input.detail ? scrubDetail(input.detail) : null,
    })
  } catch {
    console.error(`[auth] auth_events 기록 실패 (kind=${input.kind})`)
  }
}

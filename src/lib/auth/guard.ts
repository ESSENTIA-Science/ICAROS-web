import 'server-only'

import { headers } from 'next/headers'
import { resolveSession, type AdminSession } from './session'

export type AuthErrorCode = 'bad_origin' | 'unauthenticated'

/** 호출부가 코드로 분기할 수 있게 하되, 메시지는 사용자에게 그대로 보여주지 않는다. */
export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode) {
    super(`auth: ${code}`)
    this.name = 'AuthError'
    this.code = code
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}

function normalizeOrigin(value: string): string | null {
  try {
    // sandbox iframe 이 보내는 리터럴 "null" 은 URL 파싱에 실패해 여기서 걸린다.
    return new URL(value).origin.toLowerCase()
  } catch {
    return null
  }
}

/** 프록시 헤더는 콤마로 여러 값이 올 수 있다. 가장 앞(= 가장 바깥 프록시)만 쓴다. */
function firstHeaderValue(raw: string | null): string | null {
  if (!raw) return null
  const first = raw.split(',')[0]?.trim()
  return first && first.length > 0 ? first : null
}

/**
 * 허용 Origin 집합 (06 §5).
 *
 * 1. `ADMIN_ALLOWED_ORIGINS` — 콤마 구분. 커스텀 프록시·고정 프리뷰 별칭용 (DECISIONS D6).
 * 2. 요청 자신의 Origin — `x-forwarded-host` 기반. Vercel 이 이 헤더를 직접 세팅하므로
 *    사실상 "Origin === Host" 검사이고, Next 의 Server Actions 내장 방어와 같은 판정을
 *    **Route Handler 에도** 적용하기 위한 것이다. 내장 방어는 Route Handler 에 걸리지 않는다.
 */
async function allowedOrigins(h: Headers): Promise<ReadonlySet<string>> {
  const set = new Set<string>()

  for (const raw of (process.env.ADMIN_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const normalized = normalizeOrigin(trimmed)
    if (normalized) set.add(normalized)
  }

  const host = firstHeaderValue(h.get('x-forwarded-host')) ?? firstHeaderValue(h.get('host'))
  if (host) {
    const proto = firstHeaderValue(h.get('x-forwarded-proto')) ?? 'https'
    const self = normalizeOrigin(`${proto}://${host}`)
    if (self) set.add(self)
  }

  return set
}

/**
 * mutation 전용 Origin 검증. 브라우저는 cross-origin 이 아닌 POST 에도 Origin 을 붙이므로
 * **Origin 이 없으면 거부**한다. 구형 브라우저 예외를 두면 그 예외가 곧 우회로가 된다.
 */
export async function assertTrustedOrigin(): Promise<void> {
  const h = await headers()
  const origin = normalizeOrigin(h.get('origin') ?? '')
  if (!origin) throw new AuthError('bad_origin')
  if (!(await allowedOrigins(h)).has(origin)) throw new AuthError('bad_origin')
}

/**
 * **모든 mutation 이 통과하는 단일 게이트** (06 §5, H11·H12).
 * Server Action 이든 Route Handler 든 예외 없이 여기를 지난다.
 */
export async function requireAdmin(): Promise<AdminSession> {
  await assertTrustedOrigin()
  const session = await resolveSession()
  if (!session) throw new AuthError('unauthenticated')
  return session
}

/**
 * 읽기 전용 게이트. 페이지 렌더·GET Route Handler 처럼 Origin 헤더가 없는 경로용이다.
 * **쓰기 경로에서 쓰지 말 것** — CSRF 방어가 빠진다.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  return resolveSession()
}

export type RequestMeta = { ip: string | null; userAgent: string | null }

/** IP 는 rate limit 키가 되므로 형태를 검사하고 길이를 자른다 — 임의 문자열이 키 공간을 오염시키지 않게. */
const IP_SHAPE = /^[0-9a-fA-F.:]{3,45}$/

/**
 * 감사 로그·rate limit 용 요청 메타데이터.
 * Vercel 은 `x-forwarded-for` 를 플랫폼이 덮어쓰므로 클라이언트가 위조할 수 없다.
 * 그 앞단에 다른 프록시를 두게 되면 이 가정을 다시 확인해야 한다.
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers()
  const candidate = firstHeaderValue(h.get('x-forwarded-for')) ?? firstHeaderValue(h.get('x-real-ip'))
  const ip = candidate && IP_SHAPE.test(candidate) ? candidate : null
  const userAgent = h.get('user-agent')?.slice(0, 512) ?? null
  return { ip, userAgent }
}

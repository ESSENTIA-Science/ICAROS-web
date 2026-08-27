import 'server-only'

import { headers } from 'next/headers'
import { firstHeaderValue } from './request'
import { resolveSession, type AdminSession } from './session'

// 호출부 호환을 위해 그대로 재노출한다. 구현은 순환 import 회피 목적으로 `request.ts` 에 있다.
export { getRequestMeta, type RequestMeta } from './request'

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

/**
 * 허용목록 항목을 오리진으로 정규화한다.
 *
 * `ADMIN_ALLOWED_ORIGINS` 는 두 곳이 읽는다 — 여기, 그리고 `next.config.ts` 의
 * `serverActions.allowedOrigins`. 그런데 Next 는 **호스트 목록**을 요구해서 config 쪽이
 * 스킴을 떼어내고 기본값도 스킴 없는 `icaros.kr,www.icaros.kr` 이다.
 * 여기서 `new URL()` 만 쓰면 그 형식이 전부 파싱 실패해 **관리 콘솔이 전면 잠긴다**
 * (fail-closed 라 조용히 403 만 난다). 운영자가 config 기본값을 env 로 복사하는 것은
 * 가장 자연스러운 행동이므로, 스킴이 없으면 붙여서 받아 준다.
 *
 * localhost / 127.0.0.1 만 http 를 허용한다 — 그 외에 http 를 허용하면
 * 평문 오리진이 관리자 mutation 을 부를 수 있게 된다.
 */
function parseAllowlistEntry(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return normalizeOrigin(v)

  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(v)
  return normalizeOrigin(`${isLoopback ? 'http' : 'https'}://${v}`)
}

/** 폴백·설정오류 경고는 프로세스당 한 번만. 요청마다 찍으면 로그에서 의미를 잃는다. */
let warnedNoAllowlist = false
let warnedBadAllowlist = false
let warnedDroppedAllowlist = false

/**
 * `ADMIN_ALLOWED_ORIGINS` 파싱. 반환값은 "선언 여부"와 "파싱 결과"를 분리한다 —
 * 선언은 했는데 하나도 파싱되지 않은 경우를 미설정과 같이 취급하면 안 되기 때문이다.
 */
function configuredOrigins(): { declared: boolean; origins: Set<string>; dropped: string[] } {
  const origins = new Set<string>()
  const dropped: string[] = []
  let declared = false

  for (const raw of (process.env.ADMIN_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    declared = true
    const normalized = parseAllowlistEntry(trimmed)
    if (normalized) origins.add(normalized)
    else dropped.push(trimmed)
  }

  return { declared, origins, dropped }
}

/**
 * 허용 Origin 집합 (06 §5).
 *
 * `ADMIN_ALLOWED_ORIGINS` 가 설정돼 있으면 **그 목록만** 쓴다.
 * 예전에는 여기에 self-origin(`x-forwarded-host`+`x-forwarded-proto` 로 조립)을 항상 합집합으로
 * 더했는데, 그러면 검증의 의미가 "Origin === 요청이 스스로 주장한 Host" 로 축소된다.
 * 실제로 `Origin: https://evil.com` + `x-forwarded-host: evil.com` 조합이 그대로 통과했다.
 * 그 상태의 안전은 코드가 아니라 "앞단 프록시가 이 헤더를 덮어쓴다"는 배포 토폴로지에 있다 —
 * 화이트리스트가 있으면 화이트리스트가 이긴다.
 *
 * 미설정일 때만 self-origin 폴백을 쓴다. 이건 로컬·초기 프리뷰 편의일 뿐 방어가 아니므로 경고를 남긴다.
 * 선언은 됐는데 전부 파싱 실패면 **빈 집합을 돌려 전부 거부한다** — 조용히 폴백으로 내려가면
 * 설정 오타가 곧 방어 해제가 된다.
 */
function allowedOrigins(h: Headers): ReadonlySet<string> {
  const { declared, origins, dropped } = configuredOrigins()

  // 부분 실패는 전부 실패보다 위험하다 — 유효 항목이 남아 있으면 앱은 정상으로 보이는데
  // 드롭된 도메인만 전건 403 이 되고 로그에 단서가 없다.
  // 현실적인 오타가 `https://icaros.kr,www.icaros.kr` 처럼 한 항목만 스킴을 빠뜨리는 것이다.
  if (dropped.length > 0 && !warnedDroppedAllowlist) {
    warnedDroppedAllowlist = true
    console.warn(
      `[auth] ADMIN_ALLOWED_ORIGINS 중 ${dropped.length}개 항목을 해석하지 못해 무시합니다: ${dropped.join(', ')}`
    )
  }

  if (declared) {
    if (origins.size === 0 && !warnedBadAllowlist) {
      warnedBadAllowlist = true
      console.error(
        '[auth] ADMIN_ALLOWED_ORIGINS 를 하나도 해석하지 못했습니다 — 모든 mutation 이 거부됩니다. ' +
          '형식: 콤마 구분, 스킴 포함 절대 URL (예: https://icaros.kr,https://www.icaros.kr)'
      )
    }
    return origins
  }

  if (!warnedNoAllowlist) {
    warnedNoAllowlist = true
    console.warn(
      '[auth] ADMIN_ALLOWED_ORIGINS 미설정 — Origin 검증이 요청이 주장한 Host 와의 대조로 축소됩니다. ' +
        '배포 환경에서는 반드시 설정하십시오.'
    )
  }

  const fallback = new Set<string>()
  const host = firstHeaderValue(h.get('x-forwarded-host')) ?? firstHeaderValue(h.get('host'))
  if (host) {
    const proto = firstHeaderValue(h.get('x-forwarded-proto')) ?? 'https'
    const self = normalizeOrigin(`${proto}://${host}`)
    if (self) fallback.add(self)
  }
  return fallback
}

/**
 * mutation 전용 Origin 검증. 브라우저는 cross-origin 이 아닌 POST 에도 Origin 을 붙이므로
 * **Origin 이 없으면 거부**한다. 구형 브라우저 예외를 두면 그 예외가 곧 우회로가 된다.
 */
export async function assertTrustedOrigin(): Promise<void> {
  const h = await headers()
  const origin = normalizeOrigin(h.get('origin') ?? '')
  if (!origin) throw new AuthError('bad_origin')
  if (!allowedOrigins(h).has(origin)) throw new AuthError('bad_origin')
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

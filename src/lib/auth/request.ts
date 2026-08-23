import 'server-only'

import { headers } from 'next/headers'

/** 프록시 헤더는 콤마로 여러 값이 올 수 있다. 가장 앞(= 가장 바깥 프록시)만 쓴다. */
export function firstHeaderValue(raw: string | null): string | null {
  if (!raw) return null
  const first = raw.split(',')[0]?.trim()
  return first && first.length > 0 ? first : null
}

export type RequestMeta = { ip: string | null; userAgent: string | null }

/** IP 는 rate limit 키가 되므로 형태를 검사하고 길이를 자른다 — 임의 문자열이 키 공간을 오염시키지 않게. */
const IP_SHAPE = /^[0-9a-fA-F.:]{3,45}$/

/**
 * 감사 로그·rate limit 용 요청 메타데이터.
 * Vercel 은 `x-forwarded-for` 를 플랫폼이 덮어쓰므로 클라이언트가 위조할 수 없다.
 * 그 앞단에 다른 프록시를 두게 되면 이 가정을 다시 확인해야 한다.
 *
 * `guard.ts` 가 아니라 별도 모듈에 두는 이유: `session.ts` 도 만료 이벤트를 남기려면 이게 필요한데,
 * `guard.ts` 는 `session.ts` 를 import 하므로 여기 두지 않으면 순환 import 가 된다.
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers()
  const candidate = firstHeaderValue(h.get('x-forwarded-for')) ?? firstHeaderValue(h.get('x-real-ip'))
  const ip = candidate && IP_SHAPE.test(candidate) ? candidate : null
  const userAgent = h.get('user-agent')?.slice(0, 512) ?? null
  return { ip, userAgent }
}

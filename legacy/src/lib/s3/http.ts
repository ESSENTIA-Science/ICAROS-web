import 'server-only'

import { isAuthError } from '@/lib/auth/guard'
import type { ApiErrorBody } from '@/lib/image/contract'
import { StorageError, describeError } from './errors'

export function json<T>(body: T, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers })
}

/**
 * 에러를 응답으로 정규화한다. **AWS SDK 에러를 그대로 내보내지 않는다** —
 * 메시지에 버킷 이름이나 서명 URL 이 섞여 나올 수 있다 (06 §10).
 */
export function toErrorResponse(err: unknown): Response {
  // 인증 실패가 먼저다. AuthError 의 메시지("auth: bad_origin")는 내부용이라 그대로 내보내지 않는다.
  if (isAuthError(err)) {
    const body: ApiErrorBody = { error: '권한이 없습니다.', code: err.code }
    return json(body, err.code === 'bad_origin' ? 403 : 401)
  }

  if (err instanceof StorageError) {
    if (err.code === 'config_missing' || err.code === 'upstream') {
      // 환경변수 이름·버킷 같은 내부 사정은 서버 로그에만 남긴다.
      console.error('[storage]', describeError(err))
      const body: ApiErrorBody = { error: '스토리지를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', code: err.code }
      return json(body, err.status)
    }
    const body: ApiErrorBody = { error: err.message, code: err.code }
    return json(body, err.status)
  }

  console.error('[storage]', describeError(err))
  const body: ApiErrorBody = { error: '요청을 처리하지 못했습니다.' }
  return json(body, 500)
}

/**
 * JSON 본문만 받는다.
 * `application/json` 강제는 CSRF 완화도 겸한다 — 폼 기반 simple request 로는 이 헤더를 못 붙인다.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    throw new StorageError('invalid_request', 'JSON 요청만 처리합니다.')
  }
  try {
    return (await req.json()) as unknown
  } catch {
    throw new StorageError('invalid_request', '요청 본문을 해석할 수 없습니다.')
  }
}

/**
 * 원본 파일명을 Content-Disposition 으로만 노출한다 (07 §4).
 * 비-ASCII 는 RFC 5987 `filename*` 로, 구형 클라이언트용 ASCII 대체본을 함께 준다.
 */
export function contentDisposition(filename: string | null, download: boolean): string {
  const type = download ? 'attachment' : 'inline'
  if (!filename) return type
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

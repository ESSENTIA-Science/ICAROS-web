import 'server-only'

/**
 * 스토리지 계층이 던지는 유일한 에러 타입.
 * 라우트가 `instanceof` 하나로 상태코드를 정할 수 있어야 AWS SDK 에러가 그대로 새어 나가지 않는다.
 */
export type StorageErrorCode =
  | 'config_missing' // S3_BUCKET 미설정 등 서버 구성 문제
  | 'invalid_request' // 클라이언트 입력 문제
  | 'not_found' // media 행이 없다
  | 'object_missing' // 행은 있는데 S3 에 객체가 없다 (업로드 중단)
  | 'too_large'
  | 'wrong_type'
  | 'in_use' // 아직 entity 가 참조 중이다
  | 'conflict' // 상태가 기대와 다르다
  | 'forbidden_key' // ICAROS 프리픽스 밖
  | 'upstream' // S3 호출 자체가 실패

const STATUS_BY_CODE: Readonly<Record<StorageErrorCode, number>> = {
  config_missing: 503,
  invalid_request: 400,
  not_found: 404,
  object_missing: 409,
  too_large: 413,
  wrong_type: 415,
  in_use: 409,
  conflict: 409,
  forbidden_key: 403,
  upstream: 502,
}

export class StorageError extends Error {
  readonly code: StorageErrorCode
  readonly status: number

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
  }
}

/**
 * 서명 쿼리스트링을 로그에서 지운다.
 * AWS SDK 에러 메시지·스택에 presigned URL 이 통째로 들어오는 경우가 있고,
 * 그 URL 은 유효기간 동안 그 자체로 자격증명이다 (06 §10 — 에러 객체 통째 로깅 금지).
 */
export function redact(text: string): string {
  return text.replace(/X-Amz-(Signature|Credential|Security-Token)=[^&\s"']+/gi, 'X-Amz-$1=REDACTED')
}

/** 로깅·DB 적재용으로 에러를 정규화한다. 원본 객체는 절대 그대로 흘리지 않는다. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return redact(`${err.name}: ${err.message}`).slice(0, 500)
  if (typeof err === 'string') return redact(err).slice(0, 500)
  return 'unknown error'
}

/** AWS SDK 에러에서 HTTP 상태코드를 꺼낸다. `any` 없이 좁힌다. */
export function awsStatusCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('$metadata' in err)) return undefined
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
  return typeof meta?.httpStatusCode === 'number' ? meta.httpStatusCode : undefined
}

/** 객체가 없음을 뜻하는 응답인가. HeadObject 는 `NotFound`, GetObject 는 `NoSuchKey` 를 준다. */
export function isNotFoundError(err: unknown): boolean {
  if (awsStatusCode(err) === 404) return true
  return err instanceof Error && (err.name === 'NotFound' || err.name === 'NoSuchKey')
}

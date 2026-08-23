/**
 * 브라우저 업로드 오케스트레이션: 전처리 → presign → S3 직접 PUT → confirm.
 * 관리 UI 는 `uploadFile()` 하나만 부르면 된다.
 *
 * 브라우저 전용이다 (fetch + File API).
 */

import type { ApiErrorBody, ConfirmRequest, ConfirmResponse, PresignRequest, PresignResponse } from './contract'
import { prepareUpload } from './encode'
import type { MediaEntityType, UploadKind } from './policy'

export class UploadError extends Error {
  readonly step: 'presign' | 'put' | 'confirm'

  constructor(step: UploadError['step'], message: string) {
    super(message)
    this.name = 'UploadError'
    this.step = step
  }
}

export interface UploadOptions {
  kind: UploadKind
  entityType?: MediaEntityType
  entityId?: string
  signal?: AbortSignal
}

export interface UploadResult {
  mediaId: string
  /** `next/image` 의 `src` 로 그대로 쓰는 안정적 URL. */
  url: string
  size: number
  width: number | null
  height: number | null
}

export async function uploadFile(file: File, options: UploadOptions): Promise<UploadResult> {
  const prepared = await prepareUpload(file, options.kind)

  const presignBody: PresignRequest = {
    kind: options.kind,
    contentType: prepared.contentType,
    size: prepared.blob.size,
    originalFilename: file.name,
    ...(prepared.width !== null ? { width: prepared.width } : {}),
    ...(prepared.height !== null ? { height: prepared.height } : {}),
    ...(options.entityType ? { entityType: options.entityType } : {}),
    ...(options.entityId ? { entityId: options.entityId } : {}),
  }

  const presign = await postJson<PresignResponse>('/api/upload/presign', presignBody, options.signal, 'presign')

  // presigned URL 에는 **서명된 헤더만** 붙인다. 하나라도 더 붙으면 S3 가 403 을 준다.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    body: prepared.blob,
    headers: presign.headers,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!put.ok) {
    throw new UploadError('put', `파일 전송에 실패했습니다. (${put.status})`)
  }

  const confirmBody: ConfirmRequest = {
    mediaId: presign.mediaId,
    ...(prepared.width !== null ? { width: prepared.width } : {}),
    ...(prepared.height !== null ? { height: prepared.height } : {}),
  }
  const confirmed = await postJson<ConfirmResponse>('/api/upload/confirm', confirmBody, options.signal, 'confirm')

  return {
    mediaId: confirmed.id,
    url: confirmed.url,
    size: confirmed.size,
    width: confirmed.width,
    height: confirmed.height,
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
  step: UploadError['step']
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // 세션 쿠키가 필요하다. 같은 오리진이라 Origin 헤더도 함께 붙는다 (서버가 CSRF 로 본다).
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  })

  if (!res.ok) {
    throw new UploadError(step, await readErrorMessage(res))
  }
  return (await res.json()) as T
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorBody
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
  } catch {
    // 본문이 JSON 이 아니면 상태코드만 쓴다.
  }
  return `요청에 실패했습니다. (${res.status})`
}

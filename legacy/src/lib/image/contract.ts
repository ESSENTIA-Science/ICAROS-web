/**
 * `/api/upload/*` 의 요청·응답 형태. 브라우저와 라우트가 같은 타입을 본다.
 * 순수 타입만 둔다 — 런타임 검증은 서버가 zod 로 따로 한다 (클라이언트 타입을 신뢰하지 않는다).
 */

import type { MediaEntityType, UploadKind } from './policy'

export interface PresignRequest {
  kind: UploadKind
  /** 전처리가 끝난 산출물의 MIME. 서버는 kind 의 정책 MIME 과 정확히 일치할 때만 서명한다. */
  contentType: string
  /** 전처리가 끝난 산출물의 바이트 수. `/confirm` 이 실측값의 상한으로 다시 쓴다. */
  size: number
  originalFilename?: string
  width?: number
  height?: number
  entityType?: MediaEntityType
  entityId?: string
}

export interface PresignResponse {
  mediaId: string
  key: string
  uploadUrl: string
  method: 'PUT'
  /** 이 헤더만 붙여서 PUT 한다. 하나라도 더 붙이면 서명이 깨진다. */
  headers: Record<string, string>
  expiresInSeconds: number
}

export interface ConfirmRequest {
  mediaId: string
  width?: number
  height?: number
}

export interface ConfirmResponse {
  id: string
  /** 화면에서 쓰는 안정적 URL. presigned URL 을 직접 쓰지 않는다 (D3). */
  url: string
  size: number
  mime: string
  width: number | null
  height: number | null
}

export interface ApiErrorBody {
  error: string
  code?: string
}

/** `/api/media/{id}` 경로를 만드는 유일한 지점. 문자열을 여기저기 조립하지 않는다. */
export function mediaUrl(mediaId: string, options?: { download?: boolean }): string {
  return options?.download ? `/api/media/${mediaId}?download=1` : `/api/media/${mediaId}`
}

import 'server-only'

import { z } from 'zod'
import {
  MEDIA_ENTITY_TYPES,
  UPLOAD_KINDS,
  checkUploadCandidate,
  sanitizeOriginalFilename,
  type MediaEntityType,
  type UploadKind,
} from '@/lib/image/policy'
import { StorageError } from './errors'

/**
 * 형태 검증은 zod 로, **정책 판정은 `checkUploadCandidate` 로** 한다.
 * 정책을 여기에 다시 적으면 브라우저 전처리와 서버 검증이 갈라진다 — 정책은 한 곳에만 있다.
 */
const presignSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  contentType: z.string().min(1).max(128),
  size: z.number().int().positive(),
  originalFilename: z.string().max(255).optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  entityType: z.enum(MEDIA_ENTITY_TYPES).optional(),
  entityId: z.string().min(1).max(128).optional(),
})

const confirmSchema = z.object({
  mediaId: z.string().uuid(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
})

export interface ParsedPresign {
  kind: UploadKind
  contentType: string
  size: number
  originalFilename: string | null
  width: number | null
  height: number | null
  entityType: MediaEntityType | null
  entityId: string | null
}

export function parsePresignRequest(input: unknown): ParsedPresign {
  const parsed = presignSchema.safeParse(input)
  if (!parsed.success) {
    throw new StorageError('invalid_request', parsed.error.issues[0]?.message ?? '요청 형식이 올바르지 않습니다.')
  }
  const value = parsed.data

  const verdict = checkUploadCandidate({
    kind: value.kind,
    mime: value.contentType,
    size: value.size,
    filename: value.originalFilename,
  })
  if (!verdict.ok) {
    // 크기·형식 위반은 각각 413/415 로 구분해서 돌려준다. 클라이언트가 재시도 가능 여부를 판단한다.
    const code = verdict.code === 'too_large' ? 'too_large' : verdict.code === 'empty' ? 'invalid_request' : 'wrong_type'
    throw new StorageError(code, verdict.message)
  }

  return {
    kind: value.kind,
    contentType: value.contentType.trim().toLowerCase(),
    size: value.size,
    originalFilename: value.originalFilename ? sanitizeOriginalFilename(value.originalFilename) : null,
    width: value.width ?? null,
    height: value.height ?? null,
    entityType: value.entityType ?? null,
    entityId: value.entityId ?? null,
  }
}

export interface ParsedConfirm {
  mediaId: string
  width: number | null
  height: number | null
}

export function parseConfirmRequest(input: unknown): ParsedConfirm {
  const parsed = confirmSchema.safeParse(input)
  if (!parsed.success) {
    throw new StorageError('invalid_request', parsed.error.issues[0]?.message ?? '요청 형식이 올바르지 않습니다.')
  }
  return {
    mediaId: parsed.data.mediaId,
    width: parsed.data.width ?? null,
    height: parsed.data.height ?? null,
  }
}

import 'server-only'

import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { media } from '@/lib/db/schema'
import {
  MAX_BYTES_BY_FOLDER,
  UPLOAD_POLICIES,
  formatBytes,
  type MediaEntityType,
  type UploadKind,
} from '@/lib/image/policy'
import { getS3Config } from './config'
import { StorageError, describeError } from './errors'
import { assertKeyWritable, buildObjectKey, folderOfKey } from './keys'
import { deleteObject, headObject } from './objects'
import { presignPut } from './presign'
import { enqueueCleanup } from './cleanup'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export interface CreateUploadInput {
  kind: UploadKind
  contentType: string
  /** 클라이언트가 선언한 크기. `/confirm` 이 실측값의 **상한**으로 다시 쓴다. */
  declaredSize: number
  originalFilename?: string | null | undefined
  width?: number | null | undefined
  height?: number | null | undefined
  entityType?: MediaEntityType | null | undefined
  entityId?: string | null | undefined
}

export interface CreateUploadResult {
  mediaId: string
  key: string
  uploadUrl: string
  contentType: string
}

/**
 * 07 §5 의 순서 그대로: ① `icaros.media` 행을 `pending` 으로 먼저 만들고 ② 그 다음 서명한다.
 * 반대로 하면 서명은 나갔는데 추적할 행이 없는 객체가 생긴다 — 고아를 만들 수 있는 유일한 순서다.
 */
export async function createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
  const { bucket } = getS3Config()
  const policy = UPLOAD_POLICIES[input.kind]
  const key = buildObjectKey(input.kind)

  const inserted = await db
    .insert(media)
    .values({
      bucket,
      key,
      mime: policy.mime,
      size: input.declaredSize,
      originalFilename: input.originalFilename ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      status: 'pending',
    })
    .returning({ id: media.id })

  const row = inserted[0]
  if (!row) throw new StorageError('conflict', '업로드 기록을 만들지 못했습니다.')

  const uploadUrl = await presignPut(key, policy.mime)
  return { mediaId: row.id, key, uploadUrl, contentType: policy.mime }
}

export interface ConfirmResult {
  id: string
  size: number
  mime: string
  width: number | null
  height: number | null
}

/**
 * 업로드 완료 검증 (요구사항 I8). HeadObject 로 **실재·크기·타입**을 서버가 직접 본다.
 * 위반이면 그 자리에서 객체를 지운다 — presigned PUT 은 크기를 서명에 박을 수 없으므로(D12)
 * 여기가 크기 상한을 담보하는 유일한 지점이다.
 */
export async function confirmUpload(
  mediaId: string,
  dimensions?: { width?: number | null | undefined; height?: number | null | undefined }
): Promise<ConfirmResult> {
  if (!isUuid(mediaId)) throw new StorageError('invalid_request', '잘못된 업로드 식별자입니다.')

  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), isNull(media.deletedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) throw new StorageError('not_found', '업로드 기록을 찾을 수 없습니다.')
  if (row.status === 'ready') throw new StorageError('conflict', '이미 확정된 업로드입니다.')
  if (row.status !== 'pending') throw new StorageError('conflict', '확정할 수 없는 상태의 업로드입니다.')

  assertKeyWritable(row.key)

  const head = await headObject(row.key)
  if (!head) {
    await markFailed(mediaId)
    throw new StorageError('object_missing', '업로드된 파일을 찾을 수 없습니다. 다시 시도해 주세요.')
  }

  // 폴더별 절대 상한 ∩ presign 때 선언한 크기.
  // media 행에 kind 컬럼이 없어 폴더만으로는 `media`(1MB)와 `hero`(2MB)를 구분할 수 없는데,
  // 선언 크기는 presign 단계에서 이미 kind 상한 이하임을 검증했으므로 둘의 교집합이 곧 kind 상한이다.
  const folder = folderOfKey(row.key)
  const folderMax = folder ? MAX_BYTES_BY_FOLDER[folder] : 0
  const declaredMax = row.size ?? folderMax
  const limit = Math.min(folderMax, declaredMax)

  if (head.size > limit) {
    await discardObject(row.bucket, row.key, mediaId)
    throw new StorageError('too_large', `${formatBytes(limit)} 이하만 업로드할 수 있습니다.`)
  }

  // content-type 은 서명에 포함돼 있어 S3 가 이미 강제하지만, 실제 저장된 값으로 한 번 더 확인한다.
  const storedType = head.contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (storedType !== row.mime) {
    await discardObject(row.bucket, row.key, mediaId)
    throw new StorageError('wrong_type', '허용되지 않은 파일 형식입니다.')
  }

  // 폭·높이는 서버가 디코딩하지 않는다(이미지 라이브러리 미도입). 클라이언트 신고값을 그대로 받되
  // 레이아웃 힌트로만 쓴다 — 보안 판단에는 쓰이지 않는다.
  const width = dimensions?.width ?? row.width ?? null
  const height = dimensions?.height ?? row.height ?? null

  const updated = await db
    .update(media)
    .set({ status: 'ready', size: head.size, etag: head.etag, width, height })
    .where(and(eq(media.id, mediaId), eq(media.status, 'pending')))
    .returning({ id: media.id })

  if (!updated[0]) throw new StorageError('conflict', '업로드 확정 중 상태가 바뀌었습니다.')

  return { id: mediaId, size: head.size, mime: row.mime, width, height }
}

export interface ServableMedia {
  readonly id: string
  readonly key: string
  readonly mime: string
  readonly originalFilename: string | null
}

/** `/api/media/{id}` 가 서빙해도 되는 행인가. `ready` + 미삭제만 통과한다. */
export async function getServableMedia(mediaId: string): Promise<ServableMedia | null> {
  if (!isUuid(mediaId)) return null

  const rows = await db
    .select({
      id: media.id,
      key: media.key,
      mime: media.mime,
      originalFilename: media.originalFilename,
    })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.status, 'ready'), isNull(media.deletedAt)))
    .limit(1)

  return rows[0] ?? null
}

async function markFailed(mediaId: string): Promise<void> {
  await db.update(media).set({ status: 'failed' }).where(eq(media.id, mediaId))
}

/**
 * 검증에 실패한 업로드를 회수한다. 삭제가 실패하면 예외를 삼키지 않고 cleanup 큐에 적재한다 (07 §6).
 * 여기서 다시 던지면 클라이언트는 "너무 큽니다" 대신 500 을 보게 되므로, 호출부가 원래 던지려던
 * 검증 에러를 유지할 수 있게 이 함수는 던지지 않는다.
 */
async function discardObject(bucket: string, key: string, mediaId: string): Promise<void> {
  try {
    await deleteObject(key)
  } catch (err) {
    await enqueueCleanup(bucket, key, describeError(err))
  }
  await markFailed(mediaId)
}

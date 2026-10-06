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
import { deleteObject, getObjectPrefix, headObject } from './objects'
import { SNIFF_BYTES, isUuid, sniffMime } from './predicates'
import { presignPut } from './presign'
import { enqueueCleanup } from './cleanup'

export { isUuid }

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

  // 여기서만 미리 본다: 아래 S3 호출들은 읽기 범위(`forum/` 포함)만 요구하는데,
  // 확정은 우리가 쓰고 지울 수 있는 키에만 해야 한다. 버킷 대조는 각 S3 호출이 한다.
  assertKeyWritable(row.key)

  const head = await headObject(row.bucket, row.key)
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

  // **선언값이 아니라 내용을 본다** (요구사항 I5).
  // S3 에 저장된 Content-Type 은 업로더가 서명 요청에 넣은 값 그대로라, 그것과 `row.mime` 을
  // 비교하면 같은 값끼리 비교하는 셈이라 아무것도 걸러 내지 못한다.
  // 객체가 ≤8MB 라 전체를 받아도 되지만 판정에 필요한 건 선두 몇 바이트뿐이다.
  const prefix = await getObjectPrefix(row.bucket, row.key, SNIFF_BYTES)
  if (prefix === null) {
    await markFailed(mediaId)
    throw new StorageError('object_missing', '업로드된 파일을 찾을 수 없습니다. 다시 시도해 주세요.')
  }
  if (sniffMime(prefix) !== row.mime) {
    await discardObject(row.bucket, row.key, mediaId)
    throw new StorageError('wrong_type', '파일 내용이 허용된 형식이 아닙니다.')
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
  readonly bucket: string
  readonly key: string
  /** 서빙 Content-Type 의 authority. S3 메타데이터가 아니라 이 값을 내보낸다. */
  readonly mime: string
  readonly originalFilename: string | null
  /** 조건부 요청(`If-None-Match`)을 S3 왕복 없이 끝내기 위해 함께 읽는다. */
  readonly etag: string | null
  /** 캐시 정책 분기용. 접근 통제가 필요한 종류인지 판정한다 (I17). */
  readonly entityType: string | null
}

/**
 * 공유 캐시에 올려도 되는 entity 종류 — **허용 목록**이고 이 파일이 유일한 원본이다.
 *
 * 두 곳이 이 집합을 본다: `/api/media/[id]` 가 캐시 헤더를 고를 때, 그리고 아래 메모리 캐시가
 * 적격을 판정할 때. **한 벌로 두는 이유가 그것이다** — 두 벌이면 한쪽만 넓혔을 때
 * 접근 통제가 필요한 미디어가 조용히 캐시에 남는다.
 *
 * 차단 목록으로 뒤집지 말 것. 그러면 나중에 추가되는 종류가 **기본적으로** 공개 캐시에 올라간다.
 * `member` 가 여기 없는 이유는 멤버 사진이 미성년자 얼굴이기 때문이고(요구사항 I17),
 * `entity_type` 이 null 인 행은 용도를 모르므로 같은 쪽으로 닫는다.
 */
export const CACHEABLE_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'rocket',
  'landing',
  'model',
  'poster',
  // 레거시 게시글 이미지. 공개 기록이고 키가 UUID 라 내용이 바뀌지 않는다.
  // `member` 가 여전히 빠져 있는 것과 대비된다 — 그쪽은 미성년자 얼굴이다.
  'post',
])

/** 이 미디어를 공유 캐시·메모리 캐시에 올려도 되는가. 두 판정의 유일한 기준이다. */
export function isCacheableEntityType(entityType: string | null): boolean {
  return entityType !== null && CACHEABLE_ENTITY_TYPES.has(entityType)
}

/**
 * 인스턴스 로컬 메타데이터 캐시 (DECISIONS D26).
 *
 * ## 왜 필요한가
 *
 * 랜딩 1회가 만드는 `/api/media` 함수 호출이 **58개**다 — 사진 한 장이
 * `_next/image` → `/api/media/<id>` 두 겹이고 안쪽이 DB 를 친다. 그 호출들이 Fluid Compute
 * 인스턴스에 흩어지고, 인스턴스마다 풀이 열린다. 2026-08-27 에 **동시 인스턴스 63개**가
 * 관측됐고 ESSENTIA 백엔드가 커넥션을 거부당했다. RDS 는 공유 `t4g.micro` 다.
 *
 * `max` 를 낮추는 것은 이 문제를 지연 문제로 바꿀 뿐이다(인스턴스 수가 앱 손에 없다).
 * **커넥션을 아예 안 만드는 것**이 유일하게 총량을 줄인다.
 *
 * ## 왜 이만큼만 캐시하는가
 *
 * 캐시 대상을 `CACHEABLE_ENTITY_TYPES` 로 **한정한다**. 그 종류들은 이미
 * `public, max-age=31536000, immutable` 로 나가고 있다 — CDN 이 1년을 들고 있는 값에
 * 인스턴스가 60초를 더 들고 있는 것은 **새로운 노출이 아니다.**
 *
 * 반대로 `member`(미성년자 얼굴, I17)와 `entity_type` 이 null 인 행은 캐시하지 않는다.
 * 그쪽은 `private, no-store` 라 CDN 사본이 없고, 여기서 캐시하면 **우리가 처음으로**
 * 사본을 만드는 셈이 된다. 삭제도 그 종류에는 즉시 반영돼야 한다.
 *
 * 실패(행 없음·`pending`·삭제됨)는 캐시하지 않는다 — 방금 올린 이미지가 `pending` 에서
 * `ready` 로 넘어가는 순간을 404 로 굳혀 버린다.
 *
 * ## 무엇이 낡을 수 있는가
 *
 * `bucket`·`key`·`mime`·`etag` 는 `ready` 이후 변하지 않는다. 변할 수 있는 것은
 * `entityType` 하나이고(`stampMediaEntity`), 그 결과는 최대 TTL 동안 옛 캐시 정책이 적용되는 것이다.
 * 삭제는 TTL 만큼 늦게 반영된다 — 위에서 적었듯 그 종류는 CDN 이 이미 1년을 들고 있다.
 *
 * 캐시는 **인스턴스 로컬**이다. 다른 인스턴스로 전파되지 않으므로 무효화 경로를 만들지 않는다.
 * TTL 이 유일한 경계다.
 */
const MEDIA_TTL_MS = 60_000

/** 상한. 실제 미디어 수는 수십 개지만, 상한 없는 Map 은 그 자체로 사고 경로다. */
const MEDIA_CACHE_MAX = 256

const mediaCache = new Map<string, { value: ServableMedia; expiresAt: number }>()

function cacheGet(id: string): ServableMedia | null {
  const hit = mediaCache.get(id)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    mediaCache.delete(id)
    return null
  }
  return hit.value
}

function cachePut(id: string, value: ServableMedia): void {
  if (!isCacheableEntityType(value.entityType)) return
  // 가장 오래된 것부터 버린다. Map 은 삽입 순서를 유지한다.
  if (mediaCache.size >= MEDIA_CACHE_MAX) {
    const oldest = mediaCache.keys().next()
    if (!oldest.done) mediaCache.delete(oldest.value)
  }
  mediaCache.set(id, { value, expiresAt: Date.now() + MEDIA_TTL_MS })
}

/**
 * `/api/media/{id}` 가 서빙해도 되는 행인가. `ready` + 미삭제만 통과한다.
 *
 * 적격인 종류는 인스턴스 로컬 캐시에서 답한다 — 그 경우 **DB 커넥션이 생기지 않는다** (D26).
 */
export async function getServableMedia(mediaId: string): Promise<ServableMedia | null> {
  if (!isUuid(mediaId)) return null

  const cached = cacheGet(mediaId)
  if (cached) return cached

  const rows = await db
    .select({
      id: media.id,
      bucket: media.bucket,
      key: media.key,
      mime: media.mime,
      originalFilename: media.originalFilename,
      etag: media.etag,
      entityType: media.entityType,
    })
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.status, 'ready'), isNull(media.deletedAt)))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  cachePut(mediaId, row)
  return row
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
    await deleteObject(bucket, key)
  } catch (err) {
    await enqueueCleanup(bucket, key, describeError(err))
  }
  await markFailed(mediaId)
}

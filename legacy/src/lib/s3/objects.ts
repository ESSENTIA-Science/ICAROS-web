import 'server-only'

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { getS3Client } from './client'
import { StorageError, awsStatusCode, describeError, isNotFoundError } from './errors'
import { assertBucketMatches, assertKeyReadable, assertKeyWritable } from './keys'
import { SNIFF_BYTES } from './predicates'

/**
 * 이 파일의 모든 함수가 `bucket` 을 **필수 인자**로 받는다.
 * 호출부(`media` · `storage_cleanup_jobs` 행)는 버킷을 컬럼으로 들고 다니는데,
 * 여기서 `getS3Config().bucket` 을 대신 쓰면 그 값이 조용히 버려진다 — 행이 가리키는 것과
 * 실제로 건드리는 것이 달라지고, 삭제 경로에서는 그게 곧 복구 불가능한 사고다.
 */

/** ETag 는 따옴표로 감싸여 온다. 저장·비교 전에 벗긴다. */
function normalizeEtag(raw: string | undefined): string | null {
  if (!raw) return null
  const bare = raw.replace(/^W\//i, '').replace(/^"|"$/g, '')
  return bare.length > 0 ? bare : null
}

/**
 * S3 가 돌려준 Content-Type 은 **일부러 담지 않는다.**
 * 그 값은 업로더가 presign 요청에 넣은 값 그대로라 `media.mime` 과 비교하면 자기 자신과의 비교가 된다.
 * 형식 판정은 `getObjectPrefix` + `sniffMime` 이 실제 바이트로 한다 (요구사항 I5).
 */
export interface ObjectHead {
  readonly size: number
  readonly etag: string | null
}

/**
 * 업로드 실재·크기를 서버가 직접 확인한다 (요구사항 I8).
 * 객체가 없으면 예외가 아니라 `null` 을 준다 — 업로드 중단은 정상적인 실패 경로다.
 */
export async function headObject(bucket: string, key: string): Promise<ObjectHead | null> {
  assertBucketMatches(bucket)
  assertKeyReadable(key)

  try {
    const res = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { size: res.ContentLength ?? 0, etag: normalizeEtag(res.ETag) }
  } catch (err) {
    if (isNotFoundError(err)) return null
    throw new StorageError('upstream', `업로드 확인에 실패했습니다. (${describeError(err)})`, { cause: err })
  }
}

/**
 * **개별 키 하나만** 지운다. `DeleteObjects` 배치도 프리픽스 통삭제도 이 계층에 존재하지 않는다.
 * 버킷 Versioning 이 꺼져 있어 지우면 복구가 불가능하고, 프리픽스 포함관계로 인한
 * 교차 삭제 사고 전력이 있다 (07 §0-4·§6).
 *
 * 이미 없는 객체는 성공으로 본다 — 재시도가 멱등해야 cleanup 큐가 영원히 막히지 않는다.
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  assertBucketMatches(bucket)
  assertKeyWritable(key)

  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  } catch (err) {
    if (isNotFoundError(err)) return
    throw new StorageError('upstream', `객체 삭제에 실패했습니다. (${describeError(err)})`, { cause: err })
  }
}

/** 객체 없음이면 `null`. 그 밖의 실패는 전부 `StorageError` 로 정규화해 던진다. */
async function sendGetObject(
  bucket: string,
  key: string,
  range: string | undefined
): Promise<GetObjectCommandOutput | null> {
  assertBucketMatches(bucket)
  assertKeyReadable(key)

  try {
    return await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }))
  } catch (err) {
    if (isNotFoundError(err)) return null
    if (awsStatusCode(err) === 416) {
      throw new StorageError('range_not_satisfiable', '요청한 범위를 제공할 수 없습니다.')
    }
    throw new StorageError('upstream', `객체를 읽지 못했습니다. (${describeError(err)})`, { cause: err })
  }
}

export interface ObjectStream {
  /** S3 가 부분 응답을 줬는가. Range 요청을 그대로 전달하므로 응답 코드도 그대로 따라간다. */
  readonly partial: boolean
  readonly body: ReadableStream
  readonly contentLength: number | null
  readonly contentRange: string | null
  readonly etag: string | null
}

/**
 * 객체 바이트를 **스트림 그대로** 넘긴다 (DECISIONS D15).
 *
 * 버퍼에 전부 담지 않는다. GLB 는 8MB 까지 허용되고, 그걸 서버리스 함수 메모리에 통째로 올리면
 * 동시 요청 몇 건으로 한도를 넘긴다. `Range` 는 해석하지 않고 S3 에 그대로 전달한다 —
 * 우리가 다시 파싱하면 S3 와 해석이 갈라질 여지만 생긴다.
 */
export async function getObjectStream(
  bucket: string,
  key: string,
  range?: string | null
): Promise<ObjectStream | null> {
  const res = await sendGetObject(bucket, key, range ?? undefined)
  if (!res) return null
  if (!res.Body) {
    throw new StorageError('upstream', '객체 본문을 받지 못했습니다.')
  }

  return {
    partial: res.ContentRange !== undefined,
    body: res.Body.transformToWebStream(),
    contentLength: res.ContentLength ?? null,
    contentRange: res.ContentRange ?? null,
    etag: normalizeEtag(res.ETag),
  }
}

/**
 * 선두 몇 바이트만 받아 온다. `/confirm` 의 매직 넘버 검증용 (요구사항 I5).
 *
 * 0바이트 객체나 범위 밖 요청에 S3 는 416 을 준다. 그건 "형식을 판정할 수 없다"와 같은 뜻이므로
 * 던지지 않고 빈 배열을 돌려준다 — 호출부의 판정 로직이 하나로 유지된다.
 */
export async function getObjectPrefix(
  bucket: string,
  key: string,
  length: number = SNIFF_BYTES
): Promise<Uint8Array | null> {
  let res: GetObjectCommandOutput | null
  try {
    res = await sendGetObject(bucket, key, `bytes=0-${Math.max(0, Math.trunc(length) - 1)}`)
  } catch (err) {
    if (err instanceof StorageError && err.code === 'range_not_satisfiable') return new Uint8Array()
    throw err
  }

  if (!res) return null
  if (!res.Body) return new Uint8Array()
  return res.Body.transformToByteArray()
}

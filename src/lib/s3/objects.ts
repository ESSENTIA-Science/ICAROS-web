import 'server-only'

import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getS3Client } from './client'
import { getS3Config } from './config'
import { StorageError, describeError, isNotFoundError } from './errors'
import { assertKeyReadable, assertKeyWritable } from './keys'

export interface ObjectHead {
  readonly size: number
  readonly contentType: string | null
  readonly etag: string | null
}

/**
 * 업로드 실재·크기·타입을 서버가 직접 확인한다 (요구사항 I8).
 * 객체가 없으면 예외가 아니라 `null` 을 준다 — 업로드 중단은 정상적인 실패 경로다.
 */
export async function headObject(key: string): Promise<ObjectHead | null> {
  assertKeyReadable(key)
  const { bucket } = getS3Config()

  try {
    const res = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return {
      size: res.ContentLength ?? 0,
      contentType: res.ContentType ?? null,
      // ETag 는 따옴표로 감싸여 온다. 저장 전에 벗긴다.
      etag: res.ETag ? res.ETag.replace(/^"|"$/g, '') : null,
    }
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
export async function deleteObject(key: string): Promise<void> {
  assertKeyWritable(key)
  const { bucket } = getS3Config()

  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  } catch (err) {
    if (isNotFoundError(err)) return
    throw new StorageError('upstream', `객체 삭제에 실패했습니다. (${describeError(err)})`, { cause: err })
  }
}

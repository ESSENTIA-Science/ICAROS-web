import 'server-only'

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PRESIGN_TTL_SECONDS } from '@/lib/image/policy'
import { getS3Client } from './client'
import { getS3Config } from './config'
import { StorageError, describeError } from './errors'
import { assertKeyReadable, assertKeyWritable } from './keys'

/**
 * presigned **PUT** (POST 아님 — D12).
 *
 * 버킷이 ESSENTIA 와 공유 자원이고 ESSENTIA 는 이미 presigned PUT + `content-type;host` 서명으로
 * 타입을 강제한다. POST 를 열면 같은 버킷에 검증 모델이 둘 생긴다.
 * 크기 상한은 서명에 박히지 않으므로 ① 브라우저 전처리 ② `/confirm` 의 HeadObject 검증 후
 * 초과 시 즉시 삭제로 담보한다.
 */
export async function presignPut(key: string, contentType: string): Promise<string> {
  assertKeyWritable(key)
  const { bucket } = getS3Config()

  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })

  try {
    return await getSignedUrl(getS3Client(), command, {
      expiresIn: PRESIGN_TTL_SECONDS,
      // content-type 을 서명에 포함해야 브라우저가 다른 타입으로 바꿔 올리는 것을 S3 가 거부한다.
      signableHeaders: new Set(['content-type', 'host']),
    })
  } catch (err) {
    throw new StorageError('upstream', `업로드 URL 발급에 실패했습니다. (${describeError(err)})`, { cause: err })
  }
}

export interface PresignGetOptions {
  /** 응답에 강제할 Content-Type. S3 에 저장된 값보다 우리 DB 값을 신뢰한다. */
  contentType?: string | undefined
  /** `inline` 또는 `attachment; filename*=...`. 이미 인코딩된 완성 헤더 값을 넘긴다. */
  contentDisposition?: string | undefined
}

/**
 * presigned GET (10분 — 07 §3).
 * 이 URL 을 `next/image` 의 `src` 로 직접 쓰면 안 된다. 5~10분마다 URL 이 바뀌어
 * 최적화 캐시가 매번 miss 나고 서명 쿼리스트링이 캐시 키를 오염시킨다.
 * 항상 고정 URL 인 `/api/media/{id}` 를 거쳐 여기로 302 시킨다 (D3).
 */
export async function presignGet(key: string, options: PresignGetOptions = {}): Promise<string> {
  assertKeyReadable(key)
  const { bucket } = getS3Config()

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: options.contentType,
    ResponseContentDisposition: options.contentDisposition,
  })

  try {
    return await getSignedUrl(getS3Client(), command, { expiresIn: PRESIGN_TTL_SECONDS })
  } catch (err) {
    throw new StorageError('upstream', `이미지 URL 발급에 실패했습니다. (${describeError(err)})`, { cause: err })
  }
}

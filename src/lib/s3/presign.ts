import 'server-only'

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { PRESIGN_TTL_SECONDS } from '@/lib/image/policy'
import { getS3Client } from './client'
import { getS3Config } from './config'
import { StorageError, describeError } from './errors'
import { assertKeyWritable } from './keys'

/**
 * 이 파일에는 **업로드용 PUT 서명만** 있다.
 * 읽기용 presigned GET 은 없앴다 — `/api/media/{id}` 가 바이트를 직접 스트리밍하므로(D15)
 * 서명 URL 이 클라이언트로 나갈 경로 자체가 사라졌다. 남겨 두면 언젠가 누가 다시 쓴다.
 */

/**
 * presigned **PUT** (POST 아님 — D12).
 *
 * 버킷이 ESSENTIA 와 공유 자원이고 ESSENTIA 는 이미 presigned PUT + `content-type;host` 서명으로
 * 타입을 강제한다. POST 를 열면 같은 버킷에 검증 모델이 둘 생긴다.
 * 크기 상한은 서명에 박히지 않으므로 ① 브라우저 전처리 ② `/confirm` 의 실측 검증 후
 * 초과 시 즉시 삭제로 담보한다.
 */
export async function presignPut(key: string, contentType: string): Promise<string> {
  // 버킷 대조가 없는 유일한 S3 진입점이다. 여기서 쓰는 버킷은 행이 아니라 설정에서 오고,
  // 그 설정값으로 만든 키를 그대로 서명하므로 대조할 두 값이 애초에 존재하지 않는다.
  assertKeyWritable(key)
  const { bucket } = getS3Config()

  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })

  try {
    return await getSignedUrl(getS3Client(), command, {
      expiresIn: PRESIGN_TTL_SECONDS,
      // content-type 을 서명에 포함해야 브라우저가 다른 타입으로 바꿔 올리는 것을 S3 가 거부한다.
      // 다만 이건 **선언값 강제**일 뿐 내용 검증이 아니다 — 바이트 검증은 `/confirm` 이 한다.
      signableHeaders: new Set(['content-type', 'host']),
    })
  } catch (err) {
    throw new StorageError('upstream', `업로드 URL 발급에 실패했습니다. (${describeError(err)})`, { cause: err })
  }
}

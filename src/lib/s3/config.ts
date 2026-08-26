import 'server-only'

import { DB_ALLOWED_KEY_ROOTS } from '@/lib/image/policy'
import { StorageError } from './errors'

export interface S3Config {
  readonly bucket: string
  readonly prefix: string
  readonly region: string
  /**
   * S3 호환 엔드포인트. **로컬 개발 전용**이고 운영에서는 비어 있다.
   *
   * 이 값이 없으면 SDK 가 실제 AWS 로 간다 — 즉 운영 동작은 이 필드가 없던 때와 한 글자도
   * 다르지 않다. 설정되지 않은 값이 기본값으로 스며들지 않게 `undefined` 를 그대로 둔다.
   */
  readonly endpoint: string | undefined
}

/**
 * 버킷 이름·IAM·CORS 가 아직 승인되지 않았다 (07 §7·§8).
 * `S3_BUCKET` 이 비어 있으면 **명확히 실패하는 것이 정상 동작**이다 — 기본값을 지어내면
 * 승인 전에 공유 버킷을 건드리는 코드가 조용히 살아 있게 된다.
 *
 * 모듈 로드가 아니라 호출 시점에 던진다. 그래야 스토리지를 쓰지 않는 페이지·라우트가
 * 미구성 상태에서도 정상 동작한다.
 */
export function getS3Config(): S3Config {
  const bucket = process.env.S3_BUCKET?.trim()
  if (!bucket) {
    throw new StorageError(
      'config_missing',
      'S3_BUCKET 이 설정되지 않았습니다. 버킷·IAM·CORS 승인 전까지 스토리지는 비활성입니다.'
    )
  }

  const prefix = (process.env.S3_PREFIX?.trim() || 'icaros-web').replace(/^\/+|\/+$/g, '')

  // `icaros.media` 의 CHECK 제약이 루트를 하드코딩하고 있다.
  // 여기서 막지 않으면 presign 은 성공하고 insert 만 CHECK 위반으로 터진다 — 원인을 찾기 어렵다.
  if (!DB_ALLOWED_KEY_ROOTS.includes(prefix)) {
    throw new StorageError(
      'config_missing',
      `S3_PREFIX='${prefix}' 는 media_key_prefix_ck 가 허용하지 않습니다. 허용: ${DB_ALLOWED_KEY_ROOTS.join(', ')}`
    )
  }

  const region = process.env.AWS_REGION?.trim() || 'ap-northeast-2'

  /**
   * 로컬 MinIO 를 붙일 자리 (09 §4 P4 "로컬은 MinIO 또는 실제 버킷 read-only").
   *
   * 이것이 없어서 지금까지 스토리지가 걸린 화면은 로컬에서 **한 번도 돌려 볼 수 없었다** —
   * 업로드·미디어 서빙·패널 랜딩이 전부 운영 버킷 승인에 묶여 있었다.
   * 운영에서는 이 환경변수가 없으므로 경로가 바뀌지 않는다.
   */
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined

  return { bucket, prefix, region, endpoint }
}

/** 구성 여부만 알고 싶을 때. 관리 UI 가 업로드 버튼을 감추는 데 쓴다. */
export function isStorageConfigured(): boolean {
  try {
    getS3Config()
    return true
  } catch {
    return false
  }
}

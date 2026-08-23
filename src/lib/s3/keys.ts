import 'server-only'

import { randomUUID } from 'node:crypto'
import { isOwnedKey, isReadableKey, keyFolder, UPLOAD_POLICIES, type KeyFolder, type UploadKind } from '@/lib/image/policy'
import { getS3Config } from './config'
import { StorageError } from './errors'
import { isSameBucket } from './predicates'

/**
 * `icaros-web/media/{uuid}.webp` 형태의 키를 만든다.
 * 사용자 파일명은 **한 글자도** 들어가지 않는다 (07 §4, 요구사항 I7).
 * 원본명은 `icaros.media.original_filename` 에만 남고 다운로드 시 Content-Disposition 으로만 쓰인다.
 */
export function buildObjectKey(kind: UploadKind): string {
  const { prefix } = getS3Config()
  const policy = UPLOAD_POLICIES[kind]
  return `${prefix}/${policy.folder}/${randomUUID()}.${policy.extension}`
}

/**
 * 쓰기·삭제 직전 마지막 방어선 (요구사항 I4·I11).
 *
 * `forum/` 은 일부러 제외한다 — 게시글 이미지는 ESSENTIA 소유이고 우리는 D1 착수 전까지
 * 거기에 쓸 일이 없다. 프리픽스 포함관계로 인한 교차 삭제 사고 전력이 있어(07 §0-4)
 * "읽을 수 있는 범위"와 "지울 수 있는 범위"를 일부러 다르게 둔다.
 */
export function assertKeyWritable(key: string): void {
  const { prefix } = getS3Config()
  if (!isOwnedKey(key, prefix)) {
    throw new StorageError('forbidden_key', 'ICAROS 프리픽스 밖의 객체에는 접근할 수 없습니다.')
  }
}

/** 우리가 바이트를 읽어 서빙해도 되는 키인가. 게시글 이미지(`forum/`)까지 포함한다. */
export function assertKeyReadable(key: string): void {
  const { prefix } = getS3Config()
  if (!isReadableKey(key, prefix)) {
    throw new StorageError('forbidden_key', '허용되지 않은 객체 경로입니다.')
  }
}

/**
 * 행이 들고 있는 버킷이 지금 설정된 버킷과 같은가 (07 §0-4·§6).
 *
 * `media` 와 `storage_cleanup_jobs` 는 버킷을 컬럼으로 갖고 있어서, 설정이 바뀐 뒤 남은 오래된 행이
 * 다른 버킷을 가리킬 수 있다. Versioning 이 꺼져 있어 남의 버킷에서 지운 객체는 복구가 불가능하다.
 * 키 프리픽스 검사(`assertKeyWritable`)는 버킷을 보지 않으므로 **이 검사가 따로 필요하다** —
 * `icaros-web/media/…` 라는 키는 어느 버킷에나 존재할 수 있다.
 */
export function assertBucketMatches(bucket: string): void {
  const { bucket: configured } = getS3Config()
  if (!isSameBucket(bucket, configured)) {
    throw new StorageError('forbidden_key', '설정된 버킷이 아닌 객체에는 접근할 수 없습니다.')
  }
}

/** 키가 어느 폴더 것인지. `/confirm` 이 폴더별 절대 상한을 고를 때 쓴다. */
export function folderOfKey(key: string): KeyFolder | null {
  const { prefix } = getS3Config()
  return keyFolder(key, prefix)
}

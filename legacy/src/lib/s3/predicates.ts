/**
 * 스토리지 계층의 순수 판정 함수.
 *
 * `lib/image/policy.ts` 와 같은 이유로 여기에는 `server-only` 도 AWS SDK 도 두지 않는다 —
 * 매직 넘버 판별·버킷 대조·ETag 비교는 서버 설정 없이 단위 검증이 되어야 하는 로직이다.
 * 설정을 읽는 래퍼(`assertBucketMatches`)는 `keys.ts` 에 있다.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

// ── 버킷 대조 ───────────────────────────────────────────────────────────────

/**
 * 우리는 버킷 **하나**만 쓴다. `media`·`storage_cleanup_jobs` 행은 자기 버킷을 들고 다니지만,
 * 그 값이 현재 설정과 다르면 그건 남의 버킷이다 — 특히 삭제는 되돌릴 수 없다
 * (Versioning 꺼짐 + 프리픽스 교차 삭제 사고 전력, 07 §0-4·§6).
 *
 * S3 버킷 이름은 소문자 전용이지만 env 오타(앞뒤 공백·대문자)까지 같은 것으로 본다.
 * 빈 문자열은 어느 쪽이든 불일치다 — "설정이 비었으니 통과"가 되면 안 된다.
 */
export function isSameBucket(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  return left.length > 0 && left === right
}

// ── 매직 넘버 ───────────────────────────────────────────────────────────────

/**
 * 형식 판별에 필요한 선두 바이트 수. `/confirm` 이 이만큼만 Range GET 한다.
 * WebP 는 8~11 바이트의 `WEBP` 까지 봐야 확정되므로 12 가 하한이고, 여유를 두어 16 으로 둔다.
 */
export const SNIFF_BYTES = 16

export type SniffedMime = 'image/webp' | 'model/gltf-binary' | 'video/mp4'

/** `bytes` 의 `start` 위치부터가 ASCII 문자열 `text` 인가. 범위를 벗어나면 false. */
function hasAscii(bytes: Uint8Array, start: number, text: string): boolean {
  if (bytes.length < start + text.length) return false
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[start + i] !== text.charCodeAt(i)) return false
  }
  return true
}

/**
 * 실제 바이트로 형식을 판정한다 (요구사항 I5).
 *
 * 선언값(업로더가 보낸 Content-Type)은 검증이 되지 않는다 — presigned PUT 서명에 박히는 값이
 * 곧 업로더가 요청한 값이라, S3 에 저장된 Content-Type 과 비교하면 자기 자신과 비교하는 셈이다.
 */
export function sniffMime(bytes: Uint8Array): SniffedMime | null {
  // RIFF 컨테이너의 4~7 바이트는 파일 크기라 건너뛴다. 8~11 의 `WEBP` 가 형식을 확정한다.
  if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')) return 'image/webp'
  // glTF 바이너리 헤더: magic `glTF` + version + length.
  if (hasAscii(bytes, 0, 'glTF')) return 'model/gltf-binary'
  // ISO BMFF(MP4): 선두 4바이트가 박스 크기라 건너뛰고 4~7 의 `ftyp` 를 본다.
  // 이 줄이 없으면 `confirmUpload` 이 mp4 를 판정하지 못해 **객체를 지우고** 확정을 거부한다 —
  // 업로드가 성공한 것처럼 보이다 마지막에 사라지므로 원인을 찾기 어렵다.
  if (hasAscii(bytes, 4, 'ftyp')) return 'video/mp4'
  return null
}

// ── ETag ────────────────────────────────────────────────────────────────────

/** DB 에는 따옴표를 벗겨 저장한다. 헤더로 나갈 때만 다시 감싼다. */
export function quoteEtag(etag: string): string {
  return `"${etag}"`
}

function bareEtag(value: string): string {
  return value
    .trim()
    .replace(/^W\//i, '')
    .replace(/^"|"$/g, '')
}

/**
 * `If-None-Match` 대조 (RFC 9110 §13.1.2 — weak comparison).
 * 목록·`W/` 접두사·`*` 를 모두 처리한다. 하나라도 맞으면 304 다.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string | null): boolean {
  if (!ifNoneMatch || !etag) return false
  const target = bareEtag(etag)
  if (target.length === 0) return false
  return ifNoneMatch.split(',').some((candidate) => {
    const trimmed = candidate.trim()
    return trimmed === '*' || bareEtag(trimmed) === target
  })
}

/**
 * 업로드 정책 — 브라우저 전처리와 서버 검증이 **같은 상수·같은 판정 함수**를 봐야 한다.
 * 두 벌로 갈라지면 "브라우저는 통과시켰는데 서버가 조용히 거부"가 생긴다.
 *
 * 그래서 이 파일에는 `server-only` 도 DOM API 도 없다. 순수 상수와 순수 함수만 둔다.
 * (`lib/s3` 는 서버 전용이라 이 파일을 가져다 쓰고, 브라우저 인코더도 같은 파일을 쓴다.)
 *
 * 근거: 07-s3-storage-plan.md §5, DECISIONS 기본값 표.
 */

export const UPLOAD_KINDS = ['media', 'hero', 'poster', 'glb'] as const
export type UploadKind = (typeof UPLOAD_KINDS)[number]

/** `icaros.media.entity_type` 에 허용하는 값. 스키마 주석과 일치시킨다. */
export const MEDIA_ENTITY_TYPES = ['rocket', 'member', 'landing', 'model', 'poster'] as const
export type MediaEntityType = (typeof MEDIA_ENTITY_TYPES)[number]

/** S3 키의 두 번째 세그먼트. 07 §4 의 프리픽스 구조 그대로. */
export const KEY_FOLDERS = ['media', 'poster', 'glb', 'temp'] as const
export type KeyFolder = (typeof KEY_FOLDERS)[number]

export interface UploadPolicy {
  readonly folder: Exclude<KeyFolder, 'temp'>
  readonly extension: 'webp' | 'glb'
  /** 서버가 수락하는 **유일한** Content-Type. presigned PUT 서명에도 이 값이 박힌다. */
  readonly mime: 'image/webp' | 'model/gltf-binary'
  readonly maxBytes: number
  /** 긴 변 상한. GLB 는 픽셀 개념이 없어 null. */
  readonly maxEdgePx: number | null
}

const MB = 1024 * 1024

export const UPLOAD_POLICIES: Readonly<Record<UploadKind, UploadPolicy>> = {
  // 로켓 카드·멤버 사진·랜딩 이미지·OG. 카드 뷰 전송량이 목적이라 가장 빡빡하다 (요구사항 I16).
  media: { folder: 'media', extension: 'webp', mime: 'image/webp', maxBytes: 1 * MB, maxEdgePx: 512 },
  // 히어로·로켓 대표 이미지. 512px 로는 부족해 상향한 대신 용량 상한을 2MB 로 연다.
  hero: { folder: 'media', extension: 'webp', mime: 'image/webp', maxBytes: 2 * MB, maxEdgePx: 1600 },
  // WebGL 미가용 시 3D 를 대체하는 정지 이미지.
  poster: { folder: 'poster', extension: 'webp', mime: 'image/webp', maxBytes: 2 * MB, maxEdgePx: 1600 },
  // 브라우저 전처리가 불가능하다. 빌드타임에 Draco/meshopt 로 줄인 뒤 올린다.
  glb: { folder: 'glb', extension: 'glb', mime: 'model/gltf-binary', maxBytes: 8 * MB, maxEdgePx: null },
}

/**
 * 폴더별 절대 상한. `/confirm` 이 `HeadObject` 로 실측할 때 쓴다.
 * `media` 폴더에는 kind 가 둘(`media` 1MB · `hero` 2MB) 섞여 들어오고 media 행에 kind 컬럼이 없으므로
 * 여기서는 느슨한 쪽을 쓰고, 정확한 kind 상한은 presign 때 기록해 둔 선언 크기로 좁힌다
 * (`confirmUpload` 의 declared-size 검사).
 */
export const MAX_BYTES_BY_FOLDER: Readonly<Record<KeyFolder, number>> = {
  media: 2 * MB,
  poster: 2 * MB,
  glb: 8 * MB,
  temp: 8 * MB,
}

/** WebP 품질 하향 루프. 1600px 를 q0.85 로 굽면 2MB 를 넘을 수 있다 (07 §5). */
export const WEBP_QUALITY_START = 0.85
export const WEBP_QUALITY_STEP = 0.05
export const WEBP_QUALITY_FLOOR = 0.6

/** presigned URL 유효 시간. ESSENTIA 프로필·게시판 관례와 동일 (07 §3). */
export const PRESIGN_TTL_SECONDS = 600

/**
 * 로켓 한 기의 갤러리 상한 (C7). 카드 뷰 전송량(I16)과 폼 길이를 함께 감안한 값이다.
 *
 * **여기가 유일한 정의다.** 예전에는 서버(`admin/_lib/media.ts`)와 폼(`RocketForm.tsx`)이
 * 각자 `12` 를 들고 있었다. 한쪽만 올리면 브라우저는 13장을 올려 두고 저장에서 거부당해
 * S3 에 고아만 남는다 — 이 파일이 존재하는 이유(브라우저·서버 공통 상수)와 정확히 같은 문제다.
 */
export const MAX_GALLERY_IMAGES = 12

// ── SVG 차단 ────────────────────────────────────────────────────────────────
// MIME 은 클라이언트가 붙이는 값이라 위조된다. 확장자와 이중으로 본다 (요구사항 I5).

const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set(['svg', 'svgz', 'xml', 'html', 'htm'])
const BLOCKED_MIMES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'image/svg-xml',
  'text/html',
  'text/xml',
  'application/xml',
])

/** 제어문자 — 헤더 인젝션·프리픽스 검사 우회 경로가 된다. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** 확장자를 소문자로 뽑는다. 없으면 빈 문자열. 레거시에 `.PNG` 가 있어 정규화가 필수다 (07 §4). */
export function fileExtension(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** SVG 계열은 확장자·MIME 어느 한쪽만 걸려도 거부한다. */
export function isBlockedSource(filename: string, mime: string): boolean {
  return BLOCKED_EXTENSIONS.has(fileExtension(filename)) || BLOCKED_MIMES.has(mime.trim().toLowerCase())
}

// ── 파일명 ──────────────────────────────────────────────────────────────────

/**
 * 원본 파일명은 **키에 절대 들어가지 않는다** (07 §4). 다운로드 시 Content-Disposition 에만 쓴다.
 * 구분자가 남아 있으면 거부한다 — ESSENTIA 도 같은 규칙이다.
 * @returns 정규화된 파일명, 또는 쓸 수 없으면 null
 */
export function sanitizeOriginalFilename(raw: string): string | null {
  const name = raw.trim()
  if (name.length === 0 || name.length > 255) return null
  if (name === '.' || name === '..') return null
  if (/[/\\]/.test(name)) return null
  if (CONTROL_CHARS.test(name)) return null
  return name
}

// ── 업로드 후보 판정 (브라우저·서버 공통) ───────────────────────────────────

export type RejectCode =
  | 'unknown_kind'
  | 'blocked_type'
  | 'wrong_mime'
  | 'wrong_extension'
  | 'too_large'
  | 'empty'
  | 'bad_filename'

export type CheckResult = { ok: true } | { ok: false; code: RejectCode; message: string }

export function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === 'string' && (UPLOAD_KINDS as readonly string[]).includes(value)
}

export function isMediaEntityType(value: unknown): value is MediaEntityType {
  return typeof value === 'string' && (MEDIA_ENTITY_TYPES as readonly string[]).includes(value)
}

/**
 * presign 을 발급해도 되는 요청인지 판정한다.
 * **전처리가 끝난 산출물**을 기준으로 본다 — 이미지라면 이미 WebP 로 구워진 상태다.
 */
export function checkUploadCandidate(input: {
  kind: unknown
  mime: string
  size: number
  filename?: string | undefined
}): CheckResult {
  const { kind, mime, size, filename } = input

  if (!isUploadKind(kind)) {
    return { ok: false, code: 'unknown_kind', message: '허용되지 않은 업로드 종류입니다.' }
  }
  const policy = UPLOAD_POLICIES[kind]
  const normalizedMime = mime.trim().toLowerCase()

  if (filename !== undefined) {
    if (sanitizeOriginalFilename(filename) === null) {
      return { ok: false, code: 'bad_filename', message: '파일 이름을 사용할 수 없습니다.' }
    }
    if (isBlockedSource(filename, normalizedMime)) {
      return {
        ok: false,
        code: 'blocked_type',
        message: 'SVG 처럼 스크립트를 담을 수 있는 형식은 업로드할 수 없습니다.',
      }
    }
    // 이미지는 브라우저에서 WebP 로 다시 구워지므로 원본 확장자는 보지 않는다.
    // GLB 는 전처리가 없어 확장자가 곧 형식 주장이다 — 그래서 여기서만 확장자를 강제한다.
    if (policy.extension === 'glb' && fileExtension(filename) !== 'glb') {
      return { ok: false, code: 'wrong_extension', message: '3D 모델은 .glb 파일만 업로드할 수 있습니다.' }
    }
  } else if (isBlockedSource('', normalizedMime)) {
    return { ok: false, code: 'blocked_type', message: '허용되지 않은 파일 형식입니다.' }
  }

  if (normalizedMime !== policy.mime) {
    return { ok: false, code: 'wrong_mime', message: `${policy.mime} 형식만 업로드할 수 있습니다.` }
  }

  if (!Number.isInteger(size) || size <= 0) {
    return { ok: false, code: 'empty', message: '빈 파일은 업로드할 수 없습니다.' }
  }
  if (size > policy.maxBytes) {
    return { ok: false, code: 'too_large', message: `${formatBytes(policy.maxBytes)} 이하만 업로드할 수 있습니다.` }
  }

  return { ok: true }
}

export function formatBytes(bytes: number): string {
  if (bytes >= MB) {
    const mb = bytes / MB
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
  }
  return `${Math.round(bytes / 1024)}KB`
}

// ── 키 판정 (프리픽스) ──────────────────────────────────────────────────────
// 순수 함수로 두어 서버 설정 없이도 단위 검증이 된다. prefix 는 호출자가 넘긴다.

/**
 * `icaros.media.media_key_prefix_ck` 가 허용하는 루트.
 * `S3_PREFIX` 를 이 밖의 값으로 바꾸면 DB insert 가 CHECK 위반으로 실패한다 — config 에서 미리 막는다.
 */
export const DB_ALLOWED_KEY_ROOTS: readonly string[] = ['icaros-web', 'forum']

/**
 * 경로 탈출·공백·이중 슬래시처럼 프리픽스 검사를 우회시킬 수 있는 형태를 먼저 거른다.
 * S3 키는 대소문자를 구분하고 `..` 을 정규화하지 않으므로 우리가 직접 본다.
 */
export function isStructurallySafeKey(key: string): boolean {
  if (key.length === 0 || key.length > 1024) return false
  if (key !== key.trim()) return false
  if (key.startsWith('/') || key.endsWith('/')) return false
  if (key.includes('//')) return false
  if (key.includes('\\')) return false
  if (CONTROL_CHARS.test(key)) return false
  return key.split('/').every((seg) => seg !== '.' && seg !== '..')
}

/** 우리가 **쓰고 지울 수 있는** 키인가. `forum/` 은 ESSENTIA 소유라 여기서 false 다 (07 §2). */
export function isOwnedKey(key: string, prefix: string): boolean {
  if (!isStructurallySafeKey(key)) return false
  return KEY_FOLDERS.some((folder) => key.startsWith(`${prefix}/${folder}/`))
}

/** 우리가 **읽어서 서명해 줄 수 있는** 키인가. 게시글 이미지(`forum/`)까지 포함한다. */
export function isReadableKey(key: string, prefix: string): boolean {
  if (isOwnedKey(key, prefix)) return true
  return isStructurallySafeKey(key) && key.startsWith('forum/')
}

/** 키에서 폴더 세그먼트를 뽑는다. 판정 불가면 null. */
export function keyFolder(key: string, prefix: string): KeyFolder | null {
  if (!isStructurallySafeKey(key)) return null
  if (!key.startsWith(`${prefix}/`)) return null
  const seg = key.slice(prefix.length + 1).split('/')[0]
  if (seg === undefined) return null
  return (KEY_FOLDERS as readonly string[]).includes(seg) ? (seg as KeyFolder) : null
}

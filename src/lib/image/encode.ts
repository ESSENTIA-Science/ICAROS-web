/**
 * 브라우저 전처리 — 원본 대용량이 애초에 S3 에 도달하지 않게 만든다 (07 §5).
 * 현행 52객체 중 21개가 2MiB 초과, 최대 9.7MB 인 문제를 입구에서 없애는 지점이다 (요구사항 I16).
 *
 * 브라우저 전용이다. DOM/Canvas API 를 쓰므로 서버에서 import 하면 안 된다.
 * (정책 상수는 `policy.ts` 에 따로 있어 서버도 같은 값을 본다.)
 */

import {
  UPLOAD_POLICIES,
  WEBP_QUALITY_FLOOR,
  WEBP_QUALITY_START,
  WEBP_QUALITY_STEP,
  formatBytes,
  isBlockedSource,
  type UploadKind,
} from './policy'

export class PreprocessError extends Error {
  readonly code: 'blocked' | 'decode_failed' | 'encode_failed' | 'too_large' | 'not_glb'

  constructor(code: PreprocessError['code'], message: string) {
    super(message)
    this.name = 'PreprocessError'
    this.code = code
  }
}

export interface PreparedUpload {
  blob: Blob
  contentType: string
  width: number | null
  height: number | null
  /** 실제로 채택된 WebP 품질. 로그·디버깅용. GLB 는 null. */
  quality: number | null
}

/** kind 에 맞는 전처리를 고른다. 관리 UI 는 이 함수 하나만 부르면 된다. */
export async function prepareUpload(file: File, kind: UploadKind): Promise<PreparedUpload> {
  return UPLOAD_POLICIES[kind].extension === 'glb' ? prepareGlb(file) : encodeToWebp(file, kind)
}

/**
 * canvas → WebP, **품질 하향 루프**.
 * 고정 품질을 쓰면 1600px 짜리가 q0.85 에서 2MB 를 넘겨 그냥 거부돼 버린다.
 * q0.85 에서 시작해 상한 이하가 될 때까지 0.05씩 낮추고, q0.60 에서도 초과하면 거부한다.
 */
export async function encodeToWebp(file: File, kind: UploadKind): Promise<PreparedUpload> {
  const policy = UPLOAD_POLICIES[kind]

  // SVG 는 MIME·확장자 이중으로 막는다. 둘 중 하나만 위조해도 통과하지 못한다.
  if (isBlockedSource(file.name, file.type)) {
    throw new PreprocessError('blocked', 'SVG 처럼 스크립트를 담을 수 있는 형식은 업로드할 수 없습니다.')
  }
  if (!file.type.startsWith('image/')) {
    throw new PreprocessError('blocked', '이미지 파일만 업로드할 수 있습니다.')
  }

  const source = await decodeImage(file)
  const maxEdge = policy.maxEdgePx ?? Math.max(source.width, source.height)
  // 원본보다 키우지 않는다. 작은 이미지를 늘리면 용량만 늘고 화질은 그대로다.
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))

  const { canvas, ctx } = createCanvas(width, height)
  if (!ctx) throw new PreprocessError('encode_failed', '이미지를 처리할 수 없습니다.')
  ctx.drawImage(source.image, 0, 0, width, height)
  releaseImage(source.image)

  for (let quality = WEBP_QUALITY_START; quality >= WEBP_QUALITY_FLOOR - 1e-9; quality -= WEBP_QUALITY_STEP) {
    const blob = await canvasToBlob(canvas, quality)
    // Safari 14 미만은 요청한 타입을 무시하고 PNG 를 준다. 서버가 어차피 거부하므로 여기서 잡는다.
    if (blob.type !== 'image/webp') {
      throw new PreprocessError('encode_failed', '이 브라우저는 WebP 변환을 지원하지 않습니다.')
    }
    if (blob.size <= policy.maxBytes) {
      return { blob, contentType: 'image/webp', width, height, quality: round2(quality) }
    }
  }

  throw new PreprocessError(
    'too_large',
    `이미지를 ${formatBytes(policy.maxBytes)} 이하로 줄이지 못했습니다. 더 작은 이미지를 사용해 주세요.`
  )
}

/**
 * GLB 는 브라우저에서 압축할 수 없다. 빌드타임에 `@gltf-transform/cli` 로 Draco/meshopt 를
 * 적용한 산출물을 올린다는 전제이고, 여기서는 형식과 크기만 확인한다.
 */
export async function prepareGlb(file: File): Promise<PreparedUpload> {
  const policy = UPLOAD_POLICIES.glb

  if (!file.name.toLowerCase().endsWith('.glb')) {
    throw new PreprocessError('not_glb', '3D 모델은 .glb 파일만 업로드할 수 있습니다.')
  }
  if (file.size > policy.maxBytes) {
    throw new PreprocessError(
      'too_large',
      `3D 모델은 ${formatBytes(policy.maxBytes)} 이하만 업로드할 수 있습니다. Draco 또는 meshopt 압축을 적용해 주세요.`
    )
  }

  // 확장자·MIME 은 위조된다. glTF 바이너리 매직(`glTF`)을 직접 읽는다.
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const isGlb = magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46
  if (!isGlb) throw new PreprocessError('not_glb', '올바른 GLB 파일이 아닙니다.')

  return {
    // 브라우저가 붙인 타입을 신뢰하지 않는다. 서명에 들어갈 값으로 다시 감싼다.
    blob: new Blob([file], { type: policy.mime }),
    contentType: policy.mime,
    width: null,
    height: null,
    quality: null,
  }
}

// ── 내부 ────────────────────────────────────────────────────────────────────

interface DecodedImage {
  image: CanvasImageSource & { width: number; height: number }
  width: number
  height: number
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { image: bitmap, width: bitmap.width, height: bitmap.height }
    } catch {
      // 일부 브라우저가 특정 포맷에서 실패한다. <img> 경로로 내려간다.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new PreprocessError('decode_failed', '이미지를 읽을 수 없습니다.'))
      el.src = url
    })
    return { image: img, width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function releaseImage(image: CanvasImageSource): void {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type Any2dContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** 컨텍스트를 캔버스와 함께 돌려준다 — 유니온에 `getContext('2d')` 를 걸면 타입이 좁혀지지 않는다. */
function createCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: Any2dContext | null } {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height)
    return { canvas, ctx: canvas.getContext('2d') }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return { canvas, ctx: canvas.getContext('2d') }
}

async function canvasToBlob(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality })
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new PreprocessError('encode_failed', '이미지 변환에 실패했습니다.'))),
      'image/webp',
      quality
    )
  })
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

import { PreprocessError } from '@/lib/image/encode'
import { UploadError, uploadFile, type UploadOptions } from '@/lib/image/upload'

/**
 * 업로드 UI 두 곳(대표 이미지·갤러리)이 공유하는 조각.
 *
 * 브라우저 전용이다 — `lib/image/*` 는 canvas 와 fetch 를 쓴다.
 * 실제 전처리·서명·PUT·확정 순서는 전부 `lib/image/upload.ts` 가 갖고 있고,
 * 여기서는 **화면에 보여 줄 형태**로만 감싼다.
 */

/** 폼이 들고 있는 미디어 한 장. 서버 DAL 의 `AdminMediaRef` 가 그대로 대입된다. */
export type MediaPreview = {
  id: string
  url: string
  filename: string | null
  width: number | null
  height: number | null
  /**
   * 확정된 Content-Type. **optional 이다** — 서버 DAL(`AdminMediaRef`·`listPanelMediaChoices`)은
   * 이 컬럼을 select 하지 않으므로 그 경로로 들어온 미디어에는 값이 없다.
   * 그래서 `isVideoMedia()` 가 없을 때의 판정까지 함께 갖는다.
   */
  mime?: string
}

/**
 * 이 미디어를 `<video>` 로 그려야 하는가. **미리보기 전용 판정이다.**
 *
 * `mime` 이 있으면 그것이 정답이다(`/confirm` 이 매직 넘버로 확인한 값).
 * 없으면 원본 파일명 확장자로 본다 — 업로드 정책이 영상에 `.mp4` 를 강제하므로
 * 우리가 만든 행에서는 이 추론이 항상 맞는다. 틀려도 결과는 관리 화면 썸네일 한 칸이고,
 * 공개 화면은 `lib/panels.ts` 가 실제 `media.mime` 을 읽어 판정한다.
 */
export function isVideoMedia(m: { mime?: string | undefined; filename: string | null }): boolean {
  if (m.mime !== undefined && m.mime !== '') return m.mime.startsWith('video/')
  return /\.mp4$/i.test(m.filename ?? '')
}

export async function uploadOne(file: File, options: UploadOptions): Promise<MediaPreview> {
  const result = await uploadFile(file, options)
  return {
    id: result.mediaId,
    url: result.url,
    filename: file.name,
    width: result.width,
    height: result.height,
    mime: result.mime,
  }
}

/**
 * 실패 사유를 한국어 한 문장으로.
 *
 * `PreprocessError`·`UploadError` 는 이미 사용자용 문구를 들고 있다(서버가 내려준 문구 포함).
 * 그 밖의 예외는 **메시지를 그대로 쓰지 않는다** — `TypeError: Failed to fetch` 같은 문자열이
 * 화면에 뜨면 사용자는 무엇을 해야 할지 알 수 없고, 내부 사정이 새어 나갈 수도 있다.
 */
export function describeUploadFailure(err: unknown): string {
  if (err instanceof PreprocessError || err instanceof UploadError) return err.message
  if (err instanceof DOMException && err.name === 'AbortError') return '업로드를 취소했습니다.'
  if (err instanceof TypeError) return '네트워크 오류로 업로드하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
  return '업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

/** `1600 × 900` 처럼. 둘 중 하나라도 없으면 표기하지 않는다. */
export function formatDimensions(width: number | null, height: number | null): string | null {
  return width !== null && height !== null ? `${width} × ${height}` : null
}

import type { BodyMediaKind } from '../../../web/src/components/posts/BodyMedia'

const privateMedia = /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const previews = new Map<string, { url: string; kind: BodyMediaKind; size: number }>()
const previewBudget = 64 * 1024 * 1024

export function bodyMediaFileKind(file: Pick<File, 'type' | 'name' | 'size'>): 'image' | BodyMediaKind {
  if (file.size <= 0) throw new Error('빈 파일은 업로드할 수 없습니다.')
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'image'
  if (file.type === 'application/pdf' && /\.pdf$/i.test(file.name)) {
    if (file.size > 8 * 1024 * 1024) throw new Error('PDF는 8MB 이하로 업로드하세요.')
    return 'pdf'
  }
  if (file.type === 'video/mp4' && /\.mp4$/i.test(file.name)) {
    if (file.size > 32 * 1024 * 1024) throw new Error('MP4는 32MB 이하로 업로드하세요.')
    return 'video'
  }
  throw new Error('JPG, PNG, WebP 이미지, PDF 또는 MP4 파일을 선택하세요.')
}

export function insertBodyMediaMarkdown(value: string, start: number, end: number, mediaId: string, name: string, kind: BodyMediaKind) {
  const path = `/api/media/${mediaId}`
  if (!privateMedia.test(path)) throw new Error('업로드한 파일 ID가 올바르지 않습니다.')
  const label = name.replace(/\.[^.]+$/, '').replace(/[\r\n\t]/g, ' ').trim().replace(/[\\`*_[\]<>]/g, '\\$&') || (kind === 'pdf' ? 'PDF' : '영상')
  const before = value.slice(0, start)
  const after = value.slice(end)
  const prefix = before && !before.endsWith('\n\n') ? before.endsWith('\n') ? '\n' : '\n\n' : ''
  const suffix = after && !after.startsWith('\n\n') ? after.startsWith('\n') ? '\n' : '\n\n' : ''
  const markdown = `${prefix}[${label}](${path} "icaros:${kind}")${suffix}`
  return { value: before + markdown + after, start: start + markdown.length, end: start + markdown.length }
}

/** Confirm upload before making the File available to a preview. Keep memory bounded. */
export function rememberBodyMediaPreview(mediaId: string, file: File, kind: BodyMediaKind) {
  if (bodyMediaFileKind(file) !== kind || !privateMedia.test(`/api/media/${mediaId}`)) throw new Error('본문 미디어 형식이 올바르지 않습니다.')
  const previous = previews.get(mediaId)
  if (previous) { URL.revokeObjectURL(previous.url); previews.delete(mediaId) }
  let size = [...previews.values()].reduce((sum, entry) => sum + entry.size, 0)
  for (const [id, entry] of previews) {
    if (size + file.size <= previewBudget && previews.size < 20) break
    URL.revokeObjectURL(entry.url); previews.delete(id); size -= entry.size
  }
  previews.set(mediaId, { url: URL.createObjectURL(file), kind, size: file.size })
}

export function bodyMediaPreview(path: string | undefined, kind: BodyMediaKind): string | null {
  const id = privateMedia.exec(path ?? '')?.[1]
  const entry = id ? previews.get(id) : undefined
  return entry?.kind === kind ? entry.url : null
}

export function isPrivateBodyMedia(path: string | undefined): boolean { return privateMedia.test(path ?? '') }

export const bodyMediaPreviewError = '파일 미리보기를 불러오지 못했습니다. 다시 시도해 주세요.'

export async function fetchBodyMediaUrl(path: string, kind: BodyMediaKind, signal?: AbortSignal): Promise<string> {
  try {
    const id = privateMedia.exec(path)?.[1]
    if (!id) throw new Error('Invalid media reference')
    const response = await fetch(`/api/admin/media/${id}/url`, { credentials: 'same-origin', cache: 'no-store', signal })
    if (!response.ok) throw new Error('Preview request failed')
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || ('ok' in payload && payload.ok === false) || !('data' in payload) ||
      !payload.data || typeof payload.data !== 'object' || !('url' in payload.data) || typeof payload.data.url !== 'string' ||
      !('mime' in payload.data) || payload.data.mime !== (kind === 'pdf' ? 'application/pdf' : 'video/mp4')) throw new Error('Invalid preview response')
    const value = payload.data.url
    const url = new URL(value)
    const local = url.protocol === 'http:' && ['127.0.0.1:9010', 'localhost:9010'].includes(url.host)
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.hash || /[\s\\]/.test(value)) throw new Error('Invalid preview URL')
    return url.href
  } catch {
    throw new Error(bodyMediaPreviewError)
  }
}

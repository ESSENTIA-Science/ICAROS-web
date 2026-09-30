import { useEffect, useRef, useState } from 'react'
import { resourcesApi } from '../lib/api/resources'
import type { PostAttachment } from '../lib/api/types'

export function koreaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function imageMarkdown(attachment: PostAttachment): string {
  return `![${attachment.title.replaceAll(']', '\\]')}](/api/media/${encodeURIComponent(attachment.mediaId)})`
}

export default function PostAttachments({ attachments, onChange, onInsert, disabled, showInsert = true }: {
  attachments: PostAttachment[]; onChange: (value: PostAttachment[]) => void
  onInsert: (value: string) => void; disabled: boolean; showInsert?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const previewUrls = useRef<string[]>([])
  useEffect(() => () => { for (const url of previewUrls.current) URL.revokeObjectURL(url) }, [])
  async function upload(files: FileList | null) {
    if (!files || disabled) return
    setUploading(true); setError('')
    try {
      const next = [...attachments]
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/') && file.type !== 'application/pdf' && file.type !== 'video/mp4') throw new Error('이미지, PDF 또는 MP4만 첨부할 수 있습니다.')
        if (next.length >= 20) throw new Error('첨부는 최대 20개까지 가능합니다.')
        const { id } = await resourcesApi.upload(file)
        next.push({ mediaId: id, kind: file.type === 'application/pdf' ? 'pdf' : file.type === 'video/mp4' ? 'video' : 'image', title: file.name.replace(/\.[^.]+$/, '') })
        const preview = URL.createObjectURL(file)
        previewUrls.current.push(preview)
        setPreviews(current => ({ ...current, [id]: preview }))
        onChange([...next])
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '업로드에 실패했습니다.') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }
  return <div className="postAttachments">
    <label>이미지·PDF·MP4 첨부<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4" multiple disabled={disabled || uploading} onChange={event => void upload(event.target.files)} /></label>
    {uploading && <p role="status">업로드 중…</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {attachments.map((item, index) => <div className="attachmentRow" key={`${item.mediaId}-${index}`}>
      {previews[item.mediaId]
        ? <a href={previews[item.mediaId]} target="_blank" rel="noreferrer">{item.kind === 'pdf' ? 'PDF' : item.kind === 'video' ? '영상' : '이미지'} 미리보기</a>
        : <span>{item.kind === 'pdf' ? 'PDF' : item.kind === 'video' ? '영상' : '이미지'} 첨부됨</span>}
      <input aria-label={`첨부 ${index + 1} 제목`} value={item.title} disabled={disabled || uploading} onChange={event => onChange(attachments.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry))} />
      {showInsert && item.kind === 'image' && <button type="button" disabled={disabled || uploading} onClick={() => onInsert(imageMarkdown(item))}>본문에 삽입</button>}
      <button type="button" disabled={disabled || uploading || index === 0} onClick={() => { const next = [...attachments]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; onChange(next) }}>↑</button>
      <button type="button" disabled={disabled || uploading || index === attachments.length - 1} onClick={() => { const next = [...attachments]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; onChange(next) }}>↓</button>
      <button type="button" disabled={disabled || uploading} onClick={() => onChange(attachments.filter((_, i) => i !== index))}>제거</button>
    </div>)}
  </div>
}

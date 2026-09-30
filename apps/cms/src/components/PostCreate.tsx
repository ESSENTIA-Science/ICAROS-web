import { useRef, useState } from 'react'
import PostAttachments, { koreaToday } from './PostAttachments'
import { api } from '../lib/api/client'
import type { Post, PostAttachment } from '../lib/api/types'

export default function PostCreate({ onCreated }: { onCreated: (post: Post) => void }) {
  const [title, setTitle] = useState('')
  const [bodyMd, setBodyMd] = useState('')
  const [displayDate, setDisplayDate] = useState(koreaToday)
  const [attachments, setAttachments] = useState<PostAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef<string | null>(null)
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'

  async function create() {
    if (!title.trim() || !bodyMd.trim() || !displayDate || busy || demo) return
    setBusy(true)
    setError('')
    key.current ??= crypto.randomUUID()
    try {
      const post = await api.createPost(title.trim(), bodyMd, displayDate, attachments, key.current)
      key.current = null
      setTitle('')
      setBodyMd('')
      setDisplayDate(koreaToday())
      setAttachments([])
      onCreated(post)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '초안 생성에 실패했습니다.')
    } finally { setBusy(false) }
  }

  function changeTitle(value: string) { key.current = null; setTitle(value) }
  function changeBody(value: string) { key.current = null; setBodyMd(value) }

  function insertImage(markdown: string) { changeBody(`${bodyMd}${bodyMd && !bodyMd.endsWith('\n') ? '\n' : ''}${markdown}\n`) }

  return <section className="card editor" aria-label="새 게시글 초안">
    <div className="cardHead"><h3>새 게시글</h3></div>
    <p className="hint">작성자 표시는 서버에서 지정합니다.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="fields"><label>제목<input value={title} onChange={event => changeTitle(event.target.value)} /></label>
      <label>표시 날짜<input type="date" value={displayDate} disabled={demo || busy} onChange={event => { key.current = null; setDisplayDate(event.target.value) }} required /></label>
      <label>본문 (Markdown)<textarea rows={12} value={bodyMd} onChange={event => changeBody(event.target.value)} /></label></div>
    <PostAttachments attachments={attachments} onChange={value => { key.current = null; setAttachments(value) }} onInsert={insertImage} disabled={demo || busy} />
    <div className="actions"><button className="primary" type="button" onClick={() => void create()} disabled={demo || busy || !title.trim() || !bodyMd.trim() || !displayDate}>{busy ? '생성 중…' : '초안 생성'}</button></div>
  </section>
}

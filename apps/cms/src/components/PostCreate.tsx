import { useEffect, useRef, useState } from 'react'
import { koreaToday } from './PostAttachments'
import { api } from '../lib/api/client'
import { editable } from '../lib/editor'
import { useAutosave } from '../lib/useAutosave'
import { noteCmsChange } from '../lib/cmsChanges'
import type { Post, PostAttachment } from '../lib/api/types'
import MarkdownField from './MarkdownField'

type Draft = { title: string; bodyMd: string; displayDate: string; attachments: PostAttachment[] }
type LocalDraft = { draft: Draft; key: string; attempt: Draft | null }
const storageKey = 'icaros:post-create'
function initialDraft(): LocalDraft {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as LocalDraft | null
    if (stored && typeof stored.key === 'string' && typeof stored.draft?.title === 'string' &&
      typeof stored.draft.bodyMd === 'string' && typeof stored.draft.displayDate === 'string' && Array.isArray(stored.draft.attachments)) return stored
  } catch { /* Storage can be unavailable. Keep the in-memory draft. */ }
  return { draft: { title: '', bodyMd: '', displayDate: koreaToday(), attachments: [] }, key: crypto.randomUUID(), attempt: null }
}

export default function PostCreate({ onCreated }: { onCreated: (post: Post) => void }) {
  const [local, setLocal] = useState(initialDraft)
  const latest = useRef(local)
  const record = useRef<Post | null>(null)
  const request = useRef<Promise<void> | null>(null)
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  const { title, bodyMd, displayDate, attachments } = local.draft
  const dirty = !completed && (!!title || !!bodyMd || attachments.length > 0 || displayDate !== koreaToday() || !!local.attempt)
  const valid = !!title.trim() && !!bodyMd.trim() && /^\d{4}-\d{2}-\d{2}$/.test(displayDate)
  function persist(value: LocalDraft) {
    try { localStorage.setItem(storageKey, JSON.stringify(value)) }
    catch { setError('브라우저에 입력 내용을 보관하지 못했습니다. 이 화면을 유지해 주세요.') }
  }
  useEffect(() => {
    if (dirty && !demo) {
      try { localStorage.setItem(storageKey, JSON.stringify(local)) } catch { /* Report on the next edit. */ }
    }
  }, [local, dirty, demo])
  function change(patch: Partial<Draft>) {
    const next = { ...latest.current, draft: { ...latest.current.draft, ...patch } }
    latest.current = next; setLocal(next); persist(next)
  }
  async function saveDraft() {
    if (request.current) return request.current
    const task = async () => {
      if (demo) throw new Error('읽기 전용입니다.')
      const current = latest.current.draft
      if (!current.title.trim() || !current.bodyMd.trim() || !current.displayDate) throw new Error('제목·날짜·본문을 입력하거나 입력을 취소하세요.')
      setBusy(true); setError('')
      try {
        if (!record.current) {
          // Freeze both the key and payload across edits and uncertain retries.
          const attempt = latest.current.attempt ?? { ...current, title: current.title.trim() }
          const next = { ...latest.current, attempt }
          latest.current = next; setLocal(next); persist(next)
          record.current = await api.createPost(attempt.title, attempt.bodyMd, attempt.displayDate, attempt.attachments, next.key)
        }
        let saved = record.current
        for (;;) {
          const draft = latest.current.draft
          if (!draft.title.trim() || !draft.bodyMd.trim() || !draft.displayDate) throw new Error('제목·날짜·본문을 입력하세요.')
          const payload = { ...editable('posts', saved), ...draft, title: draft.title.trim() }
          if (JSON.stringify(payload) !== JSON.stringify(editable('posts', saved))) {
            saved = await api.save('posts', saved.id, saved.version, payload)
            record.current = saved
          }
          if (draft === latest.current.draft) break
        }
        setCompleted(true)
        try { localStorage.removeItem(storageKey) } catch { /* The server draft is saved. */ }
        onCreated(saved)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '초안 생성에 실패했습니다.')
        throw cause
      } finally { setBusy(false) }
    }
    request.current = task()
    try { await request.current } finally { request.current = null }
  }
  const autosave = useAutosave({ key: `post-create:${local.key}`, dirty, enabled: !demo && valid && !completed, fingerprint: JSON.stringify(local.draft), save: saveDraft })
  function cancel() {
    if (busy) return
    if (record.current) {
      // A failed follow-up save can leave a successfully created private draft.
      setCompleted(true)
      try { localStorage.removeItem(storageKey) } catch { /* The server draft is retained. */ }
      noteCmsChange()
      onCreated(record.current)
      return
    }
    const next = { draft: { title: '', bodyMd: '', displayDate: koreaToday(), attachments: [] }, key: crypto.randomUUID(), attempt: null }
    latest.current = next; setLocal(next); setError('')
    try { localStorage.removeItem(storageKey) } catch { /* No pending server mutation. */ }
  }
  return <section className="card editor" aria-label="새 게시글 초안">
    <div className="cardHead"><h3>새 게시글</h3></div>
    <p className="hint">제목·날짜·본문을 입력하면 초안을 자동 생성합니다. 미완성 입력은 이 브라우저에 보관합니다. 작성자 표시는 서버에서 지정합니다.</p>
    {(error || autosave.error) && <p className="notice error" role="alert">{error || autosave.error}</p>}
    <p className="hint" role="status">{busy ? '초안 저장 중…' : dirty && !valid ? '필수 항목을 입력하거나 입력을 취소해야 ‘변경사항 반영하기’를 사용할 수 있습니다.' : autosave.status === 'pending' ? '자동 저장 대기 중…' : ''}</p>
    <div className="fields"><label>제목<input value={title} disabled={demo || completed} onChange={event => change({ title: event.target.value })} /></label>
      <label>표시 날짜<input type="date" value={displayDate} disabled={demo || completed} onChange={event => change({ displayDate: event.target.value })} required /></label>
      <MarkdownField label="본문 (Markdown)" rows={12} value={bodyMd} onChange={value => change({ bodyMd: value })} disabled={demo || completed} /></div>
    <div className="actions"><button className="primary" type="button" onClick={() => void autosave.flush().catch(() => {})} disabled={demo || busy || !valid || completed}>{busy ? '생성 중…' : '초안 생성'}</button><button type="button" disabled={busy || completed} onClick={cancel}>입력 취소</button></div>
  </section>
}

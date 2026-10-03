import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api/client'
import { editable } from '../lib/editor'
import type { Post, PostAttachment } from '../lib/api/types'
import PostAttachments from './PostAttachments'
import { useAutosave } from '../lib/useAutosave'
import { flushCmsChanges } from '../lib/cmsChanges'

export default function AttachmentsEditor() {
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  const [posts, setPosts] = useState<Post[]>([])
  const [selected, setSelected] = useState('')
  const [attachments, setAttachments] = useState<PostAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const active = posts.find(post => post.id === selected)
  const autosave = useAutosave({
    key: `post-attachments:${selected}`, dirty: !!active && JSON.stringify(attachments) !== JSON.stringify(active.attachments),
    enabled: !demo && !!active, fingerprint: JSON.stringify(attachments), save,
  })
  async function leave(action: () => void | Promise<void>) {
    if (busy) return
    try { await autosave.flush(); await flushCmsChanges(); await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '첨부 변경 사항을 저장하지 못했습니다.') }
  }
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const records = await api.list('posts')
      setPosts(records)
      const next = records[0]
      setSelected(next?.id ?? '')
      setAttachments(next?.attachments.map(item => ({ ...item })) ?? [])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '게시글을 불러오지 못했습니다.') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { queueMicrotask(() => void load()) }, [load])
  function select(post: Post) { if (post.id === selected) return; setSelected(post.id); setAttachments(post.attachments.map(item => ({ ...item }))); setError(''); setMessage('') }
  async function save() {
    if (!active || demo) throw new Error('저장할 게시글이 없습니다.')
    setError(''); setMessage('')
    try {
      const saved = await api.save('posts', active.id, active.version, { ...editable('posts', active), attachments })
      setPosts(previous => previous.map(post => post.id === saved.id ? saved : post))
      setMessage('첨부 변경 사항이 게시글 초안에 저장되었습니다. 상단의 ‘변경사항 반영하기’로 사이트에 반영할 수 있습니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '첨부 저장에 실패했습니다.'); throw cause }
  }
  return <div className="workspace"><aside className="card list"><h2>게시글 <span className="count">{posts.length}</span></h2><button type="button" disabled={busy} onClick={() => void leave(load)}>새로고침</button><div className="listItems">{posts.map(post => <button key={post.id} className="listItem" aria-current={selected === post.id ? 'true' : undefined} disabled={busy} onClick={() => void leave(() => select(post))}><strong>{post.title}</strong><small>첨부 {post.attachments.length}개</small></button>)}</div></aside><section className="card editor"><h3>{active?.title ?? '게시글을 선택하세요'}</h3><p className="hint">이미지·PDF·MP4를 업로드하고 순서·제목을 정리합니다. 상단의 ‘변경사항 반영하기’에서 저장된 변경을 함께 반영합니다.</p>{demo && <p className="notice">로컬 DB 미리보기는 읽기 전용입니다.</p>}{autosave.error && <p className="notice error" role="alert">{autosave.error}</p>}<p className="hint" role="status">{autosave.status === 'saving' ? '자동 저장 중…' : autosave.status === 'pending' ? '자동 저장 대기 중…' : autosave.status === 'saved' ? '자동 저장됨' : ''}</p>{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}{active && <><PostAttachments attachments={attachments} onChange={setAttachments} onInsert={() => {}} disabled={demo || busy} showInsert={false} /></>}</section></div>
}

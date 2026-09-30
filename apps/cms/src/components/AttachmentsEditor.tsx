import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api/client'
import { editable } from '../lib/editor'
import type { Post, PostAttachment } from '../lib/api/types'
import PostAttachments from './PostAttachments'
import { publishDraft } from '../lib/api/publish'
import type { PublishJob } from '../lib/api/types'

export default function AttachmentsEditor() {
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  const [posts, setPosts] = useState<Post[]>([])
  const [selected, setSelected] = useState('')
  const [attachments, setAttachments] = useState<PostAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [job, setJob] = useState<PublishJob | null>(null)
  const active = posts.find(post => post.id === selected)
  useEffect(() => {
    if (!job || job.state === 'published' || job.state === 'failed') return
    const timer = window.setInterval(async () => {
      try {
        const next = await api.publishStatus(job.id)
        setJob(next)
        if (next.state === 'published') setMessage('사이트 전체 게시 빌드가 완료되었습니다.')
        else if (next.state === 'failed') setError(next.failureMessage || '게시 빌드에 실패했습니다.')
      } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 상태를 확인하지 못했습니다.'); setJob(null) }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [job])
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
  function select(post: Post) { setSelected(post.id); setAttachments(post.attachments.map(item => ({ ...item }))); setError(''); setMessage(''); setJob(null) }
  async function save() {
    if (!active || demo || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const saved = await api.save('posts', active.id, active.version, { ...editable('posts', active), attachments })
      setPosts(previous => previous.map(post => post.id === saved.id ? saved : post))
      setAttachments(saved.attachments.map(item => ({ ...item })))
      setMessage('첨부 변경 사항이 게시글 초안에 저장되었습니다. 사이트 전체 게시 빌드 후 공개됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '첨부 저장에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function publish() {
    if (!active || demo || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const started = await publishDraft('posts', active.id, active.version)
      setJob(started)
      if (started.state === 'failed') setError(started.failureMessage || '게시 빌드에 실패했습니다.')
      else setMessage('사이트 전체 게시 작업을 접수했습니다. 저장된 다른 변경 사항도 함께 빌드됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 요청에 실패했습니다.') }
    finally { setBusy(false) }
  }
  return <div className="workspace"><aside className="card list"><h2>게시글 <span className="count">{posts.length}</span></h2><button type="button" disabled={busy} onClick={() => void load()}>새로고침</button><div className="listItems">{posts.map(post => <button key={post.id} className="listItem" aria-current={selected === post.id ? 'true' : undefined} onClick={() => select(post)}><strong>{post.title}</strong><small>첨부 {post.attachments.length}개</small></button>)}</div></aside><section className="card editor"><h3>{active?.title ?? '게시글을 선택하세요'}</h3><p className="hint">이미지·PDF·MP4를 업로드하고 순서·제목을 정리합니다. 저장된 다른 변경도 사이트 전체 게시 빌드에 포함됩니다.</p>{demo && <p className="notice">로컬 DB 미리보기는 읽기 전용입니다.</p>}{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}{active && <><PostAttachments attachments={attachments} onChange={setAttachments} onInsert={() => {}} disabled={demo || busy} showInsert={false} /><div className="actions"><button type="button" className="primary" disabled={demo || busy || JSON.stringify(attachments) === JSON.stringify(active.attachments)} onClick={() => void save()}>{busy ? '저장 중…' : '첨부 초안 저장'}</button><button type="button" disabled={demo || busy || job?.state === 'publishing' || JSON.stringify(attachments) !== JSON.stringify(active.attachments)} onClick={() => void publish()}>사이트 전체 게시</button></div></>}</section></div>
}

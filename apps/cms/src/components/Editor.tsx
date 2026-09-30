import { useEffect, useState } from 'react'
import { api } from '../lib/api/client'
import { forgetPublicationKey, publishDraft } from '../lib/api/publish'
import type { ContentKind, ContentMap, Editable, PublishJob } from '../lib/api/types'
import { editable, isDirty, publicationLabel } from '../lib/editor'
import Preview from './Preview'
import PostAttachments from './PostAttachments'
import { resourcesApi } from '../lib/api/resources'

const fields = {
  rockets: [
    ['name', '이름'], ['series', '시리즈'], ['maxAltitudeM', '최대 고도 (m)'],
    ['sizeM', '전장 (m)'], ['payloadKg', '페이로드 (kg)'], ['descriptionMd', '설명 (Markdown)'],
  ],
  site: [['value', '설정 값']],
  posts: [['title', '제목'], ['displayDate', '표시 날짜'], ['bodyMd', '본문 (Markdown)']],
} as const

export default function Editor<K extends ContentKind>({ kind, record, onSaved }: {
  kind: K; record: ContentMap[K]; onSaved: (record: ContentMap[K]) => void
}) {
  const [draft, setDraft] = useState<Editable<K>>(() => editable(kind, record))
  const [job, setJob] = useState<PublishJob | null>(null)
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const dirty = isDirty(kind, record, draft)
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'

  useEffect(() => {
    if (!job || job.state === 'failed' || (job.state === 'published' && record.publishState === 'published')) return
    const timer = window.setInterval(async () => {
      try {
        const next = await api.publishStatus(job.id)
        setJob(next)
        if (next.state === 'published') {
          forgetPublicationKey(kind, record.id, record.version)
          onSaved({ ...record, publishState: 'published' })
          setMessage('공개 HTML 빌드가 완료되었습니다.')
        } else if (next.state === 'failed') setError(next.failureMessage || '게시 빌드에 실패했습니다.')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '게시 상태를 확인할 수 없습니다.')
        setJob(null)
      }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [job, kind, onSaved, record])

  async function save() {
    setBusy('save'); setError(''); setMessage('')
    try {
      const saved = await api.save(kind, record.id, record.version, draft)
      forgetPublicationKey(kind, record.id, record.version)
      onSaved(saved)
      setDraft(editable(kind, saved))
      setMessage('초안이 저장되었습니다. 공개 사이트는 게시 완료 후 갱신됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.') }
    finally { setBusy(null) }
  }

  async function publish() {
    setBusy('publish'); setError(''); setMessage('')
    try {
      const started = await publishDraft(kind, record.id, record.version)
      setJob(started)
      if (started.state === 'failed') setError(started.failureMessage || '게시 빌드에 실패했습니다.')
      else setMessage('게시 작업을 접수했습니다. 상태 조회에서 빌드 완료를 확인할 때까지 공개로 표시하지 않습니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 요청에 실패했습니다.') }
    finally { setBusy(null) }
  }
  async function uploadCover(file: File) {
    setBusy('save'); setError(''); setMessage('')
    try {
      const media = await resourcesApi.upload(file)
      setDraft(previous => ({ ...previous, coverMediaId: media.id }))
      setMessage('대표 이미지가 업로드되었습니다. 초안 저장 후 사이트 전체 게시를 진행하세요.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '이미지 업로드에 실패했습니다.') }
    finally { setBusy(null) }
  }

  const status = job?.state === 'published' && record.publishState !== 'published' ? 'publishing' : job?.state ?? (dirty ? 'draft_saved' : record.publishState)
  return <div className="editorGrid">
    <section className="card editor" aria-label="콘텐츠 편집">
      <div className="cardHead"><h3>편집</h3><span className="mono">{record.id}</span></div>
      <p className="hint">변경 사항은 오른쪽 미리보기에 즉시 반영됩니다. 사이트 전체 게시를 누르면 저장된 다른 수정도 함께 빌드되어 공개됩니다.</p>
      {kind === 'posts' && <p className="hint">작성자 표시는 ESSENTIA가 관리합니다.</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      <div className="fields">{(fields as Partial<Record<ContentKind, readonly (readonly [string, string])[]>>)[kind]?.map(([field, label]) => {
        const value = String(draft[field as keyof Editable<K>] ?? '')
        const large = ['descriptionMd', 'bodyMd', 'value'].includes(field)
        return <label key={field}>{label}
          {large ? <textarea rows={field === 'bodyMd' ? 12 : 5} value={value} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />
            : <input type={field === 'displayDate' ? 'date' : 'text'} value={value} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />}
        </label>
      })}</div>
      {kind === 'rockets' && <div className="fields"><label>대표 이미지<input readOnly value={String((draft as Editable<'rockets'>).coverMediaId ?? '')} /><input aria-label="대표 이미지 업로드" type="file" accept="image/jpeg,image/png,image/webp" disabled={demo || busy !== null} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadCover(file); event.target.value = '' }} /></label><button type="button" disabled={demo || busy !== null || !(draft as Editable<'rockets'>).coverMediaId} onClick={() => setDraft({ ...draft, coverMediaId: null })}>대표 이미지 연결 해제</button></div>}
      {kind === 'posts' && <PostAttachments attachments={(draft as Editable<'posts'>).attachments} onChange={attachments => setDraft({ ...draft, attachments })} onInsert={markdown => { const body = (draft as Editable<'posts'>).bodyMd; setDraft({ ...draft, bodyMd: `${body}${body && !body.endsWith('\n') ? '\n' : ''}${markdown}\n` }) }} disabled={demo || busy !== null} />}
      <div className="actions"><button className="primary" type="button" onClick={save} disabled={demo || !dirty || busy !== null}>{busy === 'save' ? '저장 중…' : '초안 저장'}</button>
        <button type="button" onClick={publish} disabled={demo || dirty || busy !== null || status === 'publishing'}>{busy === 'publish' ? '요청 중…' : '사이트 전체 게시'}</button></div>
      {dirty && <p className="hint">게시하려면 먼저 초안을 저장하세요.</p>}
    </section>
    <aside className="card preview" aria-label="초안 미리보기"><div className="cardHead"><h3>Draft preview</h3><span className="badge" data-state={status}>{publicationLabel(status)}</span></div><p className="hint">편집 중인 입력값입니다. 공개 페이지를 대체하지 않습니다.</p><Preview kind={kind} draft={draft} /></aside>
  </div>
}

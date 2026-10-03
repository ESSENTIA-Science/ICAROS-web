import { useEffect, useState } from 'react'
import { api } from '../lib/api/client'
import {
  completeCmsPublication, failCmsPublication, flushCmsChanges, getCmsChanges,
  hasUnpublishedChanges, startCmsPublication, useCmsChanges,
} from '../lib/cmsChanges'

export function warnBeforeLeaving(event: BeforeUnloadEvent, posting = false) {
  if (!posting && !hasUnpublishedChanges()) return
  event.preventDefault()
  event.returnValue = ''
}

export default function PublicationControls() {
  const changes = useCmsChanges()
  const [open, setOpen] = useState(false)
  const [posting, setPosting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => warnBeforeLeaving(event, posting)
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [posting])
  useEffect(() => {
    if (!changes.jobId) return
    const jobId = changes.jobId
    let cancelled = false
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const job = await api.publishStatus(jobId)
        if (cancelled) return
        if (job.state === 'published') {
          completeCmsPublication(jobId)
          setMessage('변경사항이 사이트에 반영되었습니다.')
          setError('')
        } else if (job.state === 'failed') {
          failCmsPublication(jobId)
          setError(job.failureMessage || '반영에 실패했습니다. 변경사항은 저장되어 있습니다. 다시 시도해 주세요.')
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '반영 상태를 확인하지 못했습니다. 페이지를 유지하고 기다려 주세요.')
      } finally { checking = false }
    }
    void check()
    const timer = window.setInterval(() => void check(), 4000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [changes.jobId])

  async function reflectChanges() {
    if (posting || changes.jobId || demo) return
    setPosting(true); setError(''); setMessage('자동 저장을 완료하고 반영을 요청하는 중입니다.')
    try {
      await flushCmsChanges()
      const revision = getCmsChanges().revision
      const settings = await api.list('site')
      const trigger = settings.find(setting => setting.id === 'donation.current') ?? settings[0]
      if (!trigger) throw new Error('사이트 설정이 없어 반영을 요청할 수 없습니다.')
      // Keep retries stable when the response is lost, without reusing a prior successful build.
      const key = `icaros:cms:reflect:${revision}:${trigger.version}`
      const idempotencyKey = sessionStorage.getItem(key) ?? crypto.randomUUID()
      sessionStorage.setItem(key, idempotencyKey)
      const job = await api.publish('site', trigger.id, trigger.version, idempotencyKey, 'all')
      startCmsPublication(job.id, revision, key)
      if (job.state === 'published') {
        completeCmsPublication(job.id)
        sessionStorage.removeItem(key)
        setMessage('변경사항이 사이트에 반영되었습니다.')
      } else if (job.state === 'failed') {
        failCmsPublication(job.id)
        sessionStorage.removeItem(key)
        throw new Error(job.failureMessage || '반영에 실패했습니다. 다시 시도해 주세요.')
      } else setMessage('사이트 반영 중입니다. 완료될 때까지 이 페이지를 닫지 마세요.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '반영 요청에 실패했습니다.') }
    finally { setPosting(false) }
  }
  const building = posting || changes.jobId !== null
  const pending = changes.revision > changes.publishedRevision || changes.pending > 0
  return <div className="publicationControls">
    <span role="status" className="publicationStatus">{building ? '사이트 반영 중' : changes.errors.length ? '자동 저장 오류' : changes.pending ? '자동 저장 중…' : pending ? '저장됨 · 사이트 미반영' : '모든 변경사항 반영됨'}</span>
    <button className="primary" type="button" disabled={demo || building} onClick={() => { setOpen(true); setError(''); setMessage('') }}>{building ? '반영 중…' : '변경사항 반영하기'}</button>
    {open && <div className="publicationBackdrop"><section className="card publicationDialog" role="dialog" aria-modal="true" aria-labelledby="publication-title">
      <h2 id="publication-title">변경사항 반영하기</h2>
      <p>자동 저장된 변경사항을 모아 전체 사이트에 반영합니다.</p>
      <p>반영에는 보통 5~8분이 걸리며 빌드 상황에 따라 더 걸릴 수 있습니다. 상태는 이 브라우저에서 다시 확인할 수 있습니다.</p>
      <p>게시글은 ESSENTIA 커뮤니티에 먼저 공개됩니다. ICAROS 웹은 빌드가 완료된 뒤 갱신됩니다.</p>
      <p className="hint">반영 중 추가로 수정한 내용은 다음 반영에 포함됩니다.</p>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><button type="button" disabled={building} onClick={() => setOpen(false)}>{message && !pending ? '닫기' : '취소'}</button><button className="primary" type="button" disabled={building || (message === '변경사항이 사이트에 반영되었습니다.' && !pending)} onClick={() => void reflectChanges()}>{building ? '반영 중…' : '전체 사이트 반영'}</button></div>
    </section></div>}
    {!open && error && <p className="notice error" role="alert">{error}</p>}
  </div>
}

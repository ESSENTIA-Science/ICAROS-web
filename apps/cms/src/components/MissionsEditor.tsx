import { useCallback, useEffect, useState } from 'react'
import { resourcesApi } from '../lib/api/resources'
import { api } from '../lib/api/client'
import { publishDraft, forgetPublicationKey } from '../lib/api/publish'
import type { PublishJob } from '../lib/api/types'
import type { ResourceRecord } from '../lib/resources'

const outcomes = { planned: '예정', success: '성공', partial: '부분 성공', failure: '실패' } as const
const empty = (): Partial<ResourceRecord> => ({ title: '', launchDate: '', vehicleId: '', location: '', outcome: 'planned', summary: '', bodyMd: '', coverMediaId: null, published: false })

export default function MissionsEditor() {
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  const [items, setItems] = useState<ResourceRecord[]>([])
  const [vehicles, setVehicles] = useState<ResourceRecord[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<ResourceRecord>>(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [job, setJob] = useState<PublishJob | null>(null)
  const active = items.find(item => item.id === selected)
  useEffect(() => {
    if (!job || job.state === 'published' || job.state === 'failed') return
    const timer = window.setInterval(async () => {
      try {
        const next = await api.publishStatus(job.id)
        setJob(next)
        if (next.state === 'published') { if (active) forgetPublicationKey('missions', active.id, active.version); setMessage('사이트 전체 게시 빌드가 완료되었습니다.') }
        else if (next.state === 'failed') setError(next.failureMessage || '게시 빌드에 실패했습니다.')
      } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 상태를 확인하지 못했습니다.'); setJob(null) }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [job, active])
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const [missions, vehicleList] = await Promise.all([resourcesApi.list('missions'), demo ? resourcesApi.list('vehicles') : api.list('rockets')])
      setItems(missions); setVehicles(vehicleList)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '목록을 불러오지 못했습니다.') }
    finally { setBusy(false) }
  }, [demo])
  useEffect(() => { queueMicrotask(() => void load()) }, [load])
  function select(item: ResourceRecord | null) { setSelected(item?.id ?? null); setDraft(item ? { ...item } : empty()); setError(''); setMessage(''); setJob(null) }
  async function publish() {
    if (!active || demo || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const started = await publishDraft('missions', active.id, active.version)
      setJob(started)
      if (started.state === 'failed') setError(started.failureMessage || '게시 빌드에 실패했습니다.')
      else setMessage('사이트 전체 게시 작업을 접수했습니다. 저장된 다른 변경 사항도 함께 빌드됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 요청에 실패했습니다.') }
    finally { setBusy(false) }
  }
  function set<K extends keyof ResourceRecord>(key: K, value: ResourceRecord[K]) { setDraft(previous => ({ ...previous, [key]: value })) }
  function payload() {
    return { title: draft.title?.trim(), launchDate: draft.launchDate, vehicleId: draft.vehicleId || null, location: draft.location?.trim(), outcome: draft.outcome, summary: draft.summary?.trim(), bodyMd: draft.bodyMd, coverMediaId: draft.coverMediaId || null, published: draft.published ?? false }
  }
  async function save() {
    if (demo || !draft.title?.trim() || !draft.launchDate || !draft.location?.trim()) { setError('제목, 발사 날짜, 장소를 입력하세요.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const result = active ? await resourcesApi.update('missions', active.id, active.version, payload()) : await resourcesApi.create('missions', payload())
      setItems(previous => active ? previous.map(item => item.id === result.id ? result : item) : [result, ...previous])
      select(result); setMessage('미션이 저장되었습니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!active || demo || !window.confirm(`‘${active.title}’ 미션을 삭제할까요?`)) return
    setBusy(true); setError(''); setMessage('')
    try { await resourcesApi.remove('missions', active.id, active.version); setItems(previous => previous.filter(item => item.id !== active.id)); select(null); setMessage('미션이 삭제되었습니다.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '삭제에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function upload(file: File) {
    if (demo) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('이미지는 JPEG, PNG, WebP만 업로드할 수 있습니다.'); return }
    setBusy(true); setError('')
    try { const media = await resourcesApi.upload(file); set('coverMediaId', media.id); setMessage('표지 이미지가 업로드되었습니다. 저장하면 미션에 연결됩니다.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '업로드에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function uploadBody(file: File) {
    if (demo) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) { setError('이미지 또는 PDF만 추가할 수 있습니다.'); return }
    setBusy(true); setError('')
    try {
      const media = await resourcesApi.upload(file)
      const label = file.name.replaceAll(']', '\\]')
      const path = `/api/media/${encodeURIComponent(media.id)}`
      const markdown = file.type === 'application/pdf' ? `[${label}](${path})` : `![${label}](${path})`
      setDraft(previous => ({ ...previous, bodyMd: `${previous.bodyMd ?? ''}${previous.bodyMd && !previous.bodyMd.endsWith('\n') ? '\n' : ''}${markdown}\n` }))
      setMessage('본문에 파일을 추가했습니다. 저장 후 공개 빌드에서 반영됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '파일 추가에 실패했습니다.') }
    finally { setBusy(false) }
  }
  const disabled = demo || busy
  return <div className="workspace"><aside className="card list"><h2>미션 목록 <span className="count">{items.length}</span></h2><button type="button" disabled={disabled} onClick={() => select(null)}>새 미션</button><button type="button" disabled={busy} onClick={() => void load()}>새로고침</button><div className="listItems">{items.map(item => <button type="button" className="listItem" key={item.id} aria-current={selected === item.id ? 'true' : undefined} onClick={() => select(item)}><strong>{item.title || item.id}</strong><small>{item.launchDate} · {item.outcome ? outcomes[item.outcome] : ''}{item.published ? ' · 공개' : ' · 비공개'}</small></button>)}</div></aside>
    <section className="card editor"><div className="cardHead"><h3>{active ? '미션 편집' : '새 미션'}</h3></div>{demo && <p className="notice" role="status">로컬 DB 미리보기는 읽기 전용입니다.</p>}{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
      <div className="fields"><label>제목<input disabled={disabled} value={draft.title ?? ''} onChange={event => set('title', event.target.value)} /></label><label>발사 날짜<input type="date" disabled={disabled} value={draft.launchDate?.slice(0, 10) ?? ''} onChange={event => set('launchDate', event.target.value)} /></label><label>기체<select disabled={disabled} value={draft.vehicleId ?? ''} onChange={event => set('vehicleId', event.target.value)}><option value="">선택 안 함</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name || vehicle.title || vehicle.id}</option>)}</select></label><label>장소<input disabled={disabled} value={draft.location ?? ''} onChange={event => set('location', event.target.value)} /></label><label>결과<select disabled={disabled} value={draft.outcome ?? 'planned'} onChange={event => set('outcome', event.target.value as ResourceRecord['outcome'])}>{Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>요약<textarea disabled={disabled} value={draft.summary ?? ''} onChange={event => set('summary', event.target.value)} /></label><label>본문 (Markdown)<textarea disabled={disabled} rows={12} value={draft.bodyMd ?? ''} onChange={event => set('bodyMd', event.target.value)} /></label><label>본문 사진·PDF 추가<input aria-label="본문 파일 추가" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadBody(file); event.target.value = '' }} /></label><label>표지 이미지<input readOnly value={draft.coverMediaId ?? ''} /><input aria-label="표지 이미지 업로드" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /></label><button type="button" disabled={disabled || !draft.coverMediaId} onClick={() => set('coverMediaId', null)}>표지 연결 해제</button><label>공개 <input type="checkbox" disabled={disabled} checked={draft.published ?? false} onChange={event => set('published', event.target.checked)} /></label></div>
      <div className="card"><h3>미리보기</h3><h4>{draft.title || '제목 없음'}</h4><p>{draft.launchDate?.slice(0, 10) || '날짜 미입력'} · {draft.location || '장소 미입력'} · {outcomes[draft.outcome ?? 'planned']}</p><p>{draft.summary}</p><div className="missionBodyPreview">{draft.bodyMd || '본문 미입력'}</div><p className="hint">표지 미디어 ID: {draft.coverMediaId || '없음'} · {draft.published ? '공개' : '비공개'}</p></div>
      <div className="actions"><button className="primary" disabled={disabled} onClick={() => void save()}>{busy ? '처리 중…' : '초안 저장'}</button>{active && <button disabled={disabled || job?.state === 'publishing' || JSON.stringify(payload()) !== JSON.stringify({ title: active.title, launchDate: active.launchDate, vehicleId: active.vehicleId ?? null, location: active.location, outcome: active.outcome, summary: active.summary, bodyMd: active.bodyMd, coverMediaId: active.coverMediaId ?? null, published: active.published ?? false })} onClick={() => void publish()}>사이트 전체 게시</button>}{active && <button disabled={disabled} onClick={() => void remove()}>삭제</button>}</div>
    </section></div>
}

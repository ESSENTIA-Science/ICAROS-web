import { useCallback, useEffect, useRef, useState } from 'react'
import { resourcesApi } from '../lib/api/resources'
import { api } from '../lib/api/client'
import { useAutosave } from '../lib/useAutosave'
import { noteCmsChange } from '../lib/cmsChanges'
import type { ResourceRecord } from '../lib/resources'
import MarkdownField from './MarkdownField'
import ImagePreview from './ImagePreview'

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
  const active = items.find(item => item.id === selected)
  const records = useRef(items)
  useEffect(() => { records.current = items }, [items])
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const [missions, vehicleList] = await Promise.all([resourcesApi.list('missions'), demo ? resourcesApi.list('vehicles') : api.list('rockets')])
      setItems(missions); setVehicles(vehicleList)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '목록을 불러오지 못했습니다.') }
    finally { setBusy(false) }
  }, [demo])
  useEffect(() => { queueMicrotask(() => void load()) }, [load])
  function select(item: ResourceRecord | null) { setSelected(item?.id ?? null); setDraft(item ? { ...item } : empty()); setError(''); setMessage('') }
  function set<K extends keyof ResourceRecord>(key: K, value: ResourceRecord[K]) { setDraft(previous => ({ ...previous, [key]: value })) }
  function payload(value: Partial<ResourceRecord>) {
    return { title: value.title?.trim() ?? '', launchDate: value.launchDate?.slice(0, 10) ?? '', vehicleId: value.vehicleId || null, location: value.location?.trim() ?? '', outcome: value.outcome ?? 'planned', summary: value.summary?.trim() ?? '', bodyMd: value.bodyMd ?? '', coverMediaId: value.coverMediaId || null, published: value.published ?? false }
  }
  const date = draft.launchDate?.slice(0, 10) ?? ''
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
  const invalid = !draft.title?.trim() || !draft.location?.trim() ? '제목, 발사 날짜, 장소를 입력하세요.' : !validDate ? '올바른 발사 날짜를 입력하세요.' : (draft.title?.length ?? 0) > 200 || (draft.location?.length ?? 0) > 200 || (draft.summary?.length ?? 0) > 1000 || (draft.bodyMd?.length ?? 0) > 100000 ? '제목·장소는 200자, 요약은 1,000자, 본문은 100,000자 이내로 입력하세요.' : ''
  const dirty = JSON.stringify(payload(draft)) !== JSON.stringify(payload(active ?? empty()))
  async function save() {
    if (demo) return
    if (invalid) { setError(invalid); throw new Error(invalid) }
    setError(''); setMessage('')
    const sent = JSON.stringify(draft)
    const current = records.current.find(item => item.id === selected)
    try {
      const result = current ? await resourcesApi.update('missions', current.id, current.version, payload(draft)) : await resourcesApi.create('missions', payload(draft))
      records.current = current ? records.current.map(item => item.id === result.id ? result : item) : [result, ...records.current]
      setItems(records.current)
      setSelected(result.id)
      setDraft(previous => JSON.stringify(previous) === sent ? { ...result } : previous)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.'); throw cause }
  }
  const autosave = useAutosave({ key: `missions:${selected ?? 'new'}`, dirty, fingerprint: JSON.stringify(payload(draft)), enabled: !demo && !invalid && !busy, save })
  async function changeSelection(id: string | null) {
    try {
      if (dirty && invalid && !demo) throw new Error(invalid)
      await autosave.flush()
      select(records.current.find(item => item.id === id) ?? null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장을 완료한 후 미션을 전환하세요.') }
  }
  async function refresh() {
    try {
      if (dirty && invalid && !demo) throw new Error(invalid)
      await autosave.flush()
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장을 완료한 후 새로고침하세요.') }
  }
  async function remove() {
    if (!active || demo || !window.confirm(`‘${active.title}’ 미션을 삭제할까요?`)) return
    setError(''); setMessage('')
    try {
      await autosave.flush()
      setBusy(true)
      const current = records.current.find(item => item.id === active.id)
      if (!current) return
      await resourcesApi.remove('missions', current.id, current.version)
      noteCmsChange()
      records.current = records.current.filter(item => item.id !== current.id)
      setItems(records.current); select(null); setMessage('미션이 삭제되었습니다.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '삭제에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function upload(file: File) {
    if (demo) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('이미지는 JPEG, PNG, WebP만 업로드할 수 있습니다.'); return }
    setBusy(true); setError('')
    try { const media = await resourcesApi.upload(file); set('coverMediaId', media.id); setMessage('표지 이미지가 업로드되었습니다. 변경 사항은 자동 저장됩니다.') }
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
      setMessage('본문에 파일을 추가했습니다. 변경 사항은 자동 저장됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '파일 추가에 실패했습니다.') }
    finally { setBusy(false) }
  }
  const disabled = demo || busy
  return <div className="workspace"><aside className="card list"><h2>미션 목록 <span className="count">{items.length}</span></h2><button type="button" disabled={disabled} onClick={() => void changeSelection(null)}>새 미션</button><button type="button" disabled={busy} onClick={() => void refresh()}>새로고침</button><div className="listItems">{items.map(item => <button type="button" className="listItem" key={item.id} aria-current={selected === item.id ? 'true' : undefined} onClick={() => void changeSelection(item.id)}><strong>{item.title || item.id}</strong><small>{item.launchDate} · {item.outcome ? outcomes[item.outcome] : ''}{item.published ? ' · 공개' : ' · 비공개'}</small></button>)}</div></aside>
    <section className="card editor"><div className="cardHead"><h3>{active ? '미션 편집' : '새 미션'}</h3></div>{demo && <p className="notice" role="status">로컬 DB 미리보기는 읽기 전용입니다.</p>}{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
      <div className="fields"><label>제목<input disabled={disabled} value={draft.title ?? ''} onChange={event => set('title', event.target.value)} /></label><label>발사 날짜<input type="date" disabled={disabled} value={draft.launchDate?.slice(0, 10) ?? ''} onChange={event => set('launchDate', event.target.value)} /></label><label>기체<select disabled={disabled} value={draft.vehicleId ?? ''} onChange={event => set('vehicleId', event.target.value)}><option value="">선택 안 함</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name || vehicle.title || vehicle.id}</option>)}</select></label><label>장소<input disabled={disabled} value={draft.location ?? ''} onChange={event => set('location', event.target.value)} /></label><label>결과<select disabled={disabled} value={draft.outcome ?? 'planned'} onChange={event => set('outcome', event.target.value as ResourceRecord['outcome'])}>{Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>요약<textarea disabled={disabled} value={draft.summary ?? ''} onChange={event => set('summary', event.target.value)} /></label><MarkdownField label="본문 (Markdown)" disabled={disabled} rows={12} value={draft.bodyMd ?? ''} onChange={value => set('bodyMd', value)} /><label>본문 사진·PDF 추가<input aria-label="본문 파일 추가" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadBody(file); event.target.value = '' }} /></label><label>표지 이미지<input readOnly value={draft.coverMediaId ?? ''} /><input aria-label="표지 이미지 업로드" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /></label><ImagePreview key={draft.coverMediaId ?? 'none'} mediaId={draft.coverMediaId} alt="미션 표지 이미지 미리보기" /><button type="button" disabled={disabled || !draft.coverMediaId} onClick={() => set('coverMediaId', null)}>표지 연결 해제</button><label>공개 <input type="checkbox" disabled={disabled} checked={draft.published ?? false} onChange={event => set('published', event.target.checked)} /></label></div>
      <div className="card"><h3>미리보기</h3><h4>{draft.title || '제목 없음'}</h4><p>{draft.launchDate?.slice(0, 10) || '날짜 미입력'} · {draft.location || '장소 미입력'} · {outcomes[draft.outcome ?? 'planned']}</p><p>{draft.summary}</p><div className="missionBodyPreview">{draft.bodyMd || '본문 미입력'}</div><p className="hint">표지 미디어 ID: {draft.coverMediaId || '없음'} · {draft.published ? '공개' : '비공개'}</p></div>
      {!demo && <p className="hint" role="status">{invalid && dirty ? invalid : { idle: '자동 저장 대기', pending: '저장 대기 중…', saving: '저장 중…', saved: '자동 저장됨', error: '자동 저장 실패' }[autosave.status]}</p>}
      {autosave.error && <p className="notice error" role="alert">{autosave.error}</p>}
      <div className="actions">{!active && <button className="primary" disabled={disabled} onClick={() => { if (invalid) setError(invalid); else void autosave.flush().catch(cause => setError(cause instanceof Error ? cause.message : '생성에 실패했습니다.')) }}>미션 생성</button>}{active && <button disabled={disabled} onClick={() => void remove()}>삭제</button>}</div>
    </section></div>
}

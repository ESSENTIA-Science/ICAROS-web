import { useCallback, useEffect, useRef, useState } from 'react'
import { resourcesApi } from '../lib/api/resources'
import { api } from '../lib/api/client'
import { publishDraft, forgetPublicationKey, type PublishKind } from '../lib/api/publish'
import type { PublishJob } from '../lib/api/types'
import { fields, resourceLabels, type ResourceKind, type ResourceRecord } from '../lib/resources'

const supportedWrites = new Set<ResourceKind>(['departments', 'members', 'vehicle-types', 'vehicle-series', 'panels', 'donation-rounds'])
const mediaKinds = ['image', 'video', 'pdf', 'model'] as const
function initial(kind: ResourceKind): Partial<ResourceRecord> {
  return kind === 'panels' ? { mediaKind: 'image', position: 0, published: false } : kind === 'vehicles' ? { galleryMediaIds: [], modelMediaId: null, published: false, position: 0 } : kind === 'post-attachments' ? { mediaKind: 'pdf', position: 0 } : {}
}
function title(record: ResourceRecord) { return record.name || record.title || record.roundLabel || record.id }
export default function ResourceEditor({ kind }: { kind: ResourceKind }) {
  const readOnly = import.meta.env.VITE_ICAROS_DEMO === '1' || !supportedWrites.has(kind)
  const [items, setItems] = useState<ResourceRecord[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<ResourceRecord>>(initial(kind))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [job, setJob] = useState<PublishJob | null>(null)
  const publication = useRef<{ kind: PublishKind; id: string; version: string } | null>(null)
  const [departments, setDepartments] = useState<ResourceRecord[]>([])
  const [types, setTypes] = useState<ResourceRecord[]>([])
  const [series, setSeries] = useState<ResourceRecord[]>([])
  const [members, setMembers] = useState<ResourceRecord[]>([])
  const active = items.find(item => item.id === selected)
  const publishKind: PublishKind | null = kind === 'post-attachments' ? null : kind === 'vehicle-series' ? 'rocket-series' : kind
  useEffect(() => {
    if (!job || job.state === 'published' || job.state === 'failed') return
    const timer = window.setInterval(async () => {
      try {
        const next = await api.publishStatus(job.id)
        setJob(next)
        if (next.state === 'published') {
          if (publication.current) forgetPublicationKey(publication.current.kind, publication.current.id, publication.current.version)
          setMessage('사이트 전체 게시 빌드가 완료되었습니다.')
        } else if (next.state === 'failed') setError(next.failureMessage || '게시 빌드에 실패했습니다.')
      } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 상태를 확인하지 못했습니다.'); setJob(null) }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [job, active, publishKind])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const records = await resourcesApi.list(kind)
      setItems(records)
      if (kind === 'donation-rounds' && records[0]) { setSelected(records[0].id); setDraft({ ...records[0] }) }
      if (kind === 'departments') setMembers(await resourcesApi.list('members'))
      if (kind === 'members') setDepartments(await resourcesApi.list('departments'))
      if (kind === 'vehicle-series') setTypes(await resourcesApi.list('vehicle-types'))
      if (kind === 'vehicles') {
        const [t, s] = await Promise.all([resourcesApi.list('vehicle-types'), resourcesApi.list('vehicle-series')])
        setTypes(t); setSeries(s)
      }
    } catch (cause) { setItems([]); setSelected(null); setDraft(initial(kind)); setError(cause instanceof Error ? cause.message : '목록을 불러오지 못했습니다.') }
    finally { setLoading(false) }
  }, [kind])
  useEffect(() => { queueMicrotask(() => void load()) }, [load])
  function select(record: ResourceRecord | null) {
    setSelected(record?.id ?? null); setDraft(record ? { ...record } : initial(kind)); setError(''); setMessage(''); setJob(null)
  }
  function set(key: keyof ResourceRecord, value: unknown) { setDraft(previous => ({ ...previous, [key]: value })) }
  async function save() {
    if (readOnly) return
    if (kind === 'vehicles' && (!draft.name?.trim() || !draft.typeId)) { setError('기체 이름과 분류를 입력하세요.'); return }
    if (kind === 'donation-rounds' && (!draft.roundLabel?.trim() || !Number.isSafeInteger(draft.goal) || !Number.isSafeInteger(draft.amount) || (draft.goal ?? 0) < 0 || (draft.amount ?? 0) < 0)) { setError('후원 차수와 0 이상의 정수 금액을 입력하세요.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const payload = Object.fromEntries((fields[kind] ?? []).filter(key => draft[key] !== undefined).map(key => [key, draft[key]]))
      const result = active ? await resourcesApi.update(kind, active.id, active.version, payload) : await resourcesApi.create(kind, payload)
      setItems(previous => active ? previous.map(item => item.id === result.id ? result : item) : [...previous, result])
      select(result); setMessage('서버에 초안이 저장되었습니다. 공개 반영은 게시 빌드 완료 후 확인하세요.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!active || readOnly || !window.confirm(`${title(active)} 항목을 삭제할까요?`)) return
    setBusy(true); setError(''); setMessage('')
    try { await resourcesApi.remove(kind, active.id, active.version); setItems(previous => previous.filter(item => item.id !== active.id)); select(null); setMessage('서버에서 삭제되었습니다.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '삭제에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function publish() {
    if (!active || !publishKind || readOnly || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const siteCurrent = kind === 'donation-rounds' ? (await api.list('site')).find(item => item.id === 'donation.current') : null
      if (kind === 'donation-rounds' && !siteCurrent) throw new Error('후원 금액 설정을 찾지 못했습니다.')
      const trigger = { kind: kind === 'donation-rounds' ? 'site' as const : publishKind, id: siteCurrent?.id ?? active.id, version: siteCurrent?.version ?? active.version }
      publication.current = trigger
      const started = await publishDraft(trigger.kind, trigger.id, trigger.version)
      setJob(started)
      if (started.state === 'failed') setError(started.failureMessage || '게시 빌드에 실패했습니다.')
      else if (started.state === 'published') setMessage('사이트 전체 게시 빌드가 완료되었습니다.')
      else setMessage('사이트 전체 게시 작업을 접수했습니다. 저장된 다른 변경도 함께 빌드됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 요청에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function upload(file: File, key: 'mediaId' | 'modelMediaId' | 'galleryMediaIds') {
    if (readOnly) return
    const allowed = key === 'modelMediaId' ? ['model/gltf-binary'] : kind === 'post-attachments' ? ['application/pdf', 'video/mp4'] : ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
    if (!allowed.includes(file.type)) { setError('지원하지 않는 파일 형식입니다.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const media = await resourcesApi.upload(file)
      if (key === 'galleryMediaIds') set(key, [...(draft.galleryMediaIds ?? []), media.id])
      else set(key, media.id)
      if (key === 'mediaId') set('mediaKind', file.type === 'application/pdf' ? 'pdf' : file.type.startsWith('video/') ? 'video' : 'image')
      setMessage('파일 업로드가 확인되었습니다. 항목을 저장해야 연결됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '업로드에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function move(offset: number) {
    if (!active || readOnly) return
    const sorted = [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    const index = sorted.findIndex(item => item.id === active.id)
    const other = sorted[index + offset]
    if (!other) return
    setBusy(true); setError('')
    try {
      const oldPosition = active.position ?? index
      const next = await resourcesApi.update(kind, active.id, active.version, { position: other.position ?? index + offset })
      const swapped = await resourcesApi.update(kind, other.id, other.version, { position: oldPosition })
      setItems(previous => previous.map(item => item.id === next.id ? next : item.id === swapped.id ? swapped : item))
      select(next); setMessage('순서가 서버에 저장되었습니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '순서 변경에 실패했습니다. 새로고침해 상태를 확인하세요.') }
    finally { setBusy(false) }
  }
  const membersInDepartment = kind === 'departments' && active ? members.filter(member => member.departmentId === active.id) : []
  return <div className="workspace"><aside className="card list"><h2>목록 <span className="count">{items.length}</span></h2>{kind !== 'donation-rounds' && <button type="button" disabled={readOnly} onClick={() => select(null)}>새 항목</button>}<button type="button" onClick={() => void load()}>새로고침</button>{loading ? <p>불러오는 중…</p> : <div className="listItems">{items.map(item => <button className="listItem" aria-current={selected === item.id ? 'true' : undefined} key={item.id} onClick={() => select(item)}>{title(item)}</button>)}</div>}</aside><section className="card editor"><div className="cardHead"><h3>{active ? readOnly ? '상세 보기' : '항목 편집' : readOnly ? '읽기 전용' : '새 항목'}</h3>{active && <span className="mono">{active.id}</span>}</div>
    {readOnly && <p className="notice" role="status">{import.meta.env.VITE_ICAROS_DEMO === '1' ? '로컬 DB 미리보기는 읽기 전용입니다.' : '이 콘텐츠 종류는 저장 API가 아직 연결되지 않았습니다.'}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {!readOnly && <p className="hint">초안을 저장한 뒤 사이트 전체 게시를 요청하세요. 저장된 다른 변경 사항도 함께 빌드되어 공개됩니다.</p>}
    {membersInDepartment.length > 0 && <p className="notice">배정 인원 {membersInDepartment.length}명: {membersInDepartment.map(title).join(', ')}. 삭제하려면 먼저 멤버를 다른 부서 또는 미배정으로 변경하세요.</p>}
    <div className="fields">{(fields[kind] ?? []).map(key => {
      if (key === 'galleryMediaIds') return <div key={key}><strong>갤러리</strong><div className="mediaList">{(draft.galleryMediaIds ?? []).map((id, index) => <div key={`${id}-${index}`}><span>{id}</span><button disabled={readOnly || busy} onClick={() => set(key, (draft.galleryMediaIds ?? []).filter((_, i) => i !== index))}>제거</button><button disabled={readOnly || busy || index === 0} onClick={() => { const list = [...(draft.galleryMediaIds ?? [])]; [list[index - 1], list[index]] = [list[index]!, list[index - 1]!]; set(key, list) }}>↑</button></div>)}</div><input aria-label="갤러리 이미지 추가" type="file" accept="image/jpeg,image/png,image/webp" disabled={readOnly || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, key); event.target.value = '' }} /></div>
      if (key === 'mediaId' || key === 'modelMediaId') return <label key={key}>{key === 'modelMediaId' ? '선택적 GLB 모델' : '미디어'}<input value={String(draft[key] ?? '')} readOnly /><input type="file" aria-label={key === 'modelMediaId' ? 'GLB 업로드' : '미디어 업로드'} accept={key === 'modelMediaId' ? '.glb,model/gltf-binary' : kind === 'post-attachments' ? '.pdf,video/mp4' : 'image/jpeg,image/png,image/webp,video/mp4'} disabled={readOnly || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, key); event.target.value = '' }} /><button type="button" disabled={readOnly || busy || !draft[key]} onClick={() => set(key, null)}>연결 해제</button></label>
      if (key === 'departmentId' || key === 'typeId' || key === 'seriesId') { const options = key === 'departmentId' ? departments : key === 'typeId' ? types : series; return <label key={key}>{key === 'departmentId' ? '부서' : key === 'typeId' ? '분류' : '시리즈'}<select disabled={readOnly} value={String(draft[key] ?? '')} onChange={event => set(key, event.target.value || null)}><option value="">미배정</option>{options.map(option => <option key={option.id} value={option.id}>{title(option)}</option>)}</select></label> }
      if (key === 'mediaKind') return <label key={key}>미디어 종류<select disabled={readOnly} value={draft.mediaKind ?? 'image'} onChange={event => set(key, event.target.value)}>{mediaKinds.filter(value => kind !== 'post-attachments' ? value === 'image' || value === 'video' : value === 'pdf' || value === 'video').map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      if (key === 'published') return <label key={key}>{resourceLabels[key]}<input type="checkbox" disabled={readOnly || busy} checked={draft.published ?? false} onChange={event => set(key, event.target.checked)} /></label>
      const numeric = key === 'amount' || key === 'goal' || key === 'position'
      return <label key={key}>{resourceLabels[key] ?? key}{key === 'description' ? <textarea disabled={readOnly || busy} value={String(draft[key] ?? '')} onChange={event => set(key, event.target.value)} /> : <input disabled={readOnly || busy} type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} value={String(draft[key] ?? '')} onChange={event => set(key, numeric ? Number(event.target.value) : event.target.value)} />}</label>
    })}</div>
    {(kind === 'panels' || kind === 'post-attachments') && active && <div className="actions"><button disabled={readOnly || busy} onClick={() => void move(-1)}>위로</button><button disabled={readOnly || busy} onClick={() => void move(1)}>아래로</button></div>}
    {kind === 'post-attachments' && draft.mediaId && <p className="hint">PDF·영상은 공개 페이지에서 명시적 클릭 후 열립니다. 이 화면은 첨부 ID만 표시합니다.</p>}
    <div className="actions"><button className="primary" disabled={readOnly || busy || (kind === 'donation-rounds' && !active)} onClick={() => void save()}>{busy ? '처리 중…' : '초안 저장'}</button>{active && <button disabled={readOnly || busy || job?.state === 'publishing' || JSON.stringify(Object.fromEntries((fields[kind] ?? []).map(key => [key, draft[key]]))) !== JSON.stringify(Object.fromEntries((fields[kind] ?? []).map(key => [key, active[key]])))} onClick={() => void publish()}>사이트 전체 게시</button>}{active && kind !== 'donation-rounds' && <button disabled={readOnly || busy || membersInDepartment.length > 0} onClick={() => void remove()}>삭제</button>}</div>
  </section></div>
}

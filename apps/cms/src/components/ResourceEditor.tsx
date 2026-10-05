import { useCallback, useEffect, useRef, useState } from 'react'
import { resourcesApi } from '../lib/api/resources'
import { useAutosave } from '../lib/useAutosave'
import { noteCmsChange } from '../lib/cmsChanges'
import { fields, resourceLabels, type ResourceKind, type ResourceRecord } from '../lib/resources'
import MarkdownField from './MarkdownField'
import ImagePreview from './ImagePreview'

const supportedWrites = new Set<ResourceKind>(['departments', 'members', 'vehicle-types', 'vehicle-series', 'panels', 'donation-rounds'])
const mediaKinds = ['image', 'video', 'pdf', 'model'] as const
function initial(kind: ResourceKind): Partial<ResourceRecord> {
  return kind === 'panels' ? { mediaKind: 'image', position: 0, ctaLabel: null, ctaHref: null, published: false } : kind === 'vehicles' ? { galleryMediaIds: [], modelMediaId: null, published: false, position: 0 } : kind === 'post-attachments' ? { mediaKind: 'pdf', position: 0 } : {}
}
function payload(kind: ResourceKind, draft: Partial<ResourceRecord>) {
  return Object.fromEntries((fields[kind] ?? []).filter(key => draft[key] !== undefined).map(key => [key, kind === 'panels' && (key === 'ctaLabel' || key === 'ctaHref') ? draft[key]?.trim() || null : draft[key]]))
}
function validation(kind: ResourceKind, draft: Partial<ResourceRecord>) {
  if (draft.position !== undefined && (!Number.isInteger(draft.position) || draft.position < 0 || draft.position > 9999)) return '표시 순서는 0~9999 사이의 정수로 입력하세요.'
  if ((draft.name?.length ?? 0) > 120 || (draft.description?.length ?? 0) > 20000) return '이름은 120자, 설명은 20,000자 이내로 입력하세요.'
  if (kind === 'panels') {
    if ((draft.title?.length ?? 0) > 500 || (draft.ctaLabel?.length ?? 0) > 200) return '제목은 500자, 버튼 문구는 200자 이내로 입력하세요.'
    if (draft.ctaHref?.trim() && !(/^#[a-z][a-z0-9_-]{0,63}$/.test(draft.ctaHref.trim()) || /^\/(?:vehicles|missions|posts|member)(?:\/[a-zA-Z0-9_-]+){0,3}\/?$/.test(draft.ctaHref.trim()))) return '이동 버튼 링크에 지원하는 사이트 내부 경로를 입력하세요.'
    if (!draft.title?.trim() || !draft.mediaId) return '제목과 미디어를 입력하세요.'
    if (Boolean(draft.ctaLabel?.trim()) !== Boolean(draft.ctaHref?.trim())) return '버튼 문구와 이동할 페이지 링크를 함께 입력하세요.'
  } else if (kind === 'donation-rounds') {
    if (!draft.roundLabel?.trim() || !Number.isSafeInteger(draft.goal) || !Number.isSafeInteger(draft.amount) || (draft.goal ?? 0) < 0 || (draft.amount ?? 0) < 0) return '후원 차수와 0 이상의 정수 금액을 입력하세요.'
  } else if (!draft.name?.trim()) return '이름을 입력하세요.'
  if ((kind === 'vehicle-series' || kind === 'vehicles') && !draft.typeId) return '기체 분류를 선택하세요.'
  return ''
}
function title(record: ResourceRecord) { return record.name || record.title || record.roundLabel || record.id }
export default function ResourceEditor({ kind, onChanged, optionsRevision = 0 }: {
  kind: ResourceKind; onChanged?: () => void; optionsRevision?: number
}) {
  const readOnly = import.meta.env.VITE_ICAROS_DEMO === '1' || !supportedWrites.has(kind)
  const [items, setItems] = useState<ResourceRecord[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<ResourceRecord>>(initial(kind))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [departments, setDepartments] = useState<ResourceRecord[]>([])
  const [types, setTypes] = useState<ResourceRecord[]>([])
  const [series, setSeries] = useState<ResourceRecord[]>([])
  const [members, setMembers] = useState<ResourceRecord[]>([])
  const active = items.find(item => item.id === selected)
  const records = useRef(items)
  useEffect(() => { records.current = items }, [items])
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
  useEffect(() => {
    if (kind !== 'vehicle-series' || optionsRevision === 0) return
    let cancelled = false
    resourcesApi.list('vehicle-types').then(records => { if (!cancelled) setTypes(records) })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '기체 분류를 불러오지 못했습니다.') })
    return () => { cancelled = true }
  }, [kind, optionsRevision])
  function select(record: ResourceRecord | null) {
    setSelected(record?.id ?? null); setDraft(record ? { ...record } : initial(kind)); setError(''); setMessage('')
  }
  const invalid = validation(kind, draft)
  const dirty = JSON.stringify(payload(kind, draft)) !== JSON.stringify(payload(kind, active ?? initial(kind)))
  async function save() {
    if (readOnly) return
    if (invalid) { setError(invalid); throw new Error(invalid) }
    setError(''); setMessage('')
    const sent = JSON.stringify(draft)
    const current = records.current.find(item => item.id === selected)
    try {
      const result = current ? await resourcesApi.update(kind, current.id, current.version, payload(kind, draft)) : await resourcesApi.create(kind, payload(kind, draft))
      records.current = current ? records.current.map(item => item.id === result.id ? result : item) : [...records.current, result]
      setItems(records.current)
      setSelected(result.id)
      setDraft(previous => JSON.stringify(previous) === sent ? { ...result } : previous)
      onChanged?.()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.'); throw cause }
  }
  const autosave = useAutosave({ key: `${kind}:${selected ?? 'new'}`, dirty, fingerprint: JSON.stringify(payload(kind, draft)), enabled: !readOnly && !invalid && !busy && (kind !== 'donation-rounds' || Boolean(active)), save })
  async function changeSelection(id: string | null) {
    try {
      if (dirty && invalid && !readOnly) throw new Error(invalid)
      await autosave.flush()
      select(records.current.find(item => item.id === id) ?? null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장을 완료한 후 항목을 전환하세요.') }
  }
  async function refresh() {
    try {
      if (dirty && invalid && !readOnly) throw new Error(invalid)
      await autosave.flush()
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장을 완료한 후 새로고침하세요.') }
  }
  async function create() {
    if (invalid) { setError(invalid); return }
    try { await autosave.flush() } catch (cause) { setError(cause instanceof Error ? cause.message : '생성에 실패했습니다.') }
  }
  function set(key: keyof ResourceRecord, value: unknown) { setDraft(previous => ({ ...previous, [key]: value })) }
  async function remove() {
    if (!active || readOnly || !window.confirm(`${title(active)} 항목을 삭제할까요?`)) return
    setError(''); setMessage('')
    try {
      await autosave.flush()
      setBusy(true)
      const current = records.current.find(item => item.id === active.id)
      if (!current) return
      await resourcesApi.remove(kind, current.id, current.version)
      noteCmsChange()
      records.current = records.current.filter(item => item.id !== current.id)
      setItems(records.current); select(null); setMessage('서버에서 삭제되었습니다.'); onChanged?.() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '삭제에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function upload(file: File, key: 'mediaId' | 'imageMediaId' | 'modelMediaId' | 'galleryMediaIds') {
    if (readOnly) return
    const allowed = key === 'imageMediaId' ? ['image/jpeg', 'image/png', 'image/webp'] : key === 'modelMediaId' ? ['model/gltf-binary'] : kind === 'post-attachments' ? ['application/pdf', 'video/mp4'] : ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
    if (!allowed.includes(file.type)) { setError('지원하지 않는 파일 형식입니다.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const media = await resourcesApi.upload(file)
      if (key === 'galleryMediaIds') set(key, [...(draft.galleryMediaIds ?? []), media.id])
      else set(key, media.id)
      if (key === 'mediaId') set('mediaKind', file.type === 'application/pdf' ? 'pdf' : file.type.startsWith('video/') ? 'video' : 'image')
      setMessage('파일 업로드가 확인되었습니다. 필수 값이 입력되면 자동으로 연결됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '업로드에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function move(offset: number) {
    if (!active || readOnly) return
    setError('')
    try {
      if (dirty && invalid) throw new Error(invalid)
      await autosave.flush()
      const current = records.current.find(item => item.id === active.id)
      if (!current) return
      const sorted = [...records.current].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      const index = sorted.findIndex(item => item.id === current.id)
      const other = sorted[index + offset]
      if (!other) return
      setBusy(true)
      const next = await resourcesApi.update(kind, current.id, current.version, { position: other.position ?? index + offset })
      noteCmsChange()
      records.current = records.current.map(item => item.id === next.id ? next : item)
      setItems(records.current)
      setDraft(previous => ({ ...previous, position: next.position }))
      const swapped = await resourcesApi.update(kind, other.id, other.version, { position: current.position ?? index })
      noteCmsChange()
      records.current = records.current.map(item => item.id === swapped.id ? swapped : item)
      setItems(records.current)
      setMessage('순서가 서버에 저장되었습니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '순서 변경에 실패했습니다. 새로고침해 상태를 확인하세요.') }
    finally { setBusy(false) }
  }
  const membersInDepartment = kind === 'departments' && active ? members.filter(member => member.departmentId === active.id) : []
  return <div className="workspace"><aside className="card list"><h2>목록 <span className="count">{items.length}</span></h2>{kind !== 'donation-rounds' && <button type="button" disabled={readOnly || busy} onClick={() => void changeSelection(null)}>새 항목</button>}<button type="button" disabled={busy} onClick={() => void refresh()}>새로고침</button>{loading ? <p>불러오는 중…</p> : <div className="listItems">{items.map(item => <button className="listItem" disabled={busy} aria-current={selected === item.id ? 'true' : undefined} key={item.id} onClick={() => void changeSelection(item.id)}>{title(item)}</button>)}</div>}</aside><section className="card editor"><div className="cardHead"><h3>{active ? readOnly ? '상세 보기' : '항목 편집' : readOnly ? '읽기 전용' : '새 항목'}</h3>{active && <span className="mono">{active.id}</span>}</div>
    {readOnly && <p className="notice" role="status">{import.meta.env.VITE_ICAROS_DEMO === '1' ? '로컬 DB 미리보기는 읽기 전용입니다.' : '이 콘텐츠 종류는 저장 API가 아직 연결되지 않았습니다.'}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    {!readOnly && <p className="hint">변경 사항은 자동 저장됩니다. 우측 상단의 변경사항 반영하기를 누르면 저장된 변경 사항이 공개됩니다.</p>}
    {!readOnly && <p className="hint" role="status">{invalid && dirty ? invalid : { idle: '자동 저장 대기', pending: '저장 대기 중…', saving: '저장 중…', saved: '자동 저장됨', error: '자동 저장 실패' }[autosave.status]}</p>}
    {autosave.error && <p className="notice error" role="alert">{autosave.error}</p>}
    {membersInDepartment.length > 0 && <p className="notice">배정 인원 {membersInDepartment.length}명: {membersInDepartment.map(title).join(', ')}. 삭제하려면 먼저 멤버를 다른 부서 또는 미배정으로 변경하세요.</p>}
    <div className="fields">{(fields[kind] ?? []).map(key => {
      if (key === 'imageMediaId') return <div key={key}><label>프로필 사진<input type="file" aria-label="프로필 사진 업로드" accept="image/jpeg,image/png,image/webp" disabled={readOnly || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, key); event.target.value = '' }} /></label><ImagePreview key={draft.imageMediaId ?? 'none'} mediaId={draft.imageMediaId} alt="프로필 사진 미리보기" /><button type="button" disabled={readOnly || busy || !draft.imageMediaId} onClick={() => set(key, null)}>프로필 사진 제거</button></div>
      if (key === 'galleryMediaIds') return <div key={key}><strong>갤러리</strong><div className="mediaList">{(draft.galleryMediaIds ?? []).map((id, index) => <div key={`${id}-${index}`}><ImagePreview mediaId={id} alt={`갤러리 이미지 ${index + 1}`} /><span>{id}</span><button disabled={readOnly || busy} onClick={() => set(key, (draft.galleryMediaIds ?? []).filter((_, i) => i !== index))}>제거</button><button disabled={readOnly || busy || index === 0} onClick={() => { const list = [...(draft.galleryMediaIds ?? [])]; [list[index - 1], list[index]] = [list[index]!, list[index - 1]!]; set(key, list) }}>↑</button></div>)}</div><input aria-label="갤러리 이미지 추가" type="file" accept="image/jpeg,image/png,image/webp" disabled={readOnly || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, key); event.target.value = '' }} /></div>
      if (key === 'mediaId' || key === 'modelMediaId') return <div key={key}><label>{key === 'modelMediaId' ? '선택적 GLB 모델' : '미디어'}<input value={String(draft[key] ?? '')} readOnly /><input type="file" aria-label={key === 'modelMediaId' ? 'GLB 업로드' : '미디어 업로드'} accept={key === 'modelMediaId' ? '.glb,model/gltf-binary' : kind === 'post-attachments' ? '.pdf,video/mp4' : 'image/jpeg,image/png,image/webp,video/mp4'} disabled={readOnly || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, key); event.target.value = '' }} /></label>{key === 'mediaId' && draft.mediaKind === 'image' && <ImagePreview key={draft.mediaId ?? 'none'} mediaId={draft.mediaId} alt="미디어 이미지 미리보기" />}<button type="button" disabled={readOnly || busy || !draft[key]} onClick={() => set(key, null)}>연결 해제</button></div>
      if (key === 'departmentId' || key === 'typeId' || key === 'seriesId') { const options = key === 'departmentId' ? departments : key === 'typeId' ? types : series; return <label key={key}>{key === 'departmentId' ? '부서' : key === 'typeId' ? '분류' : '시리즈'}<select disabled={readOnly} value={String(draft[key] ?? '')} onChange={event => set(key, event.target.value || null)}><option value="">미배정</option>{options.map(option => <option key={option.id} value={option.id}>{title(option)}</option>)}</select></label> }
      if (key === 'mediaKind') return <label key={key}>미디어 종류<select disabled={readOnly} value={draft.mediaKind ?? 'image'} onChange={event => set(key, event.target.value)}>{mediaKinds.filter(value => kind !== 'post-attachments' ? value === 'image' || value === 'video' : value === 'pdf' || value === 'video').map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      if (key === 'published') return <label key={key}>{resourceLabels[key]}<input type="checkbox" disabled={readOnly || busy} checked={draft.published ?? false} onChange={event => set(key, event.target.checked)} /></label>
      if (key === 'ctaHref') return <label key={key}>{resourceLabels[key]}<input type="text" list="panel-cta-pages" placeholder="/vehicles" disabled={readOnly || busy} value={draft.ctaHref ?? ''} onChange={event => set(key, event.target.value)} /><small className="hint">사이트 내부 경로를 입력하세요. 예: /vehicles, /missions, /posts</small><datalist id="panel-cta-pages"><option value="/vehicles" /><option value="/missions" /><option value="/posts" /><option value="/member" /><option value="#support" /><option value="#contact" /></datalist></label>
      if (key === 'description') return <MarkdownField key={key} label={resourceLabels[key] ?? key} disabled={readOnly || busy} value={String(draft[key] ?? '')} onChange={value => set(key, value)} />
      const numeric = key === 'amount' || key === 'goal' || key === 'position'
      return <label key={key}>{resourceLabels[key] ?? key}<input disabled={readOnly || busy} type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} value={String(draft[key] ?? '')} onChange={event => set(key, numeric ? Number(event.target.value) : event.target.value)} /></label>
    })}</div>
    {(kind === 'panels' || kind === 'post-attachments') && active && <div className="actions"><button disabled={readOnly || busy} onClick={() => void move(-1)}>위로</button><button disabled={readOnly || busy} onClick={() => void move(1)}>아래로</button></div>}
    {kind === 'post-attachments' && draft.mediaId && <p className="hint">PDF·영상은 공개 페이지에서 명시적 클릭 후 열립니다. 이 화면은 첨부 ID만 표시합니다.</p>}
    <div className="actions">{!active && kind !== 'donation-rounds' && <button className="primary" disabled={readOnly || busy} onClick={() => void create()}>항목 생성</button>}{active && kind !== 'donation-rounds' && <button disabled={readOnly || busy || membersInDepartment.length > 0} onClick={() => void remove()}>삭제</button>}</div>
  </section></div>
}

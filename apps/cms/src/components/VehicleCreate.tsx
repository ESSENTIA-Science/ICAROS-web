import VehicleSpecsEditor from './VehicleSpecsEditor'
import { getVehicleSpecs, validVehicleSpecs } from '../lib/vehicleSpecs'
import type { VehicleSpec } from '../lib/api/types'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api/client'
import { resourcesApi } from '../lib/api/resources'
import type { ResourceRecord } from '../lib/resources'
import type { Rocket } from '../lib/api/types'
import MarkdownField from './MarkdownField'
import { useAutosave } from '../lib/useAutosave'

type Draft = { id: string; name: string; series: string; descriptionMd: string; maxAltitudeM: string; sizeM: string; payloadKg: string; specs: VehicleSpec[] }
const emptyDraft: Draft = { id: '', name: '', series: '', descriptionMd: '', maxAltitudeM: '', sizeM: '', payloadKg: '', specs: [] }
const storageKey = 'icaros:vehicle-create'
function initialDraft(): { typeId: string; draft: Draft } {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { typeId: string; draft: Draft } | null
    if (stored && typeof stored.typeId === 'string' && stored.draft && Object.keys(emptyDraft).filter(key => key !== 'specs').every(key => typeof stored.draft[key as keyof Draft] === 'string') && (stored.draft.specs === undefined || Array.isArray(stored.draft.specs))) return { ...stored, draft: { ...stored.draft, specs: getVehicleSpecs(stored.draft) } }
  } catch { /* Keep the in-memory draft when storage is unavailable. */ }
  return { typeId: '', draft: { ...emptyDraft } }
}

export default function VehicleCreate({ onCreated, onCancel }: {
  onCreated: (vehicle: Rocket) => void; onCancel: () => void
}) {
  const [types, setTypes] = useState<ResourceRecord[]>([])
  const [series, setSeries] = useState<ResourceRecord[]>([])
  const [initial] = useState(initialDraft)
  const [typeId, setTypeId] = useState(initial.typeId)
  const [draft, setDraft] = useState(initial.draft)
  const [completed, setCompleted] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const request = useRef<Promise<void> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  useEffect(() => {
    let cancelled = false
    Promise.all([resourcesApi.list('vehicle-types'), resourcesApi.list('vehicle-series')]).then(([nextTypes, nextSeries]) => {
      if (cancelled) return
      setTypes(nextTypes); setSeries(nextSeries)
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '분류와 시리즈를 불러오지 못했습니다.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  const dirty = !completed && (typeId !== '' || JSON.stringify(draft) !== JSON.stringify(emptyDraft))
  const valid = !loading && /^[a-z0-9][a-z0-9-]{1,47}$/.test(draft.id) && !!draft.name.trim() && draft.name.trim().length <= 120 &&
    series.some(item => item.id === draft.series && item.typeId === typeId) && validVehicleSpecs(draft.specs)
  useEffect(() => {
    if (!dirty || demo) return
    try { localStorage.setItem(storageKey, JSON.stringify({ typeId, draft })) }
    catch { /* In-memory edits remain available. */ }
  }, [typeId, draft, dirty, demo])
  async function create() {
    if (request.current) return request.current
    if (!valid || demo) throw new Error('기체 주소·이름·분류·시리즈와 수치를 확인하세요.')
    const task = async () => {
      setBusy(true); setAttempted(true); setError('')
      try {
        const vehicle = await api.createVehicle({ ...draft, name: draft.name.trim() })
        setCompleted(true)
        try { localStorage.removeItem(storageKey) } catch { /* The server draft is saved. */ }
        onCreated(vehicle)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '기체를 추가하지 못했습니다.')
        throw cause
      } finally { setBusy(false) }
    }
    request.current = task()
    try { await request.current } finally { request.current = null }
  }
  const autosave = useAutosave({ key: 'vehicle-create', dirty, enabled: !demo && valid && !completed, fingerprint: JSON.stringify({ typeId, draft }), save: create })
  useEffect(() => { if (cancelled) onCancel() }, [cancelled, onCancel])
  function cancel() {
    if (busy) return
    try { localStorage.removeItem(storageKey) } catch { /* Clear the in-memory draft as well. */ }
    setCompleted(true); setDraft({ ...emptyDraft }); setTypeId(''); setCancelled(true)
  }
  return <form className="card editor" onSubmit={event => { event.preventDefault(); void autosave.flush().catch(() => {}) }}>
    <h3>새 기체 추가</h3>
    <p className="hint">필수 항목을 입력하면 비공개 초안을 자동 생성합니다. 미완성 입력은 이 브라우저에 보관합니다. 상단의 ‘변경사항 반영하기’에서 저장된 변경을 사이트에 반영합니다.</p>
    {(error || autosave.error) && <p className="notice error" role="alert">{error || autosave.error}</p>}
    <p className="hint" role="status">{dirty && !valid ? '필수 항목을 입력하거나 취소해야 ‘변경사항 반영하기’를 사용할 수 있습니다.' : autosave.status === 'pending' ? '자동 저장 대기 중…' : ''}</p>
    <div className="fields">
      <label>기체 이름<input disabled={demo || busy || completed} required maxLength={120} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>기체 주소<input disabled={demo || busy || completed || attempted} required maxLength={48} pattern="[a-z0-9][a-z0-9-]{1,47}" placeholder="raon-iii" value={draft.id} onChange={event => setDraft({ ...draft, id: event.target.value })} /><small>/vehicles/{draft.id || '기체-주소'}</small></label>
      <label>기체 분류<select required value={typeId} disabled={demo || loading || busy || completed} onChange={event => { setTypeId(event.target.value); setDraft({ ...draft, series: '' }) }}><option value="">선택하세요</option>{types.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></label>
      <label>시리즈<select required value={draft.series} disabled={demo || loading || busy || completed || !typeId} onChange={event => setDraft({ ...draft, series: event.target.value })}><option value="">선택하세요</option>{series.filter(item => item.typeId === typeId).map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></label>
      {typeId && !series.some(item => item.typeId === typeId) && <p className="hint">분류·시리즈 관리에서 이 분류의 시리즈를 먼저 추가하세요.</p>}
      <MarkdownField disabled={demo || busy || completed} label="설명 (Markdown)" value={draft.descriptionMd} onChange={value => setDraft({ ...draft, descriptionMd: value })} rows={5} />
      <VehicleSpecsEditor specs={draft.specs} disabled={demo || busy || completed} onChange={specs => setDraft(previous => ({ ...previous, specs }))} />
    </div>
    <div className="actions"><button type="submit" className="primary" disabled={demo || busy || !valid || completed}>{busy ? '추가 중…' : '기체 추가'}</button><button type="button" disabled={busy} onClick={cancel}>취소</button></div>
  </form>
}

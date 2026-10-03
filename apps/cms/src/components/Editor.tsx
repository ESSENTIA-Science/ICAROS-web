import VehicleSpecsEditor from './VehicleSpecsEditor'
import { validVehicleSpecs } from '../lib/vehicleSpecs'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api/client'
import { useAutosave } from '../lib/useAutosave'
import type { ContentKind, ContentMap, Editable } from '../lib/api/types'
import { editable, isDirty, publicationLabel } from '../lib/editor'
import Preview from './Preview'
import { resourcesApi } from '../lib/api/resources'
import MarkdownField from './MarkdownField'
import ImagePreview from './ImagePreview'
import type { ResourceRecord } from '../lib/resources'
import VehicleClassification from './VehicleClassification'

const fields = {
  rockets: [
    ['name', '이름'], ['descriptionMd', '설명 (Markdown)'],
  ],
  site: [['value', '설정 값']],
  posts: [['title', '제목'], ['displayDate', '표시 날짜'], ['bodyMd', '본문 (Markdown)']],
} as const

export default function Editor<K extends ContentKind>({ kind, record, onSaved }: {
  kind: K; record: ContentMap[K]; onSaved: (record: ContentMap[K]) => void
}) {
  const [draft, setDraft] = useState<Editable<K>>(() => editable(kind, record))
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [vehicleTypes, setVehicleTypes] = useState<ResourceRecord[]>([])
  const [vehicleSeries, setVehicleSeries] = useState<ResourceRecord[]>([])
  const [chosenType, setChosenType] = useState<string | null>(null)
  const dirty = isDirty(kind, record, draft)
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'

  useEffect(() => {
    if (kind !== 'rockets') return
    let cancelled = false
    Promise.all([resourcesApi.list('vehicle-types'), resourcesApi.list('vehicle-series')]).then(([types, series]) => {
      if (!cancelled) { setVehicleTypes(types); setVehicleSeries(series) }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '기체 분류를 불러오지 못했습니다.') })
    return () => { cancelled = true }
  }, [kind])

  const savedRecord = useRef(record)
  useEffect(() => { savedRecord.current = record }, [record])
  async function save() {
    setError(''); setMessage('')
    const sent = JSON.stringify(draft)
    try {
      const current = savedRecord.current
      const saved = await api.save(kind, current.id, current.version, draft)
      savedRecord.current = saved
      onSaved(saved)
      setDraft(previous => JSON.stringify(previous) === sent ? editable(kind, saved) : previous)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.')
      throw cause
    }
  }
  const seriesId = kind === 'rockets' ? (draft as Editable<'rockets'>).series : ''
  const typeId = chosenType ?? vehicleSeries.find(series => series.id === seriesId)?.typeId ?? ''
  const classificationValid = kind !== 'rockets' || (!!seriesId && (chosenType === null || vehicleSeries.some(series => series.id === seriesId && series.typeId === chosenType)))
  const autosave = useAutosave({ key: `${kind}:${record.id}`, dirty, fingerprint: JSON.stringify(draft), enabled: !demo && classificationValid && (kind !== 'rockets' || validVehicleSpecs((draft as Editable<'rockets'>).specs)), save })
  async function uploadCover(file: File) {
    setBusy(true); setError(''); setMessage('')
    try {
      const media = await resourcesApi.upload(file)
      setDraft(previous => ({ ...previous, coverMediaId: media.id }))
      setMessage('대표 이미지가 업로드되었습니다. 변경 사항은 자동 저장됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '이미지 업로드에 실패했습니다.') }
    finally { setBusy(false) }
  }

  const status = dirty ? 'draft_saved' : record.publishState
  return <div className="editorGrid">
    <section className="card editor" aria-label="콘텐츠 편집">
      <div className="cardHead"><h3>편집</h3><span className="mono">{record.id}</span></div>
      <p className="hint">변경 사항은 오른쪽 미리보기에 즉시 반영됩니다. 우측 상단의 변경사항 반영하기를 누르면 저장된 다른 수정도 함께 빌드되어 공개됩니다.</p>
      {kind === 'posts' && <p className="hint">작성자 표시는 ESSENTIA가 관리합니다.</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      {kind === 'rockets' && <VehicleClassification types={vehicleTypes} series={vehicleSeries} typeId={typeId} seriesId={seriesId} disabled={demo || busy} onTypeChange={next => {
        setChosenType(next)
        setDraft(previous => ({ ...previous, series: vehicleSeries.find(series => series.typeId === next)?.id ?? '' }))
      }} onSeriesChange={next => setDraft(previous => ({ ...previous, series: next }))} />}
      <div className="fields">{(fields as Partial<Record<ContentKind, readonly (readonly [string, string])[]>>)[kind]?.map(([field, label]) => {
        const fieldLabel = kind === 'site' && record.id === 'donate.cta_href' ? '후원 섹션 이동 버튼 링크' : kind === 'site' && record.id === 'donate.cta_label' ? '후원 섹션 이동 버튼 문구' : label
        const value = String(draft[field as keyof Editable<K>] ?? '')
        const large = ['descriptionMd', 'bodyMd', 'value'].includes(field) && !(kind === 'site' && (record.id === 'donate.cta_href' || record.id === 'donate.cta_label'))
        if (large && field !== 'value') return <MarkdownField key={field} label={fieldLabel} rows={field === 'bodyMd' ? 12 : 5} value={value} onChange={next => setDraft({ ...draft, [field]: next })} />
        return <label key={field}>{fieldLabel}
          {large ? <textarea rows={5} value={value} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />
            : <input type={field === 'displayDate' ? 'date' : 'text'} placeholder={kind === 'site' && record.id === 'donate.cta_href' ? '/posts' : undefined} value={value} onChange={event => setDraft({ ...draft, [field]: event.target.value })} />}
        </label>
      })}</div>
      {kind === 'rockets' && <><VehicleSpecsEditor specs={(draft as Editable<'rockets'>).specs ?? []} disabled={demo} onChange={specs => setDraft(previous => ({ ...previous, specs }))} />{!validVehicleSpecs((draft as Editable<'rockets'>).specs) && <p className="notice">추가한 제원의 항목명과 값을 입력해야 자동 저장됩니다.</p>}</>}
      {kind === 'rockets' && <div className="fields"><label>대표 이미지<input readOnly value={String((draft as Editable<'rockets'>).coverMediaId ?? '')} /><input aria-label="대표 이미지 업로드" type="file" accept="image/jpeg,image/png,image/webp" disabled={demo || busy} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadCover(file); event.target.value = '' }} /></label><ImagePreview key={(draft as Editable<'rockets'>).coverMediaId ?? 'none'} mediaId={(draft as Editable<'rockets'>).coverMediaId} alt="대표 이미지 미리보기" /><button type="button" disabled={demo || busy || !(draft as Editable<'rockets'>).coverMediaId} onClick={() => setDraft({ ...draft, coverMediaId: null })}>대표 이미지 연결 해제</button></div>}
      {kind === 'rockets' && <label className="check"><input type="checkbox" checked={(draft as Editable<'rockets'>).published ?? true} onChange={event => setDraft({ ...draft, published: event.target.checked })} />공개</label>}
      <p className="hint" role="status">{{ idle: '자동 저장 대기', pending: '저장 대기 중…', saving: '저장 중…', saved: '자동 저장됨', error: '자동 저장 실패' }[autosave.status]}</p>
      {autosave.error && <p className="notice error" role="alert">{autosave.error}</p>}

    </section>
    <aside className="card preview" aria-label="초안 미리보기"><div className="cardHead"><h3>Draft preview</h3><span className="badge" data-state={status}>{publicationLabel(status)}</span></div><p className="hint">편집 중인 입력값입니다. 공개 페이지를 대체하지 않습니다.</p><Preview kind={kind} draft={draft} /></aside>
  </div>
}

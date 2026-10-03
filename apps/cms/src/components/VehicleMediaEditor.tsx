import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api/client'
import { resourcesApi, type VehicleMedia } from '../lib/api/resources'
import type { Rocket } from '../lib/api/types'
import { useAutosave } from '../lib/useAutosave'
import { flushCmsChanges } from '../lib/cmsChanges'
import ImagePreview from './ImagePreview'
import Editor from './Editor'
import VehicleCreate from './VehicleCreate'

export default function VehicleMediaEditor() {
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  const [vehicles, setVehicles] = useState<Rocket[]>([])
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)
  const [gallery, setGallery] = useState<VehicleMedia | null>(null)
  const [model, setModel] = useState<VehicleMedia | null>(null)
  const [mediaIds, setMediaIds] = useState<string[]>([])
  const [modelMediaId, setModelMediaId] = useState<string | null>(null)
  const [posterMediaId, setPosterMediaId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const active = vehicles.find(vehicle => vehicle.id === selected)
  const galleryDirty = !!gallery && JSON.stringify(mediaIds) !== JSON.stringify(gallery.mediaIds ?? [])
  const modelDirty = !!model && (modelMediaId !== (model.modelMediaId ?? null) || posterMediaId !== (model.posterMediaId ?? null))
  const autosave = useAutosave({
    key: `vehicle-media:${selected}`, dirty: galleryDirty || modelDirty, enabled: !demo && !!gallery && !!model, fingerprint: JSON.stringify({ mediaIds, modelMediaId, posterMediaId }),
    save: async () => {
      if (galleryDirty) await save('gallery')
      if (modelDirty) await save('model')
    },
  })
  async function leave(action: () => void | Promise<void>) {
    if (busy) return
    try { await autosave.flush(); await flushCmsChanges(); await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '변경 사항을 저장하지 못했습니다.') }
  }

  const loadVehicles = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const records = await api.list('rockets')
      setVehicles(records)
      setGallery(null); setModel(null); setMediaIds([]); setModelMediaId(null); setPosterMediaId(null)
      setSelected(records[0]?.id ?? ''); setReload(previous => previous + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '기체 목록을 불러오지 못했습니다.') }
    finally { setBusy(false) }
  }, [])
  function selectVehicle(id: string) {
    setCreating(false)
    if (id === selected) return
    setGallery(null); setModel(null); setMediaIds([]); setModelMediaId(null); setPosterMediaId(null)
    setMessage(''); setSelected(id)
  }
  function createdVehicle(vehicle: Rocket) {
    setVehicles(previous => [...previous, vehicle])
    selectVehicle(vehicle.id)
  }
  useEffect(() => { queueMicrotask(() => void loadVehicles()) }, [loadVehicles])
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    queueMicrotask(() => {
      setBusy(true); setError(''); setMessage('')
      Promise.all([resourcesApi.vehicleMedia(selected, 'gallery'), resourcesApi.vehicleMedia(selected, 'model')]).then(([nextGallery, nextModel]) => {
        if (cancelled) return
        setGallery(nextGallery); setModel(nextModel)
        setMediaIds([...nextGallery.mediaIds ?? []])
        setModelMediaId(nextModel.modelMediaId ?? null)
        setPosterMediaId(nextModel.posterMediaId ?? null)
      }).catch(cause => {
        if (cancelled) return
        setGallery(null); setModel(null)
        setError(cause instanceof Error ? cause.message : '기체 미디어를 불러오지 못했습니다.')
      }).finally(() => { if (!cancelled) setBusy(false) })
    })
    return () => { cancelled = true }
  }, [selected, reload])
  async function upload(file: File, target: 'gallery' | 'model' | 'poster') {
    if (demo || busy) return
    const allowed = target === 'model' ? file.type === 'model/gltf-binary' || file.name.toLowerCase().endsWith('.glb') : ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    if (!allowed) { setError(target === 'model' ? 'GLB 파일을 선택하세요.' : 'JPEG, PNG 또는 WebP 이미지를 선택하세요.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const media = await resourcesApi.upload(file)
      if (target === 'gallery') setMediaIds(previous => [...previous, media.id])
      else if (target === 'model') setModelMediaId(media.id)
      else setPosterMediaId(media.id)
      setMessage('업로드가 확인되었습니다. 기체 연결을 자동 저장합니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '업로드에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function save(kind: 'gallery' | 'model') {
    const record = kind === 'gallery' ? gallery : model
    if (!record || demo) throw new Error('저장할 기체 미디어가 없습니다.')
    setError(''); setMessage('')
    try {
      const saved = await resourcesApi.saveVehicleMedia(selected, kind, record.version, kind === 'gallery' ? { mediaIds } : { modelMediaId, posterMediaId })
      if (kind === 'gallery') setGallery(saved)
      else setModel(saved)
      setMessage('기체 미디어 초안이 저장되었습니다. 상단의 ‘변경사항 반영하기’로 사이트에 반영할 수 있습니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.'); throw cause }
  }
  return <div className="workspace"><aside className="card list"><h2>기체 <span className="count">{vehicles.length}</span></h2><button disabled={demo || busy || creating} onClick={() => void leave(() => { setCreating(true); setSelected(''); setMessage(''); setError('') })}>새 기체 추가</button><button disabled={busy || creating} onClick={() => void leave(loadVehicles)}>새로고침</button><div className="listItems">{vehicles.map(vehicle => <button key={vehicle.id} className="listItem" aria-current={selected === vehicle.id ? 'true' : undefined} disabled={busy || creating} onClick={() => void leave(() => selectVehicle(vehicle.id))}><strong>{vehicle.name}</strong><small>{vehicle.series}</small></button>)}</div></aside><div className="workArea vehicleSections">{creating ? <VehicleCreate onCreated={createdVehicle} onCancel={() => { setCreating(false); selectVehicle(vehicles[0]?.id ?? '') }} /> : <>{active && <section aria-label="기체 기본 정보"><Editor key={active.id} kind="rockets" record={active} onSaved={saved => setVehicles(previous => previous.map(vehicle => vehicle.id === saved.id ? saved : vehicle))} /></section>}<section className="card editor"><h3>사진·3D 모델</h3><p className="hint">갤러리와 3D 모델 변경 사항은 자동 저장합니다. 상단의 ‘변경사항 반영하기’에서 저장된 변경을 함께 반영합니다.</p>{demo && <p className="notice">로컬 DB 미리보기는 읽기 전용입니다.</p>}{autosave.error && <p className="notice error" role="alert">{autosave.error}</p>}<p className="hint" role="status">{autosave.status === 'saving' ? '자동 저장 중…' : autosave.status === 'pending' ? '자동 저장 대기 중…' : autosave.status === 'saved' ? '자동 저장됨' : ''}</p>{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}{active && <><div className="fields"><section><h4>갤러리</h4><div className="mediaList">{mediaIds.map((id, index) => <div key={`${id}-${index}`}><ImagePreview mediaId={id} alt={`기체 갤러리 이미지 ${index + 1}`} /><span>{id}</span><button type="button" disabled={demo || busy || index === 0} onClick={() => setMediaIds(previous => { const next = [...previous]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next })}>↑</button><button type="button" disabled={demo || busy || index === mediaIds.length - 1} onClick={() => setMediaIds(previous => { const next = [...previous]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next })}>↓</button><button type="button" disabled={demo || busy} onClick={() => setMediaIds(previous => previous.filter((_, at) => at !== index))}>제거</button></div>)}</div><label>사진 추가<input type="file" accept="image/jpeg,image/png,image/webp" disabled={demo || busy || !gallery} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, 'gallery'); event.target.value = '' }} /></label></section><section><h4>3D 모델</h4><label>GLB 미디어 ID<input readOnly value={modelMediaId ?? ''} /><input type="file" accept=".glb,model/gltf-binary" disabled={demo || busy || !model} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, 'model'); event.target.value = '' }} /></label><p className="hint">대체 이미지는 기체 대표 이미지가 없을 때 3D 모델 로딩 중이거나 오류가 나면 표시됩니다.</p><label>3D 모델 대체 이미지 ID<input readOnly value={posterMediaId ?? ''} /><input type="file" accept="image/jpeg,image/png,image/webp" disabled={demo || busy || !model} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, 'poster'); event.target.value = '' }} /></label><ImagePreview key={posterMediaId ?? 'none'} mediaId={posterMediaId} alt="3D 모델 대체 이미지 미리보기" /><div className="actions"><button type="button" disabled={demo || busy || !modelMediaId} onClick={() => setModelMediaId(null)}>모델 연결 해제</button><button type="button" disabled={demo || busy || !posterMediaId} onClick={() => setPosterMediaId(null)}>대체 이미지 연결 해제</button></div></section></div></>}</section></>}</div></div>
}

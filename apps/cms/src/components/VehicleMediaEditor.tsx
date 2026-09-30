import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api/client'
import { resourcesApi, type VehicleMedia } from '../lib/api/resources'
import type { Rocket } from '../lib/api/types'
import type { PublishJob } from '../lib/api/types'
import { publishDraft, forgetPublicationKey } from '../lib/api/publish'

export default function VehicleMediaEditor() {
  const demo = import.meta.env.VITE_ICAROS_DEMO === '1'
  const [vehicles, setVehicles] = useState<Rocket[]>([])
  const [selected, setSelected] = useState('')
  const [gallery, setGallery] = useState<VehicleMedia | null>(null)
  const [model, setModel] = useState<VehicleMedia | null>(null)
  const [mediaIds, setMediaIds] = useState<string[]>([])
  const [modelMediaId, setModelMediaId] = useState<string | null>(null)
  const [posterMediaId, setPosterMediaId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [job, setJob] = useState<PublishJob | null>(null)
  const publication = useRef<{ id: string; version: string } | null>(null)
  const active = vehicles.find(vehicle => vehicle.id === selected)
  useEffect(() => {
    if (!job || job.state === 'published' || job.state === 'failed') return
    const timer = window.setInterval(async () => {
      try {
        const next = await api.publishStatus(job.id)
        setJob(next)
        if (next.state === 'published') { if (publication.current) forgetPublicationKey('rockets', publication.current.id, publication.current.version); setMessage('사이트 전체 게시 빌드가 완료되었습니다.') }
        else if (next.state === 'failed') setError(next.failureMessage || '게시 빌드에 실패했습니다.')
      } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 상태를 확인하지 못했습니다.'); setJob(null) }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [job])

  const loadVehicles = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const records = await api.list('rockets')
      setVehicles(records)
      setGallery(null); setModel(null); setMediaIds([]); setModelMediaId(null); setPosterMediaId(null)
      setSelected(records[0]?.id ?? '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '기체 목록을 불러오지 못했습니다.') }
    finally { setBusy(false) }
  }, [])
  function selectVehicle(id: string) {
    if (id === selected) return
    setGallery(null); setModel(null); setMediaIds([]); setModelMediaId(null); setPosterMediaId(null)
    setJob(null); setMessage(''); setSelected(id)
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
  }, [selected])
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
      setMessage('업로드가 확인되었습니다. 해당 초안을 저장해야 기체에 연결됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '업로드에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function save(kind: 'gallery' | 'model') {
    const record = kind === 'gallery' ? gallery : model
    if (!record || demo || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const saved = await resourcesApi.saveVehicleMedia(selected, kind, record.version, kind === 'gallery' ? { mediaIds } : { modelMediaId, posterMediaId })
      if (kind === 'gallery') { setGallery(saved); setMediaIds([...(saved.mediaIds ?? [])]) }
      else { setModel(saved); setModelMediaId(saved.modelMediaId ?? null); setPosterMediaId(saved.posterMediaId ?? null) }
      setMessage('기체 미디어 초안이 저장되었습니다. 사이트 전체 게시 후 공개됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '저장에 실패했습니다.') }
    finally { setBusy(false) }
  }
  async function publish() {
    if (!active || busy || demo) return
    setBusy(true); setError(''); setMessage('')
    try {
      const rockets = await api.list('rockets')
      const latest = rockets.find(vehicle => vehicle.id === active.id)
      if (!latest) throw new Error('게시할 기체를 찾지 못했습니다.')
      publication.current = { id: latest.id, version: latest.version }
      const started = await publishDraft('rockets', latest.id, latest.version)
      setJob(started)
      if (started.state === 'published') { forgetPublicationKey('rockets', latest.id, latest.version); setMessage('사이트 전체 게시 빌드가 완료되었습니다.') }
      else if (started.state === 'failed') setError(started.failureMessage || '게시 빌드에 실패했습니다.')
      else setMessage('사이트 전체 게시 작업을 접수했습니다. 저장된 다른 변경 사항도 함께 빌드됩니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '게시 요청에 실패했습니다.') }
    finally { setBusy(false) }
  }
  return <div className="workspace"><aside className="card list"><h2>기체 <span className="count">{vehicles.length}</span></h2><button disabled={busy} onClick={() => void loadVehicles()}>새로고침</button><div className="listItems">{vehicles.map(vehicle => <button key={vehicle.id} className="listItem" aria-current={selected === vehicle.id ? 'true' : undefined} onClick={() => selectVehicle(vehicle.id)}><strong>{vehicle.name}</strong><small>{vehicle.series}</small></button>)}</div></aside><section className="card editor"><h3>{active?.name ?? '기체를 선택하세요'}</h3><p className="hint">갤러리와 3D 모델은 각각 저장합니다. 저장된 다른 변경도 사이트 전체 게시 빌드에 포함됩니다.</p>{demo && <p className="notice">로컬 DB 미리보기는 읽기 전용입니다.</p>}{error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}{active && <><div className="fields"><section><h4>갤러리</h4><div className="mediaList">{mediaIds.map((id, index) => <div key={`${id}-${index}`}><span>{id}</span><button type="button" disabled={demo || busy || index === 0} onClick={() => setMediaIds(previous => { const next = [...previous]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next })}>↑</button><button type="button" disabled={demo || busy || index === mediaIds.length - 1} onClick={() => setMediaIds(previous => { const next = [...previous]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next })}>↓</button><button type="button" disabled={demo || busy} onClick={() => setMediaIds(previous => previous.filter((_, at) => at !== index))}>제거</button></div>)}</div><label>사진 추가<input type="file" accept="image/jpeg,image/png,image/webp" disabled={demo || busy || !gallery} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, 'gallery'); event.target.value = '' }} /></label><button type="button" className="primary" disabled={demo || busy || !gallery || JSON.stringify(mediaIds) === JSON.stringify(gallery.mediaIds)} onClick={() => void save('gallery')}>갤러리 초안 저장</button></section><section><h4>3D 모델</h4><label>GLB 미디어 ID<input readOnly value={modelMediaId ?? ''} /><input type="file" accept=".glb,model/gltf-binary" disabled={demo || busy || !model} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, 'model'); event.target.value = '' }} /></label><label>포스터 이미지 ID<input readOnly value={posterMediaId ?? ''} /><input type="file" accept="image/jpeg,image/png,image/webp" disabled={demo || busy || !model} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, 'poster'); event.target.value = '' }} /></label><div className="actions"><button type="button" disabled={demo || busy || !modelMediaId} onClick={() => setModelMediaId(null)}>모델 연결 해제</button><button type="button" disabled={demo || busy || !posterMediaId} onClick={() => setPosterMediaId(null)}>포스터 연결 해제</button><button type="button" className="primary" disabled={demo || busy || !model || (modelMediaId === (model.modelMediaId ?? null) && posterMediaId === (model.posterMediaId ?? null))} onClick={() => void save('model')}>모델 초안 저장</button></div></section></div><div className="actions"><button type="button" disabled={demo || busy || !gallery || !model || job?.state === 'publishing' || JSON.stringify(mediaIds) !== JSON.stringify(gallery.mediaIds) || modelMediaId !== (model.modelMediaId ?? null) || posterMediaId !== (model.posterMediaId ?? null)} onClick={() => void publish()}>사이트 전체 게시</button></div></>}</section></div>
}

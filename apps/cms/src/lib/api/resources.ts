import { trackCmsOperation } from '../cmsChanges'
import { ApiError } from './client'
import type { ResourceKind, ResourceRecord } from '../resources'

const routes: Partial<Record<ResourceKind, string>> = {
  departments: 'departments', members: 'members', 'vehicle-types': 'vehicle-types',
  'vehicle-series': 'rocket-series', panels: 'panels',
  missions: 'missions', 'donation-rounds': 'donation-rounds',
}

function unavailable(): never {
  throw new ApiError('이 콘텐츠 종류의 API는 아직 지원되지 않습니다.', 503)
}

function routeFor(kind: ResourceKind): string {
  return routes[kind] ?? unavailable()
}

function readOnly(): never {
  throw new ApiError('데모에서는 변경할 수 없습니다.', 503)
}

const MB = 1024 * 1024
const uploadPolicies: Record<string, { kind: string; max: number; extension: string }> = {
  'image/webp': { kind: 'media', max: MB, extension: 'webp' },
  'video/mp4': { kind: 'video', max: 32 * MB, extension: 'mp4' },
  'model/gltf-binary': { kind: 'glb', max: 8 * MB, extension: 'glb' },
  'application/pdf': { kind: 'pdf', max: 8 * MB, extension: 'pdf' },
}

function uploadData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('업로드 응답 형식이 올바르지 않습니다.', 200)
  return value as Record<string, unknown>
}

async function mediaRequest(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`/api/admin/media/${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch { throw new ApiError('API 서버에 연결할 수 없습니다.', 0) }
  let payload: Record<string, unknown>
  try { payload = uploadData(await response.json()) } catch { throw new ApiError('API 응답 형식이 올바르지 않습니다.', response.status) }
  if (!response.ok || payload.ok !== true) throw new ApiError(`업로드 요청에 실패했습니다. (${response.status})`, response.status)
  return uploadData(payload.data)
}

async function asWebp(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new ApiError('이미지를 읽을 수 없습니다.', 415) }
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new ApiError('이미지를 변환할 수 없습니다.', 415)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (let quality = 0.85; quality >= 0.6; quality -= 0.05) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
      if (!blob || blob.type !== 'image/webp') throw new ApiError('WebP 변환을 지원하지 않는 브라우저입니다.', 415)
      if (blob.size <= MB) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' })
    }
    throw new ApiError('변환한 이미지가 1MB를 초과합니다.', 413)
  } finally { bitmap.close() }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`/api/admin/content/${path}`, {
      ...init, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch { throw new ApiError('API 서버에 연결할 수 없습니다.', 0) }
  let payload: unknown
  try { payload = await response.json() } catch { throw new ApiError('API 응답 형식이 올바르지 않습니다.', response.status) }
  if (!response.ok || !payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) {
    const code = payload && typeof payload === 'object' && 'message' in payload ? payload.message : null
    throw new ApiError(code === 'CONFLICT' ? '다른 변경 사항과 충돌했습니다. 새로고침 후 다시 시도해 주세요.' :
      code === 'DENIED' ? '요청 권한이 없거나 세션이 만료되었습니다.' :
      code === 'MALFORMED' ? '입력 내용이 API 형식에 맞지 않습니다.' :
      `요청에 실패했습니다. (${response.status})`, response.status)
  }
  if (!('data' in payload)) throw new ApiError('API 응답 형식이 올바르지 않습니다.', response.status)
  return payload.data
}

const outbound: Record<string, Partial<Record<keyof ResourceRecord, string>>> = {
  departments: { name: 'name', position: 'sortOrder' },
  members: { name: 'name', description: 'bioMd', departmentId: 'departmentId', position: 'sortOrder', imageMediaId: 'imageMediaId', published: 'published' },
  'vehicle-types': { name: 'label', position: 'sortOrder' },
  'vehicle-series': { name: 'label', description: 'descriptionMd', typeId: 'typeId', position: 'sortOrder' },
  panels: { title: 'headline', description: 'body', mediaId: 'mediaId', position: 'sortOrder', ctaLabel: 'ctaLabel', ctaHref: 'ctaHref', published: 'published' },
  missions: { title: 'title', launchDate: 'launchDate', vehicleId: 'vehicleId', location: 'location', outcome: 'outcome', summary: 'summary', bodyMd: 'bodyMd', coverMediaId: 'coverMediaId', published: 'published' },
  vehicles: { name: 'name', typeId: 'typeId', seriesId: 'seriesId', description: 'description', galleryMediaIds: 'galleryMediaIds', modelMediaId: 'modelMediaId', position: 'position', published: 'published' },
  'donation-rounds': { roundLabel: 'roundLabel', goal: 'goal', amount: 'amount' },
}

function invalid(message: string): never { throw new ApiError(message, 400) }

function record(kind: ResourceKind, value: unknown): ResourceRecord {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
      !('version' in value) || typeof value.version !== 'string') {
    throw new ApiError('콘텐츠 응답에 필수 필드가 없습니다.', 200)
  }
  const result = { ...value } as Record<string, unknown>
  if (kind === 'vehicles' && (!Array.isArray(result.galleryMediaIds) || result.galleryMediaIds.some(id => typeof id !== 'string'))) {
    throw new ApiError('기체 갤러리 응답 형식이 올바르지 않습니다.', 200)
  }
  for (const [local, remote] of Object.entries(outbound[kind] ?? {})) {
    if (remote !== local && Object.hasOwn(result, remote)) {
      result[local] = result[remote]
      delete result[remote]
    }
  }
  return result as ResourceRecord
}

function fields(kind: ResourceKind, draft: Partial<ResourceRecord>): Record<string, string | number | boolean | null | string[]> {
  const result: Record<string, string | number | boolean | null | string[]> = {}
  const mapping = outbound[kind] ?? {}
  for (const [key, value] of Object.entries(draft)) {
    if (key === 'id' || key === 'version' || value === undefined) continue
    // The media type is a property of the media record, not a panel write field.
    if (kind === 'panels' && key === 'mediaKind') continue
    const target = mapping[key as keyof ResourceRecord]
    if (!target) return invalid(`지원하지 않는 입력 필드: ${key}`)
    if (kind === 'vehicles' && key === 'galleryMediaIds') {
      if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) return invalid('갤러리 형식이 올바르지 않습니다.')
      result[target] = value
      continue
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return invalid(`입력 형식이 올바르지 않습니다: ${key}`)
    result[target] = value as string | number | boolean | null
  }
  return result
}

function createId(kind: ResourceKind): string {
  if (kind === 'vehicle-types' || kind === 'vehicle-series') {
    return `${kind === 'vehicle-types' ? 'type' : 'series'}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
  }
  return crypto.randomUUID()
}

function createFields(kind: ResourceKind, draft: Partial<ResourceRecord>) {
  const result = fields(kind, draft)
  if (kind === 'members' || kind === 'panels' || kind === 'vehicles') result.published ??= false
  if (kind === 'vehicles') result.galleryMediaIds ??= []
  if (kind === 'vehicle-series' && !result.typeId) return invalid('시리즈에 기체 분류가 필요합니다.')
  return result
}

export const resourcesApi: {
  list: (kind: ResourceKind) => Promise<ResourceRecord[]>
  create: (kind: ResourceKind, draft: Partial<ResourceRecord>) => Promise<ResourceRecord>
  update: (kind: ResourceKind, id: string, version: string, draft: Partial<ResourceRecord>) => Promise<ResourceRecord>
  remove: (kind: ResourceKind, id: string, version: string) => Promise<void>
  upload: (file: File) => Promise<{ id: string }>
  vehicleMedia: (id: string, kind: 'gallery' | 'model') => Promise<VehicleMedia>
  saveVehicleMedia: (id: string, kind: 'gallery' | 'model', version: string, draft: { mediaIds?: string[]; modelMediaId?: string | null; posterMediaId?: string | null }) => Promise<VehicleMedia>
} = {
  list: async kind => {
    if (import.meta.env.VITE_ICAROS_DEMO === '1') {
      let response: Response
      try { response = await fetch(`/api/admin/preview/${kind}`, { credentials: 'same-origin', cache: 'no-store' }) }
      catch { throw new ApiError('로컬 미리보기 API에 연결할 수 없습니다.', 0) }
      if (!response.ok) throw new ApiError('로컬 DB 목록을 불러오지 못했습니다.', response.status)
      const payload: unknown = await response.json()
      if (!payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true ||
        !('data' in payload) || !Array.isArray(payload.data)) throw new ApiError('로컬 DB 응답 형식이 올바르지 않습니다.', 200)
      return payload.data as ResourceRecord[]
    }
    const data = await request(routeFor(kind))
    if (!Array.isArray(data)) throw new ApiError('목록 응답 형식이 올바르지 않습니다.', 200)
    return data.map(item => record(kind, item))
  },
  create: async (kind, draft) => {
    if (import.meta.env.VITE_ICAROS_DEMO === '1') return readOnly()
    if (kind === 'donation-rounds') return invalid('후원 현황은 한 건만 수정할 수 있습니다.')
    const route = routeFor(kind)
    const payload = createFields(kind, draft)
    return record(kind, await request(route, { method: 'POST', body: JSON.stringify({ id: createId(kind), ...payload }) }))
  },
  update: async (kind, id, version, draft) => {
    if (import.meta.env.VITE_ICAROS_DEMO === '1') return readOnly()
    const route = routeFor(kind)
    const payload = fields(kind, draft)
    const saved = record(kind, await request(`${route}/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'If-Match': version }, body: JSON.stringify(payload),
    }))
    if (saved.id !== id || saved.version === version) throw new ApiError('저장 확인 응답의 버전이 갱신되지 않았습니다.', 200)
    return saved
  },
  remove: async (kind, id, version) => {
    if (import.meta.env.VITE_ICAROS_DEMO === '1') return readOnly()
    if (kind === 'donation-rounds') return invalid('후원 현황은 삭제할 수 없습니다.')
    const route = routeFor(kind)
    const data = await request(`${route}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'If-Match': version } })
    if (!data || typeof data !== 'object' || !('id' in data) || data.id !== id) throw new ApiError('삭제 확인 응답 형식이 올바르지 않습니다.', 200)
  },
  upload: async file => trackCmsOperation(async () => {
    if (import.meta.env.VITE_ICAROS_DEMO === '1') return readOnly()
    if (!file.name || [...file.name].some(char => char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || /\.(svgz?|xml|html?)$/i.test(file.name)) return invalid('지원하지 않는 파일 이름입니다.')
    const typed = /\.glb$/i.test(file.name) && (!file.type || file.type === 'application/octet-stream') ? new File([file], file.name, { type: 'model/gltf-binary' }) : file
    if (!['image/jpeg', 'image/png', ...Object.keys(uploadPolicies)].includes(typed.type)) throw new ApiError('지원하지 않는 파일 형식입니다.', 415)
    const prepared = typed.type === 'image/jpeg' || typed.type === 'image/png' ? await asWebp(typed) : typed
    const policy = uploadPolicies[prepared.type]
    if (!policy || !prepared.name.toLowerCase().endsWith(`.${policy.extension}`)) throw new ApiError('파일 확장자와 형식이 일치하지 않습니다.', 415)
    if (prepared.size <= 0) return invalid('빈 파일은 업로드할 수 없습니다.')
    if (prepared.size > policy.max) throw new ApiError('파일 크기 제한을 초과했습니다.', 413)
    const digest = await crypto.subtle.digest('SHA-256', await prepared.arrayBuffer())
    const checksumSha256 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    const signed = await mediaRequest('presign', { kind: policy.kind, contentType: prepared.type, size: prepared.size, originalFilename: prepared.name, checksumSha256 })
    if (typeof signed.mediaId !== 'string' || !signed.mediaId || typeof signed.uploadUrl !== 'string' || !signed.uploadUrl || signed.contentType !== prepared.type) throw new ApiError('업로드 서명 응답 형식이 올바르지 않습니다.', 200)
    let put: Response
    // Fetch computes Content-Length from this exact File; browsers forbid setting it.
    try { put = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': prepared.type,
      'If-None-Match': '*', 'x-amz-checksum-sha256': checksumSha256 }, body: prepared }) }
    catch { throw new ApiError('파일 전송에 실패했습니다.', 0) }
    if (!put.ok) throw new ApiError(`파일 전송에 실패했습니다. (${put.status})`, put.status)
    const confirmed = await mediaRequest('confirm', { mediaId: signed.mediaId })
    if (confirmed.id !== signed.mediaId) throw new ApiError('업로드 확인 응답 형식이 올바르지 않습니다.', 200)
    return { id: signed.mediaId }
  }),
  vehicleMedia: async (id, kind) => vehicleMedia(await request(`vehicles/${encodeURIComponent(id)}/${kind}`), id, kind),
  saveVehicleMedia: async (id, kind, version, draft) => {
    if (import.meta.env.VITE_ICAROS_DEMO === '1') return readOnly()
    const payload = kind === 'gallery' ? { mediaIds: draft.mediaIds } : { modelMediaId: draft.modelMediaId ?? null, posterMediaId: draft.posterMediaId ?? null }
    const saved = vehicleMedia(await request(`vehicles/${encodeURIComponent(id)}/${kind}`, { method: 'PUT', headers: { 'If-Match': version }, body: JSON.stringify(payload) }), id, kind)
    if (saved.version === version) throw new ApiError('저장 확인 응답의 버전이 갱신되지 않았습니다.', 200)
    return saved
  },
}

export type VehicleMedia = { id: string; version: string; mediaIds?: string[]; modelMediaId?: string | null; posterMediaId?: string | null }
function vehicleMedia(value: unknown, id: string, kind: 'gallery' | 'model'): VehicleMedia {
  if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id || !('version' in value) || typeof value.version !== 'string') throw new ApiError('기체 미디어 응답 형식이 올바르지 않습니다.', 200)
  if (kind === 'gallery' && (!('mediaIds' in value) || !Array.isArray(value.mediaIds) || value.mediaIds.some(item => typeof item !== 'string'))) throw new ApiError('갤러리 응답 형식이 올바르지 않습니다.', 200)
  if (kind === 'model' && (!('modelMediaId' in value) || (value.modelMediaId !== null && typeof value.modelMediaId !== 'string'))) throw new ApiError('3D 모델 응답 형식이 올바르지 않습니다.', 200)
  return value as VehicleMedia
}

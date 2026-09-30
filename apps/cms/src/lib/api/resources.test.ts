import { afterEach, describe, expect, it, vi } from 'vitest'
import { resourcesApi } from './resources'

const version = '2026-09-30T08:12:13.123456Z'
const nextVersion = '2026-09-30T08:12:14.123456Z'
const id = 'aaad326c-74de-4bd2-a3f9-6869cde0b83f'
const mediaId = '59f0649e-ed79-47a2-bf9d-e299204641b8'
const receipt = { id, version: nextVersion, name: '기록' }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: status < 400, data, ...(status >= 400 ? { message: 'CONFLICT' } : {}) }), { status })
}
function fetchWith(data: unknown) {
  const fetcher = vi.fn().mockResolvedValue(reply(data))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('resources API DTO adapter', () => {
  it('updates the single donation summary without creating or deleting it', async () => {
    const draft = { id: 'current', version, roundLabel: '2차', goal: 1000000, amount: 350000 }
    const fetcher = fetchWith([draft])
    await expect(resourcesApi.list('donation-rounds')).resolves.toEqual([draft])
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/content/donation-rounds')
    fetcher.mockResolvedValueOnce(reply({ ...draft, version: nextVersion, amount: 400000 }))
    await expect(resourcesApi.update('donation-rounds', 'current', version, { roundLabel: '2차', goal: 1000000, amount: 400000 })).resolves.toMatchObject({ amount: 400000 })
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/admin/content/donation-rounds/current')
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', headers: { 'If-Match': version } })
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ roundLabel: '2차', goal: 1000000, amount: 400000 })
    await expect(resourcesApi.create('donation-rounds', draft)).rejects.toMatchObject({ status: 400 })
    await expect(resourcesApi.remove('donation-rounds', 'current', version)).rejects.toMatchObject({ status: 400 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('loads and saves vehicle gallery and model with separate versions', async () => {
    const fetcher = fetchWith({ id, version, mediaIds: [mediaId] })
    await expect(resourcesApi.vehicleMedia(id, 'gallery')).resolves.toEqual({ id, version, mediaIds: [mediaId] })
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/admin/content/vehicles/${id}/gallery`)
    fetcher.mockResolvedValueOnce(reply({ id, version: nextVersion, mediaIds: [mediaId] }))
    await resourcesApi.saveVehicleMedia(id, 'gallery', version, { mediaIds: [mediaId] })
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', headers: { 'If-Match': version } })
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ mediaIds: [mediaId] })
    fetcher.mockResolvedValueOnce(reply({ id, version, modelMediaId: mediaId, posterMediaId: null }))
    await resourcesApi.vehicleMedia(id, 'model')
    fetcher.mockResolvedValueOnce(reply({ id, version: nextVersion, modelMediaId: mediaId, posterMediaId: null }))
    await resourcesApi.saveVehicleMedia(id, 'model', version, { modelMediaId: mediaId, posterMediaId: null })
    expect(JSON.parse(fetcher.mock.calls[3]?.[1].body)).toEqual({ modelMediaId: mediaId, posterMediaId: null })
  })
  it('uses the missions route and camelCase fields for CRUD', async () => {
    const mission = { id, version, title: '첫 발사', launchDate: '2026-07-18', vehicleId: null, location: '제주', outcome: 'success' as const, summary: '회수 성공', bodyMd: '## 기록', coverMediaId: mediaId, published: true }
    const fetcher = fetchWith([mission])
    await expect(resourcesApi.list('missions')).resolves.toEqual([mission])
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/content/missions')
    fetcher.mockResolvedValueOnce(reply(mission))
    await resourcesApi.create('missions', mission)
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toMatchObject({ title: mission.title, launchDate: mission.launchDate, vehicleId: null, outcome: 'success', bodyMd: mission.bodyMd, coverMediaId: mediaId, published: true })
    fetcher.mockResolvedValueOnce(reply({ ...mission, version: nextVersion }))
    await resourcesApi.update('missions', id, version, { published: false })
    expect(fetcher.mock.calls[2]?.[0]).toBe(`/api/admin/content/missions/${id}`)
    expect(JSON.parse(fetcher.mock.calls[2]?.[1].body)).toEqual({ published: false })
    fetcher.mockResolvedValueOnce(reply({ id }))
    await resourcesApi.remove('missions', id, nextVersion)
    expect(fetcher.mock.calls[3]?.[0]).toBe(`/api/admin/content/missions/${id}`)
  })
  it.each([
    ['departments', 'departments', { id, version, name: '추진', sortOrder: 2 }, { id, version, name: '추진', position: 2 }],
    ['members', 'members', { id, version, name: '김', bioMd: '소개', sortOrder: 3 }, { id, version, name: '김', description: '소개', position: 3 }],
    ['vehicle-types', 'vehicle-types', { id: 'rocket', version, label: '로켓', sortOrder: 4 }, { id: 'rocket', version, name: '로켓', position: 4 }],
    ['vehicle-series', 'rocket-series', { id: 'icx', version, label: 'ICX', descriptionMd: '설명', sortOrder: 5 }, { id: 'icx', version, name: 'ICX', description: '설명', position: 5 }],
    ['panels', 'panels', { id, version, headline: '첫 발사', body: '설명', mediaId, sortOrder: 6 }, { id, version, title: '첫 발사', description: '설명', mediaId, position: 6 }],
  ] as const)('maps %s list records from %s', async (kind, route, raw, expected) => {
    const fetcher = fetchWith([raw])
    await expect(resourcesApi.list(kind)).resolves.toEqual([expected])
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/admin/content/${route}`)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
  })

  it.each([
    ['departments', { name: '추진', position: 2 }, { name: '추진', sortOrder: 2 }],
    ['members', { name: '김', description: '소개' }, { name: '김', bioMd: '소개', published: false }],
    ['vehicle-types', { name: '로켓' }, { label: '로켓' }],
    ['vehicle-series', { name: 'ICX', typeId: 'rockets', description: '설명' }, { label: 'ICX', typeId: 'rockets', descriptionMd: '설명' }],
    ['panels', { title: '첫 발사', mediaId, position: 2, mediaKind: 'image' }, { headline: '첫 발사', mediaId, sortOrder: 2, published: false }],
  ] as const)('creates %s with valid server fields and ID', async (kind, draft, expected) => {
    const fetcher = fetchWith({ ...receipt, ...(kind === 'panels' ? { headline: '첫 발사' } : {}) })
    await resourcesApi.create(kind, draft)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(`/api/admin/content/${kind === 'vehicle-series' ? 'rocket-series' : kind}`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject(expected)
    expect(body).not.toHaveProperty('description')
    expect(body).not.toHaveProperty('position')
    expect(body).not.toHaveProperty('mediaKind')
    expect(body.id).toMatch(kind === 'vehicle-types' || kind === 'vehicle-series'
      ? /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/ : /^[0-9a-f]{8}-[0-9a-f-]{27}$/)
  })

  it('updates with mapped fields and the original version', async () => {
    const fetcher = fetchWith({ id: 'icx', version: nextVersion, label: 'ICX II', descriptionMd: '새 설명', sortOrder: 7 })
    await expect(resourcesApi.update('vehicle-series', 'icx', version, { name: 'ICX II', description: '새 설명', position: 7 })).resolves.toEqual({ id: 'icx', version: nextVersion, name: 'ICX II', description: '새 설명', position: 7 })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/content/rocket-series/icx')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', headers: { 'If-Match': version } })
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ label: 'ICX II', descriptionMd: '새 설명', sortOrder: 7 })
  })

  it('deletes with If-Match and an encoded ID', async () => {
    const fetcher = fetchWith({ id: 'item/1' })
    await expect(resourcesApi.remove('departments', 'item/1', version)).resolves.toBeUndefined()
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/content/departments/item%2F1')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', headers: { 'If-Match': version } })
  })

  it('rejects unsupported fields and missing required series type before sending', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(resourcesApi.create('vehicle-series', { name: 'ICX' })).rejects.toMatchObject({ status: 400 })
    await expect(resourcesApi.create('departments', { name: '추진', description: '지원 안 됨' })).rejects.toMatchObject({ status: 400 })
    await expect(resourcesApi.update('members', id, version, { modelMediaId: mediaId })).rejects.toMatchObject({ status: 400 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps unsupported kinds and demo writes disabled', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(resourcesApi.list('vehicles')).rejects.toMatchObject({ status: 503 })
    await expect(resourcesApi.create('vehicles', { name: 'x' })).rejects.toMatchObject({ status: 503 })
    vi.stubEnv('VITE_ICAROS_DEMO', '1')
    await expect(resourcesApi.create('members', { name: 'x' })).rejects.toMatchObject({ status: 503 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects stale write receipts', async () => {
    fetchWith({ id, version, name: '김' })
    await expect(resourcesApi.update('members', id, version, { name: '김' })).rejects.toMatchObject({ status: 200 })
  })
})

describe('media upload', () => {
  it('presigns, PUTs bytes, and confirms the media ID', async () => {
    const file = new File(['RIFFxxxxWEBPdata'], 'image.webp', { type: 'image/webp' })
    const calls: Array<[string, RequestInit]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init])
      if (url.endsWith('/presign')) return reply({ mediaId, uploadUrl: 'https://upload.example/one', contentType: 'image/webp', key: 'x/media/one.webp' }, 201)
      if (url.endsWith('/confirm')) return reply({ id: mediaId, size: file.size, mime: 'image/webp' })
      return new Response(null, { status: 200 })
    }))
    await expect(resourcesApi.upload(file)).resolves.toEqual({ id: mediaId })
    expect(calls.map(([url]) => url)).toEqual(['/api/admin/media/presign', 'https://upload.example/one', '/api/admin/media/confirm'])
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ kind: 'media', contentType: 'image/webp', size: file.size, originalFilename: 'image.webp' })
    expect(calls[1]![1]).toMatchObject({ method: 'PUT', body: file, headers: { 'Content-Type': 'image/webp' } })
    expect(JSON.parse(String(calls[2]![1].body))).toEqual({ mediaId })
  })

  it('rejects unsupported MIME and oversized files before network I/O', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(resourcesApi.upload(new File(['x'], 'x.webm', { type: 'video/webm' }))).rejects.toMatchObject({ status: 415 })
    await expect(resourcesApi.upload(new File([new Uint8Array(1024 * 1024 + 1)], 'x.webp', { type: 'image/webp' }))).rejects.toMatchObject({ status: 413 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps demo uploads read-only', async () => {
    vi.stubEnv('VITE_ICAROS_DEMO', '1')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(resourcesApi.upload(new File(['x'], 'x.webp', { type: 'image/webp' }))).rejects.toMatchObject({ status: 503 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('stops before confirmation when object PUT fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ mediaId, uploadUrl: 'https://upload.example/one', contentType: 'application/pdf' }, 201)).mockResolvedValueOnce(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(resourcesApi.upload(new File(['%PDF-'], 'x.pdf', { type: 'application/pdf' }))).rejects.toMatchObject({ status: 403 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

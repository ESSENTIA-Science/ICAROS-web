import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'
import type { Post, Rocket } from './types'

const rocket: Rocket = {
  id: 'icx-1a', version: '2026-09-30T01:00:00.000000Z', publishState: 'published',
  updatedAt: '2026-09-30T01:00:00Z', name: 'ICX-1A', series: 'A',
  descriptionMd: '기존 설명', maxAltitudeM: '', sizeM: '', payloadKg: '',
}
const post: Post = { id: 'post-1', version: 'v1', publishState: 'draft_saved', updatedAt: '2026-09-30T01:00:00Z', title: '첫 기록', bodyMd: '본문', authorLabel: '관리자', displayDate: '2026-09-30', attachments: [] }

afterEach(() => vi.unstubAllGlobals())

describe('admin API client', () => {
  it('creates a post draft with only the accepted fields and returns the CMS post', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: post }), { status: 201 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.createPost('첫 기록', '본문', '2026-09-30', [], 'key-1')).resolves.toEqual(post)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/content/posts')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ title: '첫 기록', bodyMd: '본문', displayDate: '2026-09-30', attachments: [], idempotencyKey: 'key-1' })
  })

  it('rejects a malformed post creation receipt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { ...post, authorLabel: undefined } }), { status: 201 })))
    await expect(api.createPost('첫 기록', '본문', '2026-09-30', [], 'key-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('blocks post creation in demo mode before calling fetch', async () => {
    vi.stubEnv('VITE_ICAROS_DEMO', '1')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(api.createPost('첫 기록', '본문', '2026-09-30', [], 'key-1')).rejects.toMatchObject({ status: 503 })
    expect(fetcher).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
  it('uses same-origin auth routes and reads the server session', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { userId: 'admin-1', email: 'admin@example.test' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.login('admin@example.test', 'password')).resolves.toEqual({ userId: 'admin-1', email: 'admin@example.test' })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/login')
    expect(fetcher.mock.calls[0]?.[1].credentials).toBe('same-origin')
  })

  it('never reports a failed write as saved', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'UNAVAILABLE' }), { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.save('rockets', rocket.id, rocket.version, { name: '수정', series: 'A', descriptionMd: '', maxAltitudeM: '', sizeM: '', payloadKg: '' }))
      .rejects.toMatchObject({ status: 503, message: expect.stringContaining('사용할 수 없습니다') })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/content/rockets/icx-1a')
    expect(fetcher.mock.calls[0]?.[1].method).toBe('PUT')
    expect(fetcher.mock.calls[0]?.[1].headers['If-Match']).toBe(rocket.version)
  })

  it('requires a saved receipt with a new version before updating local content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { ...rocket, name: '수정', version: 'new-version', publishState: 'draft_saved' } }), { status: 200 })))
    const saved = await api.save('rockets', rocket.id, rocket.version, { name: '수정', series: 'A', descriptionMd: '', maxAltitudeM: '', sizeM: '', payloadKg: '' })
    expect(saved).toMatchObject({ name: '수정', version: 'new-version', publishState: 'draft_saved' })
  })

  it('rejects a success response without a confirmed write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    await expect(api.save('rockets', rocket.id, rocket.version, { name: '수정', series: 'A', descriptionMd: '', maxAltitudeM: '', sizeM: '', payloadKg: '' })).rejects.toBeInstanceOf(ApiError)
  })

  it('sends only content identity and idempotency key to publication API', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { id: 'job-1', state: 'publishing' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(api.publish('rockets', rocket.id, rocket.version, 'key-1')).resolves.toMatchObject({ id: 'job-1', state: 'publishing' })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/publish')
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ kind: 'rockets', id: rocket.id, version: rocket.version, idempotencyKey: 'key-1' })
  })

  it.each([
    [403, 'DENIED', '요청 권한이 없거나 세션이 만료되었습니다.'],
    [409, 'CONFLICT', '다른 변경 사항과 충돌했습니다. 새로고침 후 다시 시도해 주세요.'],
    [400, 'MALFORMED', '입력 내용이 API 형식에 맞지 않습니다.'],
    [503, 'UNAVAILABLE', '관리자 API를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.'],
  ])('translates server message code %s/%s', async (status, code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, message: code }), { status })))
    await expect(api.session()).rejects.toMatchObject({ status, message })
  })

  it('rejects malformed publication status instead of treating it as completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { id: 'job-1', state: 'complete' } }), { status: 200 })))
    await expect(api.publishStatus('job-1')).rejects.toMatchObject({ status: 200, message: '게시 응답 형식이 올바르지 않습니다.' })
  })

  it('rejects publication status for a different job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { id: 'job-2', state: 'published' } }), { status: 200 })))
    await expect(api.publishStatus('job-1')).rejects.toMatchObject({ status: 200, message: '게시 응답 형식이 올바르지 않습니다.' })
  })
})

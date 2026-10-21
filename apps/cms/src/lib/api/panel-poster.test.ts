import { afterEach, expect, it, vi } from 'vitest'
import { resourcesApi } from './resources'

afterEach(() => vi.unstubAllGlobals())
it('keeps the uploaded poster reference in panel writes and reads', async () => {
  const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true, data: {
    id: 'panel', version: 'v2', headline: '영상 패널', mediaId: 'video', posterMediaId: 'poster',
  } }), { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(resourcesApi.update('panels', 'panel', 'v1', { title: '영상 패널', posterMediaId: 'poster' }))
    .resolves.toMatchObject({ posterMediaId: 'poster' })
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ headline: '영상 패널', posterMediaId: 'poster' })
})

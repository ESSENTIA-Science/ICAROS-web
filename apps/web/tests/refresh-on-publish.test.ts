import { expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ version: '12' }))
vi.mock('@/lib/content/snapshot', () => ({ getSnapshot: () => ({ version: fixture.version }) }))

import { GET } from '../src/app/public-version/route'
import { checkPublishedVersion } from '../src/components/RefreshOnPublish'

it('serves the current published version without browser or CDN caching', async () => {
  fixture.version = '12'
  const first = await GET()
  expect(first.status).toBe(200)
  expect(await first.json()).toEqual({ version: '12' })
  expect(first.headers.get('Cache-Control')).toContain('no-store')
  fixture.version = '13'
  expect(await (await GET()).json()).toEqual({ version: '13' })
})

it('keeps the page when its published version is current', async () => {
  const navigate = vi.fn()
  const fetchVersion = vi.fn().mockResolvedValue('12')
  await checkPublishedVersion('12', 'https://icaros.kr/member/', fetchVersion, navigate)
  expect(fetchVersion).toHaveBeenCalledOnce()
  expect(navigate).not.toHaveBeenCalled()
})

it('loads a fresh document when a newer publication is visible', async () => {
  const navigate = vi.fn()
  await checkPublishedVersion('12', 'https://icaros.kr/member/?tab=team#lead', async () => '13', navigate)
  expect(navigate).toHaveBeenCalledWith('https://icaros.kr/member/?tab=team&__icaros_version=13#lead')
})

it('does not loop when a cache still returns the old document', async () => {
  const navigate = vi.fn()
  await checkPublishedVersion('12', 'https://icaros.kr/member/?__icaros_version=13', async () => '13', navigate)
  expect(navigate).not.toHaveBeenCalled()
})

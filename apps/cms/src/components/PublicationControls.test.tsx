import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PublicationControls, { checkPublicationJob, warnBeforeLeaving } from './PublicationControls'
import { api, ApiError } from '../lib/api/client'
import { completeCmsPublication, getCmsChanges, noteCmsChange, startCmsPublication } from '../lib/cmsChanges'

it('places one global publication action alongside the saving state', () => {
  const html = renderToStaticMarkup(<PublicationControls />)
  expect(html).toContain('변경사항 반영하기')
  expect(html).not.toContain('사이트 전체 게시</button>')
})

it('warns before closing with unpublished edits or an outstanding publication request', () => {
  const preventDefault = vi.fn()
  const event = { preventDefault, returnValue: undefined } as unknown as BeforeUnloadEvent
  noteCmsChange()
  warnBeforeLeaving(event)
  expect(preventDefault).toHaveBeenCalledTimes(1)
  startCmsPublication('warning-test', getCmsChanges().revision)
  completeCmsPublication('warning-test')
  preventDefault.mockClear()
  warnBeforeLeaving(event)
  expect(preventDefault).not.toHaveBeenCalled()
  warnBeforeLeaving(event, true)
  expect(preventDefault).toHaveBeenCalledTimes(1)
})

afterEach(() => vi.restoreAllMocks())

function pollIo() {
  return { isCancelled: () => false, setMessage: vi.fn(), setError: vi.fn(), onSessionExpired: vi.fn() }
}

it('settles a vanished job on 404', async () => {
  startCmsPublication('gone-job', getCmsChanges().revision)
  vi.spyOn(api, 'publishStatus').mockRejectedValue(new ApiError('', 404))
  const io = pollIo()
  await checkPublicationJob('gone-job', io)
  // Settling clears jobId, which re-enables the "변경사항 반영하기" button.
  expect(getCmsChanges().jobId).toBeNull()
  expect(io.setError).toHaveBeenCalledWith('반영 작업을 찾을 수 없습니다. 다시 반영해 주세요.')
  expect(io.onSessionExpired).not.toHaveBeenCalled()
})

it('hands session expiry to the app on 401/403', async () => {
  for (const status of [401, 403]) {
    const id = `expired-${status}`
    startCmsPublication(id, getCmsChanges().revision)
    vi.spyOn(api, 'publishStatus').mockRejectedValue(new ApiError('', status))
    const io = pollIo()
    await checkPublicationJob(id, io)
    expect(io.onSessionExpired).toHaveBeenCalledTimes(1)
    expect(getCmsChanges().jobId).toBe(id)
    completeCmsPublication(id)
  }
})

it('keeps polling on 503', async () => {
  startCmsPublication('flaky-job', getCmsChanges().revision)
  vi.spyOn(api, 'publishStatus').mockRejectedValue(new ApiError('', 503))
  const io = pollIo()
  await checkPublicationJob('flaky-job', io)
  expect(getCmsChanges().jobId).toBe('flaky-job')
  expect(io.onSessionExpired).not.toHaveBeenCalled()
  completeCmsPublication('flaky-job')
})

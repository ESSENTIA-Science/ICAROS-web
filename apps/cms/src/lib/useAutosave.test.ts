import { afterEach, expect, it, vi } from 'vitest'
import { AutosaveController } from './useAutosave'
import { completeCmsPublication, flushCmsChanges, getCmsChanges, hasUnpublishedChanges, noteCmsChange, removeAutosaveTask, startCmsPublication } from './cmsChanges'

afterEach(() => {
  for (const key of ['debounce', 'inflight', 'failure', 'invalid']) removeAutosaveTask(key)
  vi.useRealTimers()
})

it('debounces edits and flushes the latest value before publication', async () => {
  vi.useFakeTimers()
  const saveA = vi.fn().mockResolvedValue(undefined)
  const saveB = vi.fn().mockResolvedValue(undefined)
  const queue = new AutosaveController('debounce', () => {})
  queue.configure({ dirty: true, enabled: true, save: saveA, fingerprint: 'A', delay: 700 })
  await vi.advanceTimersByTimeAsync(400)
  queue.configure({ dirty: true, enabled: true, save: saveB, fingerprint: 'B', delay: 700 })
  await vi.advanceTimersByTimeAsync(400)
  expect(saveA).not.toHaveBeenCalled()
  expect(saveB).not.toHaveBeenCalled()
  const flush = queue.flush()
  await vi.runAllTimersAsync()
  await flush
  expect(saveB).toHaveBeenCalledTimes(1)
  queue.detach()
})

it('serializes newer edits behind an outstanding save and drains both on flush', async () => {
  let release!: () => void
  const first = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
  const second = vi.fn().mockResolvedValue(undefined)
  const queue = new AutosaveController('inflight', () => {})
  queue.configure({ dirty: true, enabled: true, save: first, fingerprint: 'first', delay: 60_000 })
  const initial = queue.flush()
  await Promise.resolve()
  queue.configure({ dirty: true, enabled: true, save: second, fingerprint: 'second', delay: 60_000 })
  const concurrent = queue.flush()
  expect(second).not.toHaveBeenCalled()
  release()
  await Promise.all([initial, concurrent])
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(1)
  queue.detach()
})

it('keeps a failed save pending and blocks publication until a successful retry', async () => {
  const queue = new AutosaveController('failure', () => {})
  const save = vi.fn().mockRejectedValueOnce(new Error('conflict')).mockResolvedValue(undefined)
  queue.configure({ dirty: true, enabled: true, save, fingerprint: 'edit', delay: 60_000 })
  await expect(queue.flush()).rejects.toThrow('conflict')
  expect(getCmsChanges().pending).toBeGreaterThan(0)
  expect(getCmsChanges().errors).toContain('conflict')
  await flushCmsChanges()
  expect(getCmsChanges().errors).not.toContain('conflict')
  queue.detach()
})

it('blocks publication of an incomplete form without issuing a save', async () => {
  const queue = new AutosaveController('invalid', () => {})
  const save = vi.fn()
  queue.configure({ dirty: true, enabled: false, save, fingerprint: 'incomplete', delay: 700 })
  await expect(flushCmsChanges()).rejects.toThrow('필수 입력값')
  expect(save).not.toHaveBeenCalled()
  queue.detach()
})

it('only clears changes included in a completed build, retaining newer edits', () => {
  const captured = getCmsChanges().revision
  startCmsPublication('job-test', captured)
  noteCmsChange()
  completeCmsPublication('job-test')
  expect(getCmsChanges().publishedRevision).toBe(captured)
  expect(hasUnpublishedChanges()).toBe(true)
  startCmsPublication('job-latest', getCmsChanges().revision)
  completeCmsPublication('job-latest')
  expect(hasUnpublishedChanges()).toBe(false)
})

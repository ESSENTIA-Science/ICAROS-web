import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const storage = new Map<string, string>()
const handlers: Array<(event: { key: string; newValue: string | null }) => void> = []
beforeEach(() => {
  storage.clear(); handlers.length = 0
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }, sessionStorage: { removeItem: vi.fn() }, addEventListener: (_type: string, listener: (event: { key: string; newValue: string | null }) => void) => handlers.push(listener) })
})
afterEach(() => vi.unstubAllGlobals())
async function tabs() { vi.resetModules(); const a = await import('./cmsChanges'); vi.resetModules(); const b = await import('./cmsChanges'); return { a, b } }
function sync(value = storage.get('icaros:cms:changes') ?? null) { handlers.forEach(h => h({ key: 'icaros:cms:changes', newValue: value })) }
it('combines changes saved from stale tabs instead of overwriting the revision', async () => {
  const { a, b } = await tabs()
  a.noteCmsChange(); b.noteCmsChange(); sync()
  expect(a.getCmsChanges().revision).toBe(2)
  expect(b.getCmsChanges().revision).toBe(2)
})
it('retains another tab publication job when recording local edits', async () => {
  const { a, b } = await tabs()
  a.noteCmsChange(); a.startCmsPublication('job', a.getCmsChanges().revision)
  b.noteCmsChange(); sync()
  expect(a.getCmsChanges().jobId).toBe('job')
  expect(b.getCmsChanges().jobId).toBe('job')
})
it('merges terminal publication without clearing newer changes or resurrecting an old job event', async () => {
  const { a, b } = await tabs()
  a.noteCmsChange(); a.startCmsPublication('job', a.getCmsChanges().revision)
  const oldJob = storage.get('icaros:cms:changes')!
  b.noteCmsChange(); a.completeCmsPublication('job'); sync()
  expect(b.getCmsChanges()).toMatchObject({ revision: 2, publishedRevision: 1, jobId: null })
  expect(b.hasUnpublishedChanges()).toBe(true)
  sync(oldJob)
  expect(a.getCmsChanges().jobId).toBeNull()
  expect(b.getCmsChanges().jobId).toBeNull()
})

it('does not bounce identical multi-tab state back into storage because object key order differs', async () => {
  const { a, b } = await tabs()
  a.noteCmsChange(); b.noteCmsChange(); sync()
  const raw = JSON.parse(storage.get('icaros:cms:changes')!) as { counters: Record<string, number> }
  raw.counters = Object.fromEntries(Object.entries(raw.counters).reverse())
  const external = JSON.stringify(raw)
  storage.set('icaros:cms:changes', external)
  const write = vi.spyOn(window.localStorage, 'setItem')
  sync(external)
  expect(write).not.toHaveBeenCalled()
})

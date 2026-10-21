import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearCmsDraftsOnLogout } from './localDrafts'
import { notifySessionExpired, onSessionExpired, stashExpiredDraft, takeExpiredDraft } from './sessionRecovery'

function storage() {
  const map = new Map<string, string>()
  return { get length() { return map.size }, key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) } }
}
beforeEach(() => { vi.stubGlobal('window', { localStorage: storage(), sessionStorage: storage() }) })
afterEach(() => vi.unstubAllGlobals())

it('round-trips a stashed draft once', () => {
  stashExpiredDraft('rockets:raon', 'v1', { name: 'RAON' })
  expect(window.sessionStorage.getItem('icaros:cms:recovery:rockets:raon')).not.toBeNull()
  expect(takeExpiredDraft('rockets:raon')).toEqual({ baseVersion: 'v1', draft: { name: 'RAON' } })
  expect(takeExpiredDraft('rockets:raon')).toBeNull()
})

it('drops recovery drafts on logout', () => {
  stashExpiredDraft('posts:p1', 'v1', { title: 'x' })
  clearCmsDraftsOnLogout()
  expect(takeExpiredDraft('posts:p1')).toBeNull()
})

it('returns null for corrupt stored data', () => {
  window.sessionStorage.setItem('icaros:cms:recovery:bad', '{not json')
  expect(takeExpiredDraft('bad')).toBeNull()
})

it('notifies subscribers once for concurrent expiries and re-arms on resubscribe', () => {
  const listener = vi.fn()
  let off = onSessionExpired(listener)
  notifySessionExpired(); notifySessionExpired()
  expect(listener).toHaveBeenCalledTimes(1)
  off(); off = onSessionExpired(listener)
  notifySessionExpired()
  expect(listener).toHaveBeenCalledTimes(2)
  off()
})

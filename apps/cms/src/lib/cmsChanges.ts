import { useSyncExternalStore } from 'react'

export type AutosaveTask = { dirty: boolean; saving: boolean; error: string; flush: () => Promise<void> }
const storageKey = 'icaros:cms:changes'
const tasks = new Map<string, AutosaveTask>()
const listeners = new Set<() => void>()
type DurableState = { revision: number; publishedRevision: number; jobId: string | null; jobRevision: number; jobStorageKey?: string | null }
let durable: DurableState = { revision: 0, publishedRevision: 0, jobId: null, jobRevision: 0, jobStorageKey: null }
try {
  const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
  const value = raw ? JSON.parse(raw) as DurableState : null
  if (value && Number.isSafeInteger(value.revision) && Number.isSafeInteger(value.publishedRevision) &&
    value.revision >= value.publishedRevision && value.publishedRevision >= 0 &&
    (value.jobId === null || typeof value.jobId === 'string') && Number.isSafeInteger(value.jobRevision)) durable = value
} catch { /* Storage unavailable: current tab still tracks changes. */ }

function snapshot() {
  return { ...durable, pending: [...tasks.values()].filter(task => task.dirty || task.saving).length,
    errors: [...tasks.values()].filter(task => task.error).map(task => task.error) }
}
let current = snapshot()
function emit(persist = false) {
  if (persist) { try { if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, JSON.stringify(durable)) } catch { /* Private browsing. */ } }
  current = snapshot()
  listeners.forEach(listener => listener())
}
export function noteCmsChange() { durable.revision++; emit(true) }
export function updateAutosaveTask(key: string, task: AutosaveTask) { tasks.set(key, task); emit() }
export function removeAutosaveTask(key: string) { tasks.delete(key); emit() }
export function useCmsChanges() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current, () => current) }
export function getCmsChanges() { return current }
export function hasUnpublishedChanges() { return current.revision > current.publishedRevision || current.pending > 0 || current.jobId !== null || current.errors.length > 0 }
export async function flushCmsChanges() {
  for (let attempt = 0; attempt < 12; attempt++) {
    const pending = [...tasks.values()].filter(task => task.dirty || task.saving || task.error)
    if (!pending.length) return
    // Serialize saves across editors that share a record version.
    for (const task of pending) await task.flush()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('저장이 아직 진행 중입니다. 잠시 후 다시 시도해 주세요.')
}
export function startCmsPublication(jobId: string, revision: number, jobStorageKey?: string) {
  durable.jobId = jobId; durable.jobRevision = revision; durable.jobStorageKey = jobStorageKey ?? null; emit(true)
}
function clearPublicationKey() {
  try { if (durable.jobStorageKey && typeof window !== 'undefined') window.sessionStorage.removeItem(durable.jobStorageKey) } catch { /* Storage unavailable. */ }
  durable.jobStorageKey = null
}
export function completeCmsPublication(jobId: string) {
  if (durable.jobId !== jobId) return
  durable.publishedRevision = Math.max(durable.publishedRevision, durable.jobRevision)
  clearPublicationKey()
  durable.jobId = null; emit(true)
}
export function failCmsPublication(jobId: string) { if (durable.jobId === jobId) { clearPublicationKey(); durable.jobId = null; emit(true) } }

export async function trackCmsOperation<T>(operation: () => Promise<T>): Promise<T> {
  const key = `upload:${crypto.randomUUID()}`
  const task = Promise.resolve().then(operation)
  updateAutosaveTask(key, { dirty: false, saving: true, error: '', flush: async () => { await task } })
  try { return await task }
  finally {
    // Allow the uploaded media ID to reach the editing form before publishing can proceed.
    await new Promise(resolve => setTimeout(resolve, 0))
    removeAutosaveTask(key)
  }
}

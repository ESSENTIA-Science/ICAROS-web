import { useSyncExternalStore } from 'react'

export type AutosaveTask = { dirty: boolean; saving: boolean; error: string; flush: () => Promise<void> }
const storageKey = 'icaros:cms:changes'
const tasks = new Map<string, AutosaveTask>()
const listeners = new Set<() => void>()
type Counters = Record<string, number>
type Publication = { counters: Counters; revision: number; storageKey: string | null }
type DurableState = { counters: Counters; publishedCounters: Counters; jobs: Record<string, Publication>; settledJobs: string[] }
const tabId = crypto.randomUUID()
const emptyState = (): DurableState => ({ counters: {}, publishedCounters: {}, jobs: {}, settledJobs: [] })
function counters(value: unknown): Counters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key, count]) => /^[a-zA-Z0-9-]{1,64}$/.test(key) && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0))
}
function total(value: Counters) { return Object.values(value).reduce((sum, count) => sum + count, 0) }
function parse(raw: string | null): DurableState {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState()
    const data = value as Record<string, unknown>
    if ('counters' in data) {
      const jobs: Record<string, Publication> = {}
      if (data.jobs && typeof data.jobs === 'object' && !Array.isArray(data.jobs)) {
        for (const [id, candidate] of Object.entries(data.jobs)) {
          if (!/^[a-zA-Z0-9-]{1,128}$/.test(id) || !candidate || typeof candidate !== 'object') continue
          const job = candidate as Publication
          if (Number.isSafeInteger(job.revision) && job.revision >= 0 && (job.storageKey === null || typeof job.storageKey === 'string'))
            jobs[id] = { counters: counters(job.counters), revision: job.revision, storageKey: job.storageKey }
        }
      }
      return { counters: counters(data.counters), publishedCounters: counters(data.publishedCounters), jobs,
        settledJobs: Array.isArray(data.settledJobs) ? data.settledJobs.filter((id): id is string => typeof id === 'string') : [] }
    }
    // Preserve unpublished changes from the previous numeric storage format.
    if (!Number.isSafeInteger(data.revision) || !Number.isSafeInteger(data.publishedRevision) ||
      Number(data.revision) < Number(data.publishedRevision) || Number(data.publishedRevision) < 0) return emptyState()
    const result = { ...emptyState(), counters: { legacy: Number(data.revision) }, publishedCounters: { legacy: Number(data.publishedRevision) } }
    if (typeof data.jobId === 'string' && Number.isSafeInteger(data.jobRevision) && Number(data.jobRevision) >= 0)
      result.jobs[data.jobId] = { counters: { legacy: Number(data.jobRevision) }, revision: Number(data.jobRevision), storageKey: typeof data.jobStorageKey === 'string' ? data.jobStorageKey : null }
    return result
  } catch { return emptyState() }
}
function mergeCounters(a: Counters, b: Counters): Counters {
  return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => [key, Math.max(a[key] ?? 0, b[key] ?? 0)]))
}
function serialize(value: DurableState) {
  const ordered = <T,>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify({ counters: ordered(value.counters), publishedCounters: ordered(value.publishedCounters),
    jobs: ordered(Object.fromEntries(Object.entries(value.jobs).map(([id, job]) => [id, { ...job, counters: ordered(job.counters) }]))),
    settledJobs: [...value.settledJobs].sort() })
}
let durable: DurableState = emptyState()
function merge(other: DurableState) {
  const settledJobs = [...new Set([...durable.settledJobs, ...other.settledJobs])]
  durable = { counters: mergeCounters(durable.counters, other.counters), publishedCounters: mergeCounters(durable.publishedCounters, other.publishedCounters),
    jobs: Object.fromEntries(Object.entries({ ...other.jobs, ...durable.jobs }).filter(([id]) => !settledJobs.includes(id))), settledJobs }
}
function readStored() {
  try { if (typeof window !== 'undefined') merge(parse(window.localStorage.getItem(storageKey))) } catch { /* Storage unavailable. */ }
}
readStored()

function snapshot() {
  const jobId = Object.keys(durable.jobs).sort()[0] ?? null
  const job = jobId ? durable.jobs[jobId] : undefined
  return { ...durable, revision: total(durable.counters), publishedRevision: total(durable.publishedCounters),
    jobId, jobRevision: job?.revision ?? 0, jobStorageKey: job?.storageKey ?? null, pending: [...tasks.values()].filter(task => task.dirty || task.saving).length,
    errors: [...tasks.values()].filter(task => task.error).map(task => task.error) }
}
let current = snapshot()
function emit(persist = false) {
  if (persist) { try { if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, serialize(durable)) } catch { /* Private browsing. */ } }
  current = snapshot()
  listeners.forEach(listener => listener())
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== storageKey || !event.newValue) return
  merge(parse(event.newValue)); readStored()
  // Repair concurrent writes by persisting the union, including completed-job tombstones.
  emit(serialize(durable) !== serialize(parse(event.newValue)))
})
export function noteCmsChange() {
  readStored()
  durable.counters = { ...durable.counters, [tabId]: (durable.counters[tabId] ?? 0) + 1 }
  emit(true)
}
export function updateAutosaveTask(key: string, task: AutosaveTask) { tasks.set(key, task); emit() }
export function removeAutosaveTask(key: string) { tasks.delete(key); emit() }
export function useCmsChanges() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current, () => current) }
export function getCmsChanges() { return current }
export function resetCmsChanges() {
  durable = emptyState()
  tasks.clear()
  try { if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey) } catch { /* Storage unavailable. */ }
  emit()
}
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
export function startCmsPublication(jobId: string, revision: number, jobStorageKey?: string, capturedCounters: Counters = durable.counters) {
  readStored()
  if (!durable.settledJobs.includes(jobId)) durable.jobs = { ...durable.jobs, [jobId]: { counters: { ...capturedCounters }, revision, storageKey: jobStorageKey ?? null } }
  emit(true)
}
function settlePublication(jobId: string, published: boolean) {
  readStored()
  const job = durable.jobs[jobId]
  if (!job) return
  if (published) durable.publishedCounters = mergeCounters(durable.publishedCounters, job.counters)
  try { if (job.storageKey && typeof window !== 'undefined') window.sessionStorage.removeItem(job.storageKey) } catch { /* Storage unavailable. */ }
  durable.settledJobs = [...new Set([...durable.settledJobs, jobId])]
  durable.jobs = Object.fromEntries(Object.entries(durable.jobs).filter(([id]) => id !== jobId))
  emit(true)
}
export function completeCmsPublication(jobId: string) { settlePublication(jobId, true) }
export function failCmsPublication(jobId: string) { settlePublication(jobId, false) }

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

/** Keeps dirty editor drafts across a session expiry and signals the app to log in again. */
export const recoveryPrefix = 'icaros:cms:recovery:'

type Stored = { baseVersion: string; draft: unknown }
const listeners = new Set<() => void>()
let notified = false

export function stashExpiredDraft(key: string, baseVersion: string, draft: unknown): void {
  if (typeof window === 'undefined') return
  try { window.sessionStorage.setItem(`${recoveryPrefix}${key}`, JSON.stringify({ baseVersion, draft } satisfies Stored)) }
  catch { /* Unavailable storage only loses the recovery copy. */ }
}

export function takeExpiredDraft<T>(key: string): { baseVersion: string; draft: T } | null {
  if (typeof window === 'undefined') return null
  try {
    const storageKey = `${recoveryPrefix}${key}`
    const raw = window.sessionStorage.getItem(storageKey)
    if (raw === null) return null
    window.sessionStorage.removeItem(storageKey)
    const parsed = JSON.parse(raw) as Partial<Stored> | null
    if (!parsed || typeof parsed.baseVersion !== 'string' || parsed.draft === undefined) return null
    return { baseVersion: parsed.baseVersion, draft: parsed.draft as T }
  } catch { return null }
}

/** Several editors can hit 401 together; listeners hear it once until a listener subscribes again. */
export function notifySessionExpired(): void {
  if (notified) return
  notified = true
  for (const listener of [...listeners]) listener()
}

export function onSessionExpired(listener: () => void): () => void {
  notified = false
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isSessionExpiry(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'status' in cause && (cause.status === 401 || cause.status === 403)
}

/** Call from a save catch block: preserves the draft and hands the expiry to the app. */
export function preserveOnSessionExpiry(cause: unknown, key: string, baseVersion: string, draft: unknown): boolean {
  if (!isSessionExpiry(cause)) return false
  stashExpiredDraft(key, baseVersion, draft)
  notifySessionExpired()
  return true
}

export const restoredMessage = '세션 만료 전 편집 내용을 복원했습니다.'

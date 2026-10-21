import { resetCmsChanges } from './cmsChanges'

const ownerKey = 'icaros:cms:draft-owner'
const localKeys = ['icaros:post-create', 'icaros:vehicle-create'] as const
const sessionPrefixes = ['icaros:publish:', 'icaros:cms:reflect:', 'icaros:cms:recovery:'] as const

function clearDrafts() {
  for (const key of localKeys) window.localStorage.removeItem(key)
  for (let index = window.sessionStorage.length - 1; index >= 0; index--) {
    const key = window.sessionStorage.key(index)
    if (key && sessionPrefixes.some(prefix => key.startsWith(prefix))) window.sessionStorage.removeItem(key)
  }
  resetCmsChanges()
}

export function bindCmsDraftsToUser(userId: string) {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(ownerKey) === userId) return
    clearDrafts()
    window.localStorage.setItem(ownerKey, userId)
  } catch { /* Unavailable storage cannot restore a previous user's draft. */ }
}

export function clearCmsDraftsOnLogout() {
  if (typeof window === 'undefined') return
  try {
    clearDrafts()
    window.localStorage.removeItem(ownerKey)
  } catch { /* Logout still completes when browser storage is unavailable. */ }
}

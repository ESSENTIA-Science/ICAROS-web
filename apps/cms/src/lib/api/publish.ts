import { api } from './client'
import type { ContentKind, PublishJob } from './types'
import type { ResourceKind } from '../resources'

export type PublishKind = ContentKind | Exclude<ResourceKind, 'vehicle-series' | 'post-attachments'> | 'rocket-series'

function storageKey(kind: PublishKind, id: string, version: string) {
  return `icaros:publish:${JSON.stringify([kind, id, version])}`
}

export async function publishDraft(kind: PublishKind, id: string, version: string): Promise<PublishJob> {
  // Persist before sending: a lost response must not turn a retry into a second job.
  const key = storageKey(kind, id, version)
  const existing = sessionStorage.getItem(key)
  const idempotencyKey = existing ?? crypto.randomUUID()
  if (!existing) sessionStorage.setItem(key, idempotencyKey)
  return api.publish(kind, id, version, idempotencyKey)
}

export function forgetPublicationKey(kind: PublishKind, id: string, version: string): void {
  sessionStorage.removeItem(storageKey(kind, id, version))
}

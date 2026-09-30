import type { EssentiaPostsAdapter, PostWrite, RepositoryResult } from '../content/types.js'
import { validDisplayDate, validPostAttachments } from '../content/validate.js'

type Config = { readonly origin: string; readonly token: string; readonly category: string; readonly authorLabel: string; readonly fetch?: typeof fetch }
type Revision = { id: string; version: number; publishedVersion: number | null; forumPostId: string | null }
export type CmsDraftPost = {
  readonly id: string; readonly version: string; readonly publishedVersion: string | null
  readonly publishState: 'draft_saved' | 'published'; readonly updatedAt: string
  readonly title: string; readonly bodyMd: string; readonly authorLabel: string
  readonly displayDate: string; readonly attachments: NonNullable<Extract<PostWrite, { operation: 'create' }>['attachments']>
}
export type SnapshotPost = { id: string; version: string; forumPostId: string; category: string; title: string; contentMd: string; displayDate: string; attachments: CmsDraftPost['attachments'] }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function revision(value: unknown): Revision {
  if (!object(value) || typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 || (value.publishedVersion !== null && !Number.isSafeInteger(value.publishedVersion)) ||
    (value.forumPostId !== null && typeof value.forumPostId !== 'string')) throw new Error('Invalid ESSENTIA response')
  return value as Revision
}
function upstreamVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('Invalid ESSENTIA version')
  return Number(value)
}
function version(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid ESSENTIA version')
  return Number(value)
}
function idSegment(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid ESSENTIA id')
  return encodeURIComponent(id)
}
export function createEssentiaPostsAdapter(config: Config): EssentiaPostsAdapter & { readSnapshot(): Promise<SnapshotPost[]>; listDrafts(): Promise<CmsDraftPost[]>; readDraft(id: string): Promise<CmsDraftPost | null>; publishDraft(id: string, expectedVersion: string): Promise<Extract<RepositoryResult, { status: 'saved' | 'conflict' | 'not_found' }>> } {
  if (!config.token || !config.category || !config.authorLabel?.trim() || !/^https:\/\/[^/?#]+$/.test(config.origin)) throw new Error('Invalid ESSENTIA configuration')
  const send = async (method: string, path: string, body?: object, key?: string): Promise<unknown> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${config.token}` }
    if (body) headers['Content-Type'] = 'application/json'
    if (key) headers['Idempotency-Key'] = key
    const response = await (config.fetch ?? fetch)(`${config.origin}/api/service/icaros/posts${path}`, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', cache: 'no-store',
    })
    if (response.status === 409) return { status: 'conflict' }
    if (response.status === 404) return { status: 'not_found' }
    if (!response.ok) throw new Error('ESSENTIA request failed')
    return response.json()
  }
  const result = (value: unknown): RepositoryResult => {
    if (object(value) && value.status === 'conflict') return { status: 'conflict' }
    if (object(value) && value.status === 'not_found') return { status: 'not_found' }
    const item = revision(value)
    return { status: 'saved', id: item.id, version: String(item.version) }
  }
  const mapDraft = (value: unknown): CmsDraftPost => {
    if (!object(value) || typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
      typeof value.title !== 'string' || typeof value.content !== 'string' || value.category !== config.category ||
      !validDisplayDate(value.displayDate) || !validPostAttachments(value.attachments) ||
      typeof value.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.updatedAt) || Number.isNaN(Date.parse(value.updatedAt)) ||
      (value.forumPostId !== null && typeof value.forumPostId !== 'string')) throw new Error('Invalid ESSENTIA draft')
    const current = upstreamVersion(value.version)
    const published = value.publishedVersion === null ? null : upstreamVersion(value.publishedVersion)
    if ((published !== null && (published > current || value.forumPostId === null)) ||
      (published === null && value.forumPostId !== null)) throw new Error('Invalid ESSENTIA draft')
    return { id: value.id, version: String(current), publishedVersion: published === null ? null : String(published),
      publishState: published === current ? 'published' : 'draft_saved', updatedAt: value.updatedAt,
      title: value.title, bodyMd: value.content, authorLabel: config.authorLabel,
      displayDate: value.displayDate, attachments: value.attachments }
  }
  const publish = async (id: string, expectedVersion: number): Promise<RepositoryResult> =>
    result(await send('POST', `/${idSegment(id)}/publish`, { expectedVersion }))
  return {
    async publishDraft(id, expectedVersion) {
      const output = await publish(id, version(expectedVersion))
      if (output.status === 'deleted') throw new Error('Invalid ESSENTIA publish result')
      return output
    },
    async create(write: Extract<PostWrite, { operation: 'create' }>) {
      const created = await send('POST', '', { category: config.category, title: write.title, content: write.bodyMd,
        displayDate: write.displayDate, attachments: write.attachments }, write.idempotencyKey)
      const initial = result(created)
      if (initial.status !== 'saved' || !write.published) return initial
      return publish(initial.id, version(initial.version))
    },
    async update(write: Extract<PostWrite, { operation: 'update' }>) {
      const updated = result(await send('PUT', `/${idSegment(write.id)}/draft`, {
        expectedVersion: version(write.version), draft: { category: config.category, title: write.title, content: write.bodyMd,
          displayDate: write.displayDate, attachments: write.attachments },
      }))
      if (updated.status !== 'saved' || !write.published) return updated
      return publish(updated.id, version(updated.version))
    },
    async delete(_write: Extract<PostWrite, { operation: 'delete' }>) {
      throw new Error('ESSENTIA delete is unsupported')
    },
    async listDrafts() {
      const raw = await send('GET', '')
      if (!Array.isArray(raw)) throw new Error('Invalid ESSENTIA draft list')
      return raw.map(mapDraft)
    },
    async readDraft(id: string) {
      const raw = await send('GET', `/${idSegment(id)}/draft`)
      if (object(raw) && raw.status === 'not_found') return null
      if (!object(raw) || !object(raw.revision) || !object(raw.draft) || raw.revision.id !== id)
        throw new Error('Invalid ESSENTIA draft detail')
      return mapDraft({ ...raw.revision, ...raw.draft })
    },
    async readSnapshot() {
      const raw = await send('GET', '/snapshot')
      if (!Array.isArray(raw)) throw new Error('Invalid ESSENTIA snapshot')
      return raw.map((value: unknown): SnapshotPost => {
        if (!object(value) || typeof value.id !== 'string' || !Number.isSafeInteger(value.version) ||
          typeof value.forumPostId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value.forumPostId) || typeof value.category !== 'string' ||
          typeof value.title !== 'string' || typeof value.content !== 'string' ||
          !validDisplayDate(value.displayDate) || !validPostAttachments(value.attachments)) throw new Error('Invalid ESSENTIA snapshot')
        return { id: value.id, version: String(value.version), forumPostId: value.forumPostId as string,
          category: value.category, title: value.title, contentMd: value.content,
          displayDate: value.displayDate, attachments: value.attachments }
      })
    },
  }
}

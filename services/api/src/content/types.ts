/** The HTTP layer supplies the original request so its auth guard can check session, origin and CSRF. */
export type RequireAdmin<Request> = (request: Request) => Promise<boolean> | boolean

export type ContentEntity = 'siteSetting' | 'rocket' | 'member' | 'panel' | 'department' | 'vehicleType' | 'rocketSeries' | 'mission'
export type ContentFields = Readonly<Record<string, string | number | boolean | null>>

export type ContentWrite =
  | { readonly operation: 'create'; readonly entity: ContentEntity; readonly id: string; readonly fields: ContentFields }
  | { readonly operation: 'update'; readonly entity: ContentEntity; readonly id: string; readonly version: string; readonly fields: ContentFields }
  | { readonly operation: 'delete'; readonly entity: ContentEntity; readonly id: string; readonly version: string }

/** Implement create as INSERT with unique-key handling. Update/delete must compare id AND version in one atomic write. */
export interface ContentRepository {
  create(write: Extract<ContentWrite, { operation: 'create' }>): Promise<RepositoryResult>
  updateIfVersion(write: Extract<ContentWrite, { operation: 'update' }>): Promise<RepositoryResult>
  deleteIfVersion(write: Extract<ContentWrite, { operation: 'delete' }>): Promise<RepositoryResult>
}

export type RepositoryResult =
  | { readonly status: 'saved'; readonly id: string; readonly version: string }
  | { readonly status: 'deleted'; readonly id: string }
  | { readonly status: 'conflict' }
  | { readonly status: 'not_found' }

export type PostAttachment = { readonly mediaId: string; readonly kind: 'image' | 'video' | 'pdf'; readonly title: string }
export type PostFields = { readonly title: string; readonly bodyMd: string; readonly displayDate: string; readonly attachments: readonly PostAttachment[]; readonly published: boolean }
export type PostWrite =
  | ({ readonly operation: 'create'; readonly idempotencyKey: string } & PostFields)
  | ({ readonly operation: 'update'; readonly id: string; readonly version: string; readonly idempotencyKey: string } & PostFields)
  | { readonly operation: 'delete'; readonly id: string; readonly version: string; readonly idempotencyKey: string }

/** Must be backed by ESSENTIA's scoped CMS API and service credentials, never local SQL.
 * Implementations must forward idempotencyKey and enforce update/delete version preconditions upstream.
 */
export interface EssentiaPostsAdapter {
  create(write: Extract<PostWrite, { operation: 'create' }>): Promise<RepositoryResult>
  update(write: Extract<PostWrite, { operation: 'update' }>): Promise<RepositoryResult>
  delete(write: Extract<PostWrite, { operation: 'delete' }>): Promise<RepositoryResult>
}

export type ContentResult =
  | { readonly ok: true; readonly status: 'saved' | 'deleted'; readonly id: string; readonly version?: string }
  | { readonly ok: false; readonly status: 'denied' | 'malformed' | 'conflict' | 'not_found' | 'unavailable' }

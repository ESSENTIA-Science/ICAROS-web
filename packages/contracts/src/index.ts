export type PublishState = 'draft_saved' | 'publishing' | 'published' | 'failed'
export type ContentKind = 'rockets' | 'site' | 'posts' | 'missions'

export interface RecordBase {
  readonly id: string
  readonly version: string
  readonly publishState: PublishState
  readonly updatedAt: string
}

export interface Rocket extends RecordBase {
  readonly name: string
  readonly series: string
  readonly descriptionMd: string
  readonly maxAltitudeM: string
  readonly sizeM: string
  readonly payloadKg: string
}

export interface SiteContent extends RecordBase {
  readonly value: string
}

export interface Post extends RecordBase {
  readonly title: string
  readonly bodyMd: string
  readonly authorLabel: string
}

export interface Mission extends RecordBase {
  readonly title: string
  readonly launchDate: string
  readonly vehicleId: string | null
  readonly location: string
  readonly outcome: 'success' | 'partial' | 'failure' | 'planned'
  readonly summary: string
  readonly bodyMd: string
  readonly coverMediaId: string | null
  readonly published: boolean
}

export interface ContentMap {
  readonly rockets: Rocket
  readonly site: SiteContent
  readonly posts: Post
  readonly missions: Mission
}

export type Editable<K extends ContentKind> = Omit<ContentMap[K], keyof RecordBase>

export interface Session {
  readonly userId: string
  readonly email: string
  readonly displayName?: string | null
}

export interface PublishJob {
  readonly id: string
  readonly state: PublishState
  readonly publishedAt?: string
  readonly failureMessage?: string
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly message: string }

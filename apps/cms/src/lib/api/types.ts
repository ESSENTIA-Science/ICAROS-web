export type {
  PublishState,
  ContentKind,
  RecordBase,
  SiteContent,
  Session,
  PublishJob,
} from '@icaros/contracts'

import type { ContentKind, ContentMap as BaseContentMap, Post as BasePost, RecordBase, Rocket as BaseRocket } from '@icaros/contracts'
export type PostAttachment = { mediaId: string; kind: 'image' | 'pdf' | 'video'; title: string }
export type Post = BasePost & { displayDate: string; attachments: PostAttachment[] }
export type Rocket = BaseRocket & { coverMediaId?: string | null }
export type ContentMap = Omit<BaseContentMap, 'posts' | 'rockets'> & { readonly posts: Post; readonly rockets: Rocket }
export type Editable<K extends ContentKind> = Omit<ContentMap[K], keyof RecordBase>

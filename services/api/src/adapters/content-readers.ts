import type { ContentRoute } from '../http.js'
import type { ContentEntity } from '../content/types.js'
import type { createPostgresContentRepository } from './postgres-content.js'
import type { createEssentiaPostsAdapter } from '../essentia/posts.js'

type Repository = Pick<ReturnType<typeof createPostgresContentRepository>, 'read' | 'list'>
type PostReader = Pick<ReturnType<typeof createEssentiaPostsAdapter>, 'listDrafts' | 'readDraft'>

const entityByRoute = {
  missions: 'mission', departments: 'department', members: 'member', 'vehicle-types': 'vehicleType',
  'rocket-series': 'rocketSeries', panels: 'panel', rockets: 'rocket', site: 'siteSetting',
} as const satisfies Partial<Record<ContentRoute, ContentEntity>>

function entityFor(route: ContentRoute): ContentEntity {
  if (!Object.hasOwn(entityByRoute, route)) throw new Error(`${route} content reader unavailable`)
  return entityByRoute[route as keyof typeof entityByRoute]
}

function dto(row: Record<string, unknown>): Record<string, unknown> {
  const updatedAt = row.updatedAt
  if (typeof row.id !== 'string' || typeof row.version !== 'string' ||
      !(updatedAt instanceof Date) || !Number.isFinite(updatedAt.getTime())) {
    throw new TypeError('Invalid content row')
  }
  const result: Record<string, unknown> = {
    ...row,
    updatedAt: updatedAt.toISOString(),
    // `published` is legacy row visibility, not evidence that this version reached the static site.
    publishState: 'draft_saved',
  }
  if (Object.hasOwn(result, 'descriptionMd') && result.descriptionMd == null) result.descriptionMd = ''
  if (Object.hasOwn(result, 'value') && result.value == null) result.value = ''
  for (const field of ['maxAltitudeM', 'sizeM', 'payloadKg'] as const) {
    if (Object.hasOwn(result, field)) result[field] = result[field] == null ? '' : String(result[field])
  }
  return result
}

/** Adapt ICAROS-owned PostgreSQL rows for the authenticated CMS API. */
export function createContentReaders(repository: Repository, posts?: PostReader) {
  return {
    contentReader: {
      async read(route: ContentRoute): Promise<unknown> {
        if (route === 'posts' && posts) return posts.listDrafts()
        return (await repository.list(entityFor(route))).map(dto)
      },
    },
    contentRecordReader: {
      async read(route: ContentRoute, id: string): Promise<unknown> {
        if (route === 'posts' && posts) return posts.readDraft(id)
        const row = await repository.read(entityFor(route), id)
        return row ? dto(row) : null
      },
    },
    postStateReader: {
      async read(id: string) {
        if (!posts) throw new Error('Post state reader unavailable')
        const draft = await posts.readDraft(id)
        return draft ? { published: draft.publishedVersion !== null, authorLabel: draft.authorLabel } : null
      },
    },
  }
}

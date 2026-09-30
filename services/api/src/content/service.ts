import { parseContentWrite, parsePostWrite } from './validate.js'
import type {
  ContentRepository, ContentResult, EssentiaPostsAdapter, RepositoryResult, RequireAdmin,
} from './types.js'

export interface ContentService<Request> {
  /** Call only from an authenticated admin HTTP route. The guard also verifies origin/CSRF. */
  editContent(request: Request, input: unknown): Promise<ContentResult>
  /** ESSENTIA is the sole post owner; this method never touches ContentRepository. */
  editPost(request: Request, input: unknown): Promise<ContentResult>
}

const DENIED: ContentResult = { ok: false, status: 'denied' }
const MALFORMED: ContentResult = { ok: false, status: 'malformed' }
const UNAVAILABLE: ContentResult = { ok: false, status: 'unavailable' }

function resultFromRepository(result: RepositoryResult): ContentResult {
  switch (result.status) {
    case 'saved':
      return typeof result.id === 'string' && result.id.length > 0 &&
        typeof result.version === 'string' && result.version.length > 0
        ? { ok: true, status: 'saved', id: result.id, version: result.version } : UNAVAILABLE
    case 'deleted':
      return typeof result.id === 'string' && result.id.length > 0
        ? { ok: true, status: 'deleted', id: result.id } : UNAVAILABLE
    case 'conflict': return { ok: false, status: 'conflict' }
    case 'not_found': return { ok: false, status: 'not_found' }
    default: return UNAVAILABLE
  }
}

/** Dependencies are mandatory. There is deliberately no DB, HTTP, or credential fallback. */
export function createContentService<Request>(dependencies: {
  readonly requireAdmin: RequireAdmin<Request>
  readonly contentRepository: ContentRepository
  readonly essentiaPosts: EssentiaPostsAdapter
}): ContentService<Request> {
  if (!dependencies || typeof dependencies.requireAdmin !== 'function' ||
    !dependencies.contentRepository || !dependencies.essentiaPosts ||
    typeof dependencies.contentRepository.create !== 'function' ||
    typeof dependencies.contentRepository.updateIfVersion !== 'function' ||
    typeof dependencies.contentRepository.deleteIfVersion !== 'function' ||
    typeof dependencies.essentiaPosts.create !== 'function' ||
    typeof dependencies.essentiaPosts.update !== 'function' ||
    typeof dependencies.essentiaPosts.delete !== 'function') {
    throw new TypeError('Content service requires admin guard, ICAROS repository and ESSENTIA adapter')
  }

  return {
    async editContent(request, input) {
      // The first operation of every mutation is authorization, before parsing or any I/O.
      try {
        if (await dependencies.requireAdmin(request) !== true) return DENIED
      } catch {
        return DENIED
      }
      const write = parseContentWrite(input)
      if (!write) return MALFORMED
      try {
        switch (write.operation) {
          case 'create': return resultFromRepository(await dependencies.contentRepository.create(write))
          case 'update': return resultFromRepository(await dependencies.contentRepository.updateIfVersion(write))
          case 'delete': return resultFromRepository(await dependencies.contentRepository.deleteIfVersion(write))
        }
      } catch {
        return UNAVAILABLE
      }
    },
    async editPost(request, input) {
      try {
        if (await dependencies.requireAdmin(request) !== true) return DENIED
      } catch {
        return DENIED
      }
      const write = parsePostWrite(input)
      if (!write) return MALFORMED
      try {
        switch (write.operation) {
          case 'create': return resultFromRepository(await dependencies.essentiaPosts.create(write))
          case 'update': return resultFromRepository(await dependencies.essentiaPosts.update(write))
          case 'delete': return resultFromRepository(await dependencies.essentiaPosts.delete(write))
        }
      } catch {
        return UNAVAILABLE
      }
    },
  }
}

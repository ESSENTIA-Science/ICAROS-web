import { createHash } from 'node:crypto'
import { createAuth, type SessionStore } from './auth/index.js'
import { createContentService, type ContentRepository, type EssentiaPostsAdapter, type ContentResult } from './content/index.js'
import { createHttpHandler, type ContentRoute, type HttpEvent } from './http.js'
import { createLoginService, type LoginDependencies } from './login.js'
import { createDepartmentService, type DepartmentRepository } from './departments.js'
import { createPublicationService, PublicationError, type BuildLauncher, type PublicationJob, type PublicationRepository } from './publish/index.js'
import type { SnapshotExporter } from './snapshot.js'
import { createMediaService, type MediaDependencies } from './media/index.js'

export interface ApiDependencies {
  readonly vehicleMedia?: {
    readGallery(id: string): Promise<unknown>
    readModel(id: string): Promise<unknown>
    saveGallery(id: string, version: string, body: unknown): Promise<unknown | null>
    saveModel(id: string, version: string, body: unknown): Promise<unknown | null>
  }
  readonly allowedOrigins: readonly string[]
  readonly authSessions: SessionStore
  readonly login: LoginDependencies
  readonly contentRepository: ContentRepository
  readonly donation?: { read(): Promise<unknown>; update(version: string, value: unknown): Promise<unknown | null> }
  readonly departmentRepository?: DepartmentRepository
  readonly essentiaPosts: EssentiaPostsAdapter
  readonly contentReader: { read(route: ContentRoute): Promise<unknown> }
  readonly contentRecordReader: { read(route: ContentRoute, id: string): Promise<unknown> }
  /** Read from ESSENTIA before editing, to preserve visibility and author display. */
  readonly postStateReader: { read(id: string): Promise<{ published: boolean; authorLabel: string } | null> }
  /** Idempotent upstream revision promotion before the ICAROS static snapshot is taken. */
  readonly publishPost?: (id: string, version: string) => Promise<{ status: 'saved' | 'conflict' | 'not_found' }>
  readonly publicationRepository: PublicationRepository
  readonly buildLauncher: BuildLauncher
  readonly snapshotExporter: SnapshotExporter
  readonly media?: MediaDependencies
  /** Checks the record's opaque version and allocates a monotonic publication version. */
  readonly publicationSource: {
    prepare(input: { kind: ContentRoute; id: string; recordVersion: string; idempotencyKey: string }): Promise<{ version: number; sourceRevision: string }>
  }
  /** Authentication for a future private build callback, separate from browser admin sessions. */
  readonly requireBuildWorker: (event: HttpEvent) => Promise<unknown>
  readonly newJobId: () => string
}

function contentResponse(result: ContentResult) {
  if (result.ok) throw new Error('Expected error result')
  const status = { denied: 403, malformed: 400, conflict: 409, not_found: 404, unavailable: 503 }[result.status]
  return { status, body: { ok: false, message: result.status.toUpperCase() } }
}

function jobResponse(job: PublicationJob) {
  return {
    id: job.id,
    state: job.status === 'draft' ? 'draft_saved' : job.status,
    ...(job.status === 'failed' ? { failureMessage: '게시 작업이 실패했습니다.' } : {}),
  }
}

function publishInput(value: unknown): { kind: ContentRoute; id: string; version: string; idempotencyKey: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (!['rockets', 'missions', 'site', 'posts', 'panels', 'members', 'departments', 'vehicle-types', 'rocket-series', 'media'].includes(input.kind as string) ||
      typeof input.id !== 'string' || !input.id || input.id.length > 128 ||
      typeof input.version !== 'string' || !input.version || input.version.length > 200 ||
      typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey) ||
      Object.keys(input).some(key => !['kind', 'id', 'version', 'idempotencyKey'].includes(key))) return null
  return {
    kind: input.kind as ContentRoute,
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    version: input.version,
  }
}

const ENTITY_BY_ROUTE = {
  missions: 'mission', departments: 'department', members: 'member', 'vehicle-types': 'vehicleType',
  'rocket-series': 'rocketSeries', rockets: 'rocket', panels: 'panel', site: 'siteSetting',
} as const

function contentEntity(route: ContentRoute) {
  return Object.hasOwn(ENTITY_BY_ROUTE, route)
    ? ENTITY_BY_ROUTE[route as keyof typeof ENTITY_BY_ROUTE] : null
}

/** Construct at Lambda startup with durable adapters. Missing adapters throw; there are no write defaults. */
export function createApiRuntime(deps: ApiDependencies) {
  if (!deps.contentReader?.read || !deps.contentRecordReader?.read || !deps.postStateReader?.read || !deps.publicationSource?.prepare ||
      !deps.newJobId || !deps.requireBuildWorker || !deps.snapshotExporter?.export) throw new Error('API adapters are required')
  const auth = createAuth({ allowedOrigins: deps.allowedOrigins, sessions: deps.authSessions })
  const login = createLoginService(deps.login)
  const requireAdmin = async (event: HttpEvent): Promise<boolean> => {
    await auth.requireAdmin(event)
    return true
  }
  const content = createContentService<HttpEvent>({
    requireAdmin,
    contentRepository: deps.contentRepository,
    essentiaPosts: deps.essentiaPosts,
  })
  const departments = deps.departmentRepository
    ? createDepartmentService<HttpEvent>({ requireAdmin, repository: deps.departmentRepository }) : null
  const media = deps.media ? createMediaService(deps.media) : null
  const unavailable = { status: 503, body: { ok: false, message: 'UNAVAILABLE' } }
  async function savedRecord(route: ContentRoute, id: string, version: string) {
    const record = await deps.contentRecordReader.read(route, id)
    if (!record || typeof record !== 'object' || (record as Record<string, unknown>).version !== version) return unavailable
    return { status: 200, body: { ok: true, data: record } }
  }
  const publish = createPublicationService<HttpEvent>({
    requireAdmin,
    requireBuildWorker: deps.requireBuildWorker,
    repository: deps.publicationRepository,
    launcher: deps.buildLauncher,
    newId: deps.newJobId,
  })

  const handler = createHttpHandler({
    async readVehicleMedia(id, kind, event) {
      if (!(await auth.readSession(event))) return { status: 403, body: { ok: false, message: 'DENIED' } }
      if (!deps.vehicleMedia) return unavailable
      try {
        const data = kind === 'gallery' ? await deps.vehicleMedia.readGallery(id) : await deps.vehicleMedia.readModel(id)
        return { status: 200, body: { ok: true, data } }
      } catch (error) {
        if (error instanceof TypeError) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
        if (error instanceof Error && error.message === 'Vehicle not found') return { status: 404, body: { ok: false, message: 'NOT_FOUND' } }
        throw error
      }
    },
    async writeVehicleMedia(id, kind, version, body, event) {
      await auth.requireAdmin(event)
      if (!deps.vehicleMedia) return unavailable
      try {
        const data = kind === 'gallery' ? await deps.vehicleMedia.saveGallery(id, version, body)
          : await deps.vehicleMedia.saveModel(id, version, body)
        return data ? { status: 200, body: { ok: true, data } }
          : { status: 409, body: { ok: false, message: 'CONFLICT' } }
      } catch (error) {
        if (error instanceof TypeError) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
        if (error instanceof Error && error.message === 'Vehicle not found') return { status: 404, body: { ok: false, message: 'NOT_FOUND' } }
        throw error
      }
    },
    async presignMedia(body, event) {
      await auth.requireAdmin(event)
      return media ? media.presign(body) : unavailable
    },
    async confirmMedia(body, event) {
      await auth.requireAdmin(event)
      return media ? media.confirm(body) : unavailable
    },
    async requireAdmin(event, mutation) {
      try {
        const session = mutation ? await auth.requireAdmin(event) : await auth.readSession(event)
        return session ? { userId: session.userId, email: session.email } : null
      } catch { return null }
    },
    async assertLoginOrigin(event) {
      try { await auth.assertTrustedOrigin(event); return true } catch { return false }
    },
    async login(event, body) {
      const result = await login.login(event, body)
      const response = { status: result.status, body: result.status === 200
        ? result.body : { ok: false, message: result.status === 429 ? 'RATE_LIMITED' : 'DENIED' } }
      return 'cookie' in result && result.cookie ? { ...response, cookie: result.cookie } : response
    },
    async logout(event) {
      const session = await auth.readSession(event)
      if (!session) return { status: 403, body: { ok: false, message: 'DENIED' } }
      const result = await login.logout(session.sessionId)
      return { status: result.status, body: { ok: true, data: {} }, cookie: result.cookie }
    },
    async readContent(route) { return { ok: true, data: route === 'donation-rounds'
      ? deps.donation ? [await deps.donation.read()] : (() => { throw new Error('Donation adapter unavailable') })() : await deps.contentReader.read(route) } },
    async createContent(route, body, event) {
      await auth.requireAdmin(event)
      if (route === 'posts') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
        const draft = body as Record<string, unknown>
        if (Object.keys(draft).some(key => !['title', 'bodyMd', 'displayDate', 'attachments', 'idempotencyKey'].includes(key))) {
          return { status: 400, body: { ok: false, message: 'MALFORMED' } }
        }
        const result = await content.editPost(event, { operation: 'create', title: draft.title,
          bodyMd: draft.bodyMd, displayDate: draft.displayDate, attachments: draft.attachments,
          idempotencyKey: draft.idempotencyKey, published: false })
        if (!result.ok) return contentResponse(result)
        return savedRecord(route, result.id, result.version!)
      }
      const entity = contentEntity(route)
      if (!entity || !body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
      const { id, ...fields } = body as Record<string, unknown>
      const result = await content.editContent(event, { operation: 'create', entity, id, fields })
      if (!result.ok) return contentResponse(result)
      return savedRecord(route, result.id, result.version!)
    },
    async writeContent(route, id, version, body, event) {
      if (route === 'donation-rounds') {
        await auth.requireAdmin(event)
        if (id !== 'current' || !deps.donation) return { status: 404, body: { ok: false, message: 'NOT_FOUND' } }
        try {
          const saved = await deps.donation.update(version, body)
          return saved ? { status: 200, body: { ok: true, data: saved } }
            : { status: 409, body: { ok: false, message: 'CONFLICT' } }
        } catch (error) {
          if (error instanceof TypeError) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
          throw error
        }
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
      const draft = body as Record<string, unknown>
      const fields = route === 'rockets' ? { ...draft } : draft
      if (route === 'rockets') {
        for (const key of ['maxAltitudeM', 'sizeM', 'payloadKg']) {
          if (fields[key] === '') fields[key] = null
        }
      }
      let postState: { published: boolean; authorLabel: string } | null = null
      if (route === 'posts') {
        postState = await deps.postStateReader.read(id)
        if (!postState) return { status: 404, body: { ok: false, message: 'NOT_FOUND' } }
        if (typeof draft.authorLabel !== 'string' || draft.authorLabel !== postState.authorLabel) {
          return { status: 422, body: { ok: false, message: 'AUTHOR_LABEL_CHANGE_UNSUPPORTED' } }
        }
      }
      const entity = contentEntity(route)
      if (route !== 'posts' && !entity) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
      const input = route === 'posts'
        ? { operation: 'update', id, version,
            idempotencyKey: createHash('sha256').update(JSON.stringify({ id, version, draft })).digest('hex'),
            title: draft.title, bodyMd: draft.bodyMd, displayDate: draft.displayDate,
            attachments: draft.attachments, published: false }
        : { operation: 'update', entity, id, version, fields }
      const result = route === 'posts' ? await content.editPost(event, input) : await content.editContent(event, input)
      if (!result.ok) return contentResponse(result)
      return savedRecord(route, id, result.version!)
    },
    async deleteContent(route, id, version, body, event) {
      if (route === 'departments') {
        if (!departments) return unavailable
        const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
        if (value && (Object.keys(value).some(key => key !== 'reassignTo') ||
          (value.reassignTo !== null && typeof value.reassignTo !== 'string'))) {
          return { status: 400, body: { ok: false, message: 'MALFORMED' } }
        }
        const result = await departments.delete(event, { id, version,
          ...(value && Object.hasOwn(value, 'reassignTo') ? { reassignTo: value.reassignTo as string | null } : {}) })
        if (!result.ok) return { status: result.code === 'DENIED' ? 403 : result.code === 'MALFORMED' ? 400 :
          result.code === 'NOT_FOUND' ? 404 : result.code === 'UNAVAILABLE' ? 503 : 409,
          body: { ok: false, message: result.code, ...(result.memberCount === undefined ? {} : { memberCount: result.memberCount }) } }
        return { status: 200, body: { ok: true, data: { id, reassigned: result.reassigned } } }
      }
      if (body !== null) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
      const entity = contentEntity(route)
      if (!entity || entity === 'siteSetting') return { status: 405, body: { ok: false, message: 'METHOD_NOT_ALLOWED' } }
      const result = await content.editContent(event, { operation: 'delete', entity, id, version })
      return result.ok ? { status: 200, body: { ok: true, data: { id } } } : contentResponse(result)
    },
    async startPublish(body, event) {
      // The source allocator and snapshot exporter perform writes. Guard them too,
      // including callers that invoke this operation outside the HTTP router.
      await auth.requireAdmin(event)
      const input = publishInput(body)
      if (!input) return { status: 400, body: { ok: false, message: 'MALFORMED' } }
      try {
        if (input.kind === 'posts') {
          if (!deps.publishPost) return unavailable
          const upstream = await deps.publishPost(input.id, input.version)
          if (upstream.status !== 'saved') return { status: upstream.status === 'not_found' ? 404 : 409,
            body: { ok: false, message: upstream.status === 'not_found' ? 'NOT_FOUND' : 'CONFLICT' } }
        }
        const prepared = await deps.publicationSource.prepare({ kind: input.kind, id: input.id, recordVersion: input.version, idempotencyKey: input.idempotencyKey })
        const artifact = await deps.snapshotExporter.export(prepared.version)
        const job = await publish.requestPublish(event, { idempotencyKey: input.idempotencyKey, ...prepared, ...artifact })
        return { status: 202, body: { ok: true, data: jobResponse(job) } }
      }
      catch (error) {
        if (error instanceof PublicationError) {
          return { status: error.code === 'INVALID_INPUT' ? 400 : 409, body: { ok: false, message: error.code } }
        }
        throw error
      }
    },
    async readPublish(id) {
      const job = await publish.getJob(id)
      return job ? { status: 200, body: { ok: true, data: jobResponse(job) } }
        : { status: 404, body: { ok: false, message: 'NOT_FOUND' } }
    },
    async retryPublish(id, event) {
      try { return { status: 202, body: { ok: true, data: jobResponse(await publish.retry(event, id)) } } }
      catch (error) {
        if (error instanceof PublicationError) return { status: error.code === 'NOT_FOUND' ? 404 : 409, body: { ok: false, message: error.code } }
        throw error
      }
    },
    async requireBuildWorker(event) {
      try { await deps.requireBuildWorker(event); return true } catch { return false }
    },
    async finishPublish(id, attempt, succeeded, event) {
      const job = succeeded ? await publish.completeBuild(event, id, attempt) : await publish.failBuild(event, id, attempt)
      return { status: 200, body: { ok: true, data: jobResponse(job) } }
    },
  })
  return { handler, completeBuild: publish.completeBuild, failBuild: publish.failBuild }
}

export function createApiHandler(deps: ApiDependencies) {
  return createApiRuntime(deps).handler
}

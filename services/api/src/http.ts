export interface HttpEvent {
  readonly version?: string
  readonly rawPath: string
  readonly requestContext: { readonly http: { readonly method: string; readonly sourceIp?: string } }
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly cookies?: readonly string[]
  readonly body?: string | null
  readonly isBase64Encoded?: boolean
}

export interface HttpResponse {
  readonly statusCode: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly cookies?: readonly string[]
}

export type ContentRoute = import('@icaros/contracts').ContentKind | 'departments' | 'members' | 'vehicle-types' | 'rocket-series' | 'panels' | 'media' | 'donation-rounds'

export interface AdminOperations {
  readVehicleMedia?(id: string, kind: 'gallery' | 'model', event: HttpEvent): Promise<{ status: number; body: unknown }>
  writeVehicleMedia?(id: string, kind: 'gallery' | 'model', version: string, body: unknown, event: HttpEvent): Promise<{ status: number; body: unknown }>
  presignMedia?(body: unknown, event: HttpEvent): Promise<{ status: number; body: unknown }>
  confirmMedia?(body: unknown, event: HttpEvent): Promise<{ status: number; body: unknown }>
  /** Read checks the session; write checks Origin and session. Both fail closed. */
  requireAdmin(event: HttpEvent, mutation: boolean): Promise<{ userId: string; email: string } | null>
  /** Login has no session yet, so Origin must be checked separately before body parsing. */
  assertLoginOrigin(event: HttpEvent): Promise<boolean>
  /** Verify credentials and rate limit through a durable store. */
  login(event: HttpEvent, body: unknown): Promise<{ status: number; body: unknown; cookie?: string }>
  logout(event: HttpEvent): Promise<{ status: number; body: unknown; cookie?: string }>
  readContent(route: ContentRoute, event: HttpEvent): Promise<unknown>
  writeContent(route: ContentRoute, id: string, version: string, body: unknown, event: HttpEvent): Promise<{ status: number; body: unknown }>
  createContent?(route: ContentRoute, body: unknown, event: HttpEvent): Promise<{ status: number; body: unknown }>
  deleteContent?(route: ContentRoute, id: string, version: string, body: unknown, event: HttpEvent): Promise<{ status: number; body: unknown }>
  startPublish(body: unknown, event: HttpEvent): Promise<{ status: number; body: unknown }>
  readPublish(id: string, event: HttpEvent): Promise<{ status: number; body: unknown }>
  retryPublish(id: string, event: HttpEvent): Promise<{ status: number; body: unknown }>
  requireBuildWorker(event: HttpEvent): Promise<boolean>
  finishPublish(id: string, attempt: number, succeeded: boolean, event: HttpEvent): Promise<{ status: number; body: unknown }>
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
} as const

function json(statusCode: number, body: unknown, cookie?: string): HttpResponse {
  const response: HttpResponse = { statusCode, headers: BASE_HEADERS, body: JSON.stringify(body) }
  return cookie ? { ...response, cookies: [cookie] } : response
}

function parseBody(event: HttpEvent): unknown {
  const raw = event.body ?? ''
  if (raw.length > 128_000) throw new Error('malformed')
  const decoded = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw
  if (!decoded) throw new Error('malformed')
  return JSON.parse(decoded) as unknown
}

function decodeId(value: string): string | null {
  try { return decodeURIComponent(value) } catch { return null }
}

export function createHttpHandler(ops: AdminOperations) {
  return async (event: HttpEvent): Promise<HttpResponse> => {
    try {
      const method = event.requestContext.http.method.toUpperCase()
      const path = event.rawPath
      if (method === 'POST' && path === '/api/admin/login') {
        if (!(await ops.assertLoginOrigin(event))) return json(403, { ok: false, message: 'DENIED' })
        const result = await ops.login(event, parseBody(event))
        return json(result.status, result.body, result.cookie)
      }

      const worker = /^\/api\/internal\/publish\/([A-Za-z0-9_-]{1,128})\/(complete|fail)$/.exec(path)
      if (method === 'POST' && worker?.[1]) {
        if (!(await ops.requireBuildWorker(event))) return json(403, { ok: false, message: 'DENIED' })
        const body = parseBody(event)
        const attempt = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).attempt : null
        if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1) return json(400, { ok: false, message: 'MALFORMED' })
        const result = await ops.finishPublish(worker[1], attempt, worker[2] === 'complete', event)
        return json(result.status, result.body)
      }

      const mutation = method !== 'GET'
      const admin = await ops.requireAdmin(event, mutation)
      if (!admin) return json(403, { ok: false, message: 'DENIED' })

      if (method === 'GET' && path === '/api/admin/session') {
        return json(200, { ok: true, data: admin })
      }
      if (method === 'POST' && path === '/api/admin/logout') {
        const result = await ops.logout(event)
        return json(result.status, result.body, result.cookie)
      }
      if (method === 'POST' && path === '/api/admin/media/presign') {
        if (!ops.presignMedia) return json(503, { ok: false, message: 'UNAVAILABLE' })
        const result = await ops.presignMedia(parseBody(event), event)
        return json(result.status, result.body)
      }
      if (method === 'POST' && path === '/api/admin/media/confirm') {
        if (!ops.confirmMedia) return json(503, { ok: false, message: 'UNAVAILABLE' })
        const result = await ops.confirmMedia(parseBody(event), event)
        return json(result.status, result.body)
      }

      const vehicleMedia = /^\/api\/admin\/content\/vehicles\/([^/]+)\/(gallery|model)$/.exec(path)
      if (vehicleMedia?.[1] && vehicleMedia[2]) {
        const id = decodeId(vehicleMedia[1])
        const kind = vehicleMedia[2] as 'gallery' | 'model'
        if (!id) return json(400, { ok: false, message: 'MALFORMED' })
        if (method === 'GET' && ops.readVehicleMedia) {
          const result = await ops.readVehicleMedia(id, kind, event)
          return json(result.status, result.body)
        }
        if (method === 'PUT' && ops.writeVehicleMedia) {
          const versions = Object.entries(event.headers ?? {}).filter(([key]) => key.toLowerCase() === 'if-match')
          const version = versions[0]?.[1]
          if (versions.length !== 1 || !version || version.length > 200) return json(400, { ok: false, message: 'MALFORMED' })
          const result = await ops.writeVehicleMedia(id, kind, version, parseBody(event), event)
          return json(result.status, result.body)
        }
        return json(405, { ok: false, message: 'METHOD_NOT_ALLOWED' })
      }

      const content = /^\/api\/admin\/content\/(departments|members|vehicle-types|rocket-series|rockets|missions|panels|site|media|posts|donation-rounds)(?:\/([^/]+))?$/.exec(path)
      if (content) {
        const route = content[1] as ContentRoute
        if (method === 'GET' && !content[2]) return json(200, await ops.readContent(route, event))
        if (method === 'POST' && !content[2] && ops.createContent) {
          const result = await ops.createContent(route, parseBody(event), event)
          return json(result.status, result.body)
        }
        if (method === 'PUT' || method === 'DELETE') {
          const id = content[2]
          const versions = Object.entries(event.headers ?? {}).filter(([key]) => key.toLowerCase() === 'if-match')
          const version = versions[0]?.[1]
          const decodedId = id ? decodeId(id) : null
          if (!decodedId || versions.length !== 1 || !version || version.length > 200) return json(400, { ok: false, message: 'MALFORMED' })
          const result = method === 'PUT'
            ? await ops.writeContent(route, decodedId, version, parseBody(event), event)
            : ops.deleteContent ? await ops.deleteContent(route, decodedId, version, event.body ? parseBody(event) : null, event)
              : { status: 405, body: { ok: false, message: 'METHOD_NOT_ALLOWED' } }
          return json(result.status, result.body)
        }
        return json(405, { ok: false, message: 'METHOD_NOT_ALLOWED' })
      }

      if (method === 'POST' && path === '/api/admin/publish') {
        const result = await ops.startPublish(parseBody(event), event)
        return json(result.status, result.body)
      }
      const job = /^\/api\/admin\/publish\/([A-Za-z0-9_-]{1,128})$/.exec(path)
      if (method === 'GET' && job?.[1]) {
        const result = await ops.readPublish(job[1], event)
        return json(result.status, result.body)
      }
      const retry = /^\/api\/admin\/publish\/([A-Za-z0-9_-]{1,128})\/retry$/.exec(path)
      if (method === 'POST' && retry?.[1]) {
        const result = await ops.retryPublish(retry[1], event)
        return json(result.status, result.body)
      }
      return json(404, { ok: false, message: 'NOT_FOUND' })
    } catch (error) {
      if (error instanceof SyntaxError || (error instanceof Error && error.message === 'malformed')) {
        return json(400, { ok: false, message: 'MALFORMED' })
      }
      return json(503, { ok: false, message: 'UNAVAILABLE' })
    }
  }
}

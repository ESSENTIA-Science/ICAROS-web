import { randomUUID } from 'node:crypto'

type Kind = 'media' | 'hero' | 'poster' | 'video' | 'glb' | 'pdf'
type Policy = { folder: string; extension: string; mime: string; max: number }
const MB = 1024 * 1024
// Matches legacy image policy; PDF is a new, conservative CMS-only policy.
const policies: Record<Kind, Policy> = {
  media: { folder: 'media', extension: 'webp', mime: 'image/webp', max: MB },
  hero: { folder: 'media', extension: 'webp', mime: 'image/webp', max: 2 * MB },
  poster: { folder: 'poster', extension: 'webp', mime: 'image/webp', max: 2 * MB },
  video: { folder: 'video', extension: 'mp4', mime: 'video/mp4', max: 32 * MB },
  glb: { folder: 'glb', extension: 'glb', mime: 'model/gltf-binary', max: 8 * MB },
  pdf: { folder: 'media', extension: 'pdf', mime: 'application/pdf', max: 8 * MB },
}

export interface MediaRecord {
  id: string
  bucket: string
  key: string
  mime: string
  declaredSize: number
  status: 'pending' | 'ready' | 'failed'
}
export interface MediaDependencies {
  bucket: string
  prefix: string
  records: {
    create(row: Omit<MediaRecord, 'id'> & { originalFilename: string | null }): Promise<string>
    find(id: string): Promise<MediaRecord | null>
    ready(id: string, size: number, etag: string | null): Promise<boolean>
    fail(id: string): Promise<void>
  }
  objects: {
    signPut(input: { bucket: string; key: string; contentType: string; expiresIn: number; signableHeaders: readonly ['content-type', 'host'] }): Promise<string>
    head(bucket: string, key: string): Promise<{ size: number; contentType: string | null; etag: string | null } | null>
    prefix(bucket: string, key: string, bytes: number): Promise<Uint8Array | null>
    remove(bucket: string, key: string): Promise<void>
  }
}
type Result = { status: number; body: { ok: boolean; message?: string; data?: unknown } }
const error = (status: number, message: string): Result => ({ status, body: { ok: false, message } })
const isObject = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input)
const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()
const forbiddenName = (name: string) => !name || name.length > 255 || /[/\\\x00-\x1f\x7f]/.test(name) || /\.(svgz?|xml|html?)$/i.test(name)
const validKey = (key: string, prefix: string) => key.startsWith(`${prefix}/`) && !key.includes('//') && !key.includes('\\') && !key.split('/').some(part => part === '..' || part === '.')
function matches(mime: string, bytes: Uint8Array): boolean {
  const ascii = (n: number) => Buffer.from(bytes.subarray(0, n)).toString('ascii')
  if (mime === 'image/webp') return ascii(4) === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  if (mime === 'video/mp4') return Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp'
  if (mime === 'model/gltf-binary') return ascii(4) === 'glTF'
  if (mime === 'application/pdf') return ascii(5) === '%PDF-'
  return false
}

export function createMediaService(deps: MediaDependencies) {
  if (!deps.bucket || !/^[a-z0-9][a-z0-9-]*$/.test(deps.prefix) || deps.prefix === 'forum') throw new Error('Private media configuration required')
  return {
    async presign(input: unknown): Promise<Result> {
      if (!isObject(input) || typeof input.kind !== 'string' || !(input.kind in policies) ||
          typeof input.contentType !== 'string' || typeof input.size !== 'number' ||
          (input.originalFilename !== undefined && typeof input.originalFilename !== 'string') ||
          Object.keys(input).some(k => !['kind', 'contentType', 'size', 'originalFilename'].includes(k))) return error(400, 'MALFORMED')
      const policy = policies[input.kind as Kind]
      const filename = input.originalFilename as string | undefined
      if (filename !== undefined && (forbiddenName(filename) || (policy.extension !== 'webp' && ext(filename) !== policy.extension))) return error(415, 'WRONG_TYPE')
      if (input.contentType !== policy.mime) return error(415, 'WRONG_TYPE')
      if (!Number.isSafeInteger(input.size) || input.size <= 0) return error(400, 'MALFORMED')
      if (input.size > policy.max) return error(413, 'TOO_LARGE')
      const key = `${deps.prefix}/${policy.folder}/${randomUUID()}.${policy.extension}`
      const mediaId = await deps.records.create({ bucket: deps.bucket, key, mime: policy.mime, declaredSize: input.size, status: 'pending', originalFilename: filename ?? null })
      const uploadUrl = await deps.objects.signPut({ bucket: deps.bucket, key, contentType: policy.mime, expiresIn: 600, signableHeaders: ['content-type', 'host'] })
      return { status: 201, body: { ok: true, data: { mediaId, key, uploadUrl, contentType: policy.mime } } }
    },
    async confirm(input: unknown): Promise<Result> {
      if (!isObject(input) || typeof input.mediaId !== 'string' || !input.mediaId || Object.keys(input).some(k => k !== 'mediaId')) return error(400, 'MALFORMED')
      const row = await deps.records.find(input.mediaId)
      if (!row) return error(404, 'NOT_FOUND')
      if (row.status !== 'pending') return error(409, 'CONFLICT')
      if (row.bucket !== deps.bucket || !validKey(row.key, deps.prefix) || !Object.values(policies).some(p => row.key.startsWith(`${deps.prefix}/${p.folder}/`) && row.key.endsWith(`.${p.extension}`) && row.mime === p.mime)) return error(403, 'DENIED')
      const head = await deps.objects.head(row.bucket, row.key)
      if (!head) return error(404, 'OBJECT_MISSING')
      if (!Number.isSafeInteger(head.size) || head.size <= 0 || head.size > row.declaredSize) {
        await deps.objects.remove(row.bucket, row.key)
        await deps.records.fail(row.id)
        return error(413, 'TOO_LARGE')
      }
      const prefix = await deps.objects.prefix(row.bucket, row.key, 16)
      if (head.contentType !== row.mime || !prefix || !matches(row.mime, prefix)) {
        await deps.objects.remove(row.bucket, row.key)
        await deps.records.fail(row.id)
        return error(415, 'WRONG_TYPE')
      }
      if (!(await deps.records.ready(row.id, head.size, head.etag))) return error(409, 'CONFLICT')
      return { status: 200, body: { ok: true, data: { id: row.id, size: head.size, mime: row.mime } } }
    },
  }
}

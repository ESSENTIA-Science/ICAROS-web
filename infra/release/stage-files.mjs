import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { exportContentType } from './export.mjs'
import { boundedMap } from './upload-assets.mjs'

const safePath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') &&
  value.split('/').every(part => part && part !== '.' && part !== '..' && /^[a-zA-Z0-9_.,!$-]+$/.test(part))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function stageFiles({ root, bucket, prefix, files, s3, concurrency = 12 }) {
  if (!root || !bucket || !safePath(prefix) || !Array.isArray(files) || !files.length || !s3?.send)
    throw new TypeError('Invalid stage inputs')
  const seen = new Set()
  const prepared = files.map(file => {
    if (!safePath(file.path) || seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error('Invalid staged file')
    seen.add(file.path)
    const bytes = readFileSync(join(root, file.path))
    if (hash(bytes) !== file.sha256) throw new Error('Staged file changed after export preparation')
    return { ...file, bytes, checksum: Buffer.from(file.sha256, 'hex').toString('base64'), contentType: exportContentType(file.path) }
  })
  await boundedMap(prepared, concurrency, async file => {
    const key = `${prefix}/${file.path}`
    try {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.bytes,
        ChecksumSHA256: file.checksum, ContentType: file.contentType, IfNoneMatch: '*' }))
    } catch (error) {
      if (error?.name !== 'PreconditionFailed' && error?.$metadata?.httpStatusCode !== 412)
        throw new Error('Staged file upload failed', { cause: error })
      const existing = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }))
      if (existing.ChecksumSHA256 !== file.checksum || existing.ContentLength !== file.bytes.length ||
        existing.ContentType !== file.contentType) throw new Error('Existing staged file differs')
    }
  })
}

export async function publishStagedRelease({ uploadAssets, stage, putManifest }) {
  await uploadAssets()
  await stage()
  await putManifest()
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sharedAssetPath } from './asset-contract.mjs'
import { createHash } from 'node:crypto'

/** Create-only immutable upload. Existing keys must match exact bytes; never overwrite.
 * aws is an injected CLI boundary so tests never access AWS.
 */
export function uploadSharedAssets({ root, bucket, assets, aws }) {
  for (const asset of assets) {
    if (!sharedAssetPath(asset.path) || !/^release-assets\/[a-f0-9]{64}\//.test(asset.key) || asset.key.split('/').slice(2).join('/') !== asset.path) throw new Error('Invalid shared asset key')
    const path = join(root, asset.path)
    const bytes = readFileSync(path)
    const digest = createHash('sha256').update(bytes).digest()
    if (digest.toString('hex') !== asset.sha256) throw new Error('Asset changed after export preparation')
    const checksum = digest.toString('base64')
    const result = aws(['s3api', 'put-object', '--bucket', bucket, '--key', asset.key,
      '--body', path, '--if-none-match', '*', '--checksum-sha256', checksum,
      '--content-type', asset.contentType, '--cache-control', 'public, max-age=31536000, immutable'])
    if (result.status === 0) continue
    // Do not hide authorization/network failures as a successful dedupe.
    if (!/\b(?:PreconditionFailed|412)\b/.test(result.stderr ?? '')) throw new Error('Shared immutable asset upload failed')
    const head = aws(['s3api', 'head-object', '--bucket', bucket, '--key', asset.key, '--checksum-mode', 'ENABLED', '--output', 'json'])
    if (head.status !== 0) throw new Error('Cannot verify existing shared asset')
    let value
    try { value = JSON.parse(head.stdout) } catch { throw new Error('Invalid shared asset metadata') }
    if (value.ChecksumSHA256 !== checksum || value.ContentLength !== bytes.length ||
        value.ContentType !== asset.contentType || value.CacheControl !== 'public, max-age=31536000, immutable') throw new Error('Existing shared asset differs from prepared bytes')
  }
}

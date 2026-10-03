import '@aws-sdk/signature-v4a'
import { CloudFrontKeyValueStoreClient, GetKeyCommand } from '@aws-sdk/client-cloudfront-keyvaluestore'
import { Readable } from 'node:stream'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('actual KVS middleware registers JS SigV4a and signs before an offline transport', async () => {
  let captured
  const client = new CloudFrontKeyValueStoreClient({ region: 'us-east-1',
    credentials: { accessKeyId: 'SYNTHETICACCESSKEY', secretAccessKey: 'synthetic-secret-not-a-credential' },
    requestHandler: { handle: async request => {
      captured = request
      return { response: { statusCode: 200, headers: { 'content-type': 'application/json' },
        body: Readable.from([JSON.stringify({ Key: 'release', Value: 'synthetic-release' })]) } }
    } }, maxAttempts: 1,
  })
  try {
    const result = await client.send(new GetKeyCommand({
      KvsARN: 'arn:aws:cloudfront::000000000000:key-value-store/00000000-0000-0000-0000-000000000000', Key: 'release',
    }))
    assert.equal(result.Value, 'synthetic-release')
    assert.ok(captured.headers.authorization.startsWith('AWS4-ECDSA-P256-SHA256 '))
    assert.equal(captured.headers['x-amz-region-set'], '*')
    assert.ok(captured.hostname.endsWith('.cloudfront-kvs.global.api.aws'))
  } finally { client.destroy() }
})

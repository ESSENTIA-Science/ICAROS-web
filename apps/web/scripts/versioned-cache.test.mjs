import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { test } from 'node:test'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createVersionedIncrementalCache } from '../src/lib/content/versioned-cache.mjs'

const baseline = 'a'.repeat(64)
const changed = 'b'.repeat(64)

test('late publish cache write cannot overwrite the rollback snapshot cache', async () => {
  const scope = new AsyncLocalStorage()
  const objects = new Map()
  let releaseWrite
  const writeGate = new Promise(resolve => { releaseWrite = resolve })
  const s3 = {
    async send(command) {
      if (command instanceof PutObjectCommand) {
        if (String(command.input.Body).includes('new content')) await writeGate
        objects.set(command.input.Key, String(command.input.Body))
        return {}
      }
      if (command instanceof GetObjectCommand) {
        const body = objects.get(command.input.Key)
        if (!body) throw new Error('NoSuchKey')
        return { Body: { async transformToString() { return body } }, LastModified: new Date() }
      }
      throw new Error('Unexpected S3 command')
    },
  }
  const cache = createVersionedIncrementalCache({ s3, bucket: 'cache', buildId: 'build-1', prefix: 'isr',
    currentSnapshot: () => scope.getStore() })
  await scope.run(baseline, () => cache.set('member', { html: 'old content' }, 'cache'))
  const lateWrite = scope.run(changed, () => cache.set('member', { html: 'new content' }, 'cache'))
  const rollbackRead = await scope.run(baseline, () => cache.get('member', 'cache'))
  assert.equal(rollbackRead.value.html, 'old content')
  releaseWrite()
  await lateWrite
  const afterLateWrite = await scope.run(baseline, () => cache.get('member', 'cache'))
  assert.equal(afterLateWrite.value.html, 'old content')
  assert.equal((await scope.run(changed, () => cache.get('member', 'cache'))).value.html, 'new content')
  assert.equal(objects.size, 2)
})

test('cache access without a pinned snapshot fails closed', async () => {
  const cache = createVersionedIncrementalCache({ s3: { async send() { throw new Error('should not call S3') } },
    bucket: 'cache', buildId: 'build-1', prefix: 'isr', currentSnapshot: () => undefined })
  await assert.rejects(cache.get('member', 'cache'), /snapshot context/i)
})

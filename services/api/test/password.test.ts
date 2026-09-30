import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hash } from '@node-rs/argon2'
import { verifyAdminPassword } from '../src/auth/password.js'

test('verifies existing Argon2id hashes and rejects invalid credentials', async () => {
  const stored = await hash('local-test-password', { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })
  assert.equal(await verifyAdminPassword(stored, 'local-test-password'), true)
  assert.equal(await verifyAdminPassword(stored, 'wrong'), false)
  assert.equal(await verifyAdminPassword('corrupt', 'local-test-password'), false)
})

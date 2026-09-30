import test from 'node:test'
import assert from 'node:assert/strict'
import { validPostAttachments } from '../src/content/validate.js'

const mediaId = '123e4567-e89b-42d3-a456-426614174000'
test('post attachment validator accepts video and rejects unsupported kinds and extra fields', () => {
  assert.equal(validPostAttachments([{ mediaId, kind: 'video', title: '시험 영상' }]), true)
  assert.equal(validPostAttachments([{ mediaId, kind: 'audio', title: '녹음' }]), false)
  assert.equal(validPostAttachments([{ mediaId, kind: 'video', title: '시험 영상', url: 'https://example.org' }]), false)
})

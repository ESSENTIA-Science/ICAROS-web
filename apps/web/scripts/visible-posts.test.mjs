import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visiblePosts } from '../src/lib/posts/visible.mjs'

test('hides only an exact legacy mirror while keeping its community copy', () => {
  const posts = [
    { id: 'old', source: 'legacy', title: 'Flight', contentMd: 'Same body', displayDate: '2026-01-24' },
    { id: 'new', source: 'community', title: 'Flight', contentMd: 'Same body', displayDate: '2026-01-16' },
    { id: 'different', source: 'legacy', title: 'Flight', contentMd: 'Different body', displayDate: '2026-01-16' },
  ]
  assert.deepEqual(visiblePosts(posts).map(post => post.id), ['new', 'different'])
  assert.equal(posts.length, 3)
})

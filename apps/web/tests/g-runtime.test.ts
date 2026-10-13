import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('refreshes validated G pointers, preserves public filtering, and does not cache an invalid pointer', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'icaros-g-runtime-'))
  vi.stubEnv('ICAROS_RUNTIME_POINTER', join(temp, 'pointer.json'))
  vi.resetModules()
  try {
    const { getSnapshot, exportedRoutes } = await import('../src/lib/content/snapshot')
    const { getFeed } = await import('../src/lib/posts/feed')
    const fixture = JSON.parse(readFileSync(new URL('../fixtures/public.synthetic.json', import.meta.url), 'utf8'))
    Object.assign(fixture, { sections: [], panels: [], vehicles: [], members: [], missions: [], media: {}, taxonomy: { types: [], series: [] } })
    const post = { id: 'community', source: 'community', title: 'Synthetic', contentMd: 'Synthetic body', displayDate: '2026-10-01', excerpt: '', thumb: null, published: true }
    const select = (version: string, posts: unknown[]) => {
      const path = join(temp, version + '.json')
      const bytes = Buffer.from(JSON.stringify({ ...fixture, version, posts }))
      writeFileSync(path, bytes)
      const pointer = JSON.stringify({ path, sha256: createHash('sha256').update(bytes).digest('hex') })
      writeFileSync(join(temp, 'pointer.json'), pointer)
      return pointer
    }
    select('first', [post, { ...post, id: 'mirror', source: 'legacy', slug: 'mirror' }])
    const first = getSnapshot()
    expect(getSnapshot()).toBe(first)
    expect(getFeed(0, 15).items.map(item => item.id)).toEqual(['community'])
    expect(exportedRoutes()).not.toContain('/posts/legacy/mirror')
    const pinnedBytes = readFileSync(join(temp, 'first.json'))
    const firstSha = createHash('sha256').update(pinnedBytes).digest('hex')
    const scopedPath = `/tmp/icaros-snapshot-${firstSha}.json`
    copyFileSync(join(temp, 'first.json'), scopedPath)
    const secondPointer = select('second', [{ ...post, id: 'fresh' }])
    vi.stubGlobal('__icarosSnapshotContext', { getStore: () => firstSha })
    expect(getSnapshot().version).toBe('first')
    vi.unstubAllGlobals()
    rmSync(scopedPath, { force: true })
    const second = getSnapshot()
    expect(second).not.toBe(first)
    expect(getFeed(0, 15).items.map(item => item.id)).toEqual(['fresh'])
    writeFileSync(join(temp, 'pointer.json'), JSON.stringify({ path: join(temp, 'second.json'), sha256: '0'.repeat(64) }))
    expect(() => getSnapshot()).toThrow('Snapshot SHA-256 mismatch')
    expect(() => getSnapshot()).toThrow('Snapshot SHA-256 mismatch')
    writeFileSync(join(temp, 'pointer.json'), secondPointer)
    expect(getSnapshot()).toBe(second)
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(temp, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { createSnapshotExporter } from '../src/snapshot.js'

const snapshot = () => ({
  version: '1', publishedAt: '2026-09-30T00:00:00.000Z', site: {}, sections: [], panels: [],
  taxonomy: { types: [], series: [] }, vehicles: [], members: [], posts: [], missions: [], media: {},
})

test('mission snapshot requires public fields and safe media before storing', async () => {
  const mission = { id: '123e4567-e89b-42d3-a456-426614174000', title: '시험 발사',
    launchDate: '2026-07-18', vehicleName: null, location: '제주', outcome: 'success',
    summary: '회수 성공', bodyMd: '![사진](/assets/local-media/photo.webp)',
    imageSrc: '/assets/local-media/photo.webp', published: true }
  let writes = 0
  const exportData = async (data: unknown) => createSnapshotExporter({ async read() { return data } }, {
    async put() { writes++; return 'ref' },
  }).export(1)
  const valid = { ...snapshot(), media: { cover: '/assets/local-media/photo.webp' }, missions: [mission] }
  await exportData(valid)
  assert.equal(writes, 1)
  for (const data of [
    { ...snapshot(), missions: undefined },
    { ...valid, missions: [mission, mission] },
    ...[
      { launchDate: '2026-02-30' }, { outcome: 'unknown' }, { imageSrc: '/api/media/private' },
      { bodyMd: '![비공개](/api/media/private)' },
      { bodyMd: '![누락](/assets/local-media/missing.webp)' },
      { bodyMd: '<img src="/api/media/private">' }, { published: false },
    ].map(change => ({ ...valid, missions: [{ ...mission, ...change }] })),
  ]) await assert.rejects(exportData(data))
  assert.equal(writes, 1)
})

test('export stores matching bytes and SHA-256 for the FE build pin', async () => {
  let stored: { bytes: Buffer; sha256: string } | undefined
  const exporter = createSnapshotExporter({ async read() { return snapshot() } }, {
    async put(input) { stored = input; return 'snapshots/1.json' },
  })
  const artifact = await exporter.export(1)
  assert.equal(artifact.snapshotRef, 'snapshots/1.json')
  assert.equal(artifact.snapshotSha256, createHash('sha256').update(stored!.bytes).digest('hex'))
  assert.deepEqual(JSON.parse(stored!.bytes.toString()), snapshot())
})

test('private member media and unpublished posts cannot be exported', async () => {
  for (const data of [
    { ...snapshot(), members: [{ id: 'm', hasPhoto: true, imageSrc: '/api/media/private' }] },
    { ...snapshot(), posts: [{ id: 'p', source: 'community', published: false, contentMd: '' }] },
  ]) {
    let writes = 0
    const exporter = createSnapshotExporter({ async read() { return data } }, {
      async put() { writes++; return 'ref' },
    })
    await assert.rejects(exporter.export(1))
    assert.equal(writes, 0)
  }
})

test('export rejects a missing referenced local media asset', async () => {
  const data = { ...snapshot(), panels: [{ id: 'panel-1', mediaSrc: '/assets/local-media/missing.webp' }] }
  let writes = 0
  const exporter = createSnapshotExporter({ async read() { return data } }, {
    async put() { writes++; return 'ref' },
  })
  await assert.rejects(exporter.export(1))
  assert.equal(writes, 0)
})

test('export rejects private or missing post attachments', async () => {
  for (const src of ['/api/media/private', '/assets/local-media/missing.pdf', 'https://bucket.s3.amazonaws.com/private.pdf?signature=secret']) {
    const data = { ...snapshot(), posts: [{ id: 'p', source: 'community', published: true,
      contentMd: '본문', attachments: [{ kind: 'pdf', src }] }] }
    let writes = 0
    const exporter = createSnapshotExporter({ async read() { return data } }, {
      async put() { writes++; return 'ref' },
    })
    await assert.rejects(exporter.export(1))
    assert.equal(writes, 0)
  }
})

test('community forumPostId is optional but must be a safe URL segment', async () => {
  const exporter = (forumPostId: unknown) => createSnapshotExporter({ async read() {
    return { ...snapshot(), posts: [{ id: 'post-1', source: 'community', published: true,
      displayDate: '2026-07-18', contentMd: '본문', forumPostId }] }
  } }, { async put() { return 'ref' } }).export(1)
  await exporter(undefined)
  await exporter('forum_Post-123')
  for (const value of ['', '../escape', 'a/b', 'a?b', 123]) await assert.rejects(exporter(value))
})

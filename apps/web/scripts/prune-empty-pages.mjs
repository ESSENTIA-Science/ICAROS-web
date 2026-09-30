import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadAndValidateSnapshot } from './snapshot-contract.mjs'

const snapshot = loadAndValidateSnapshot(process.env.ICAROS_SNAPSHOT, process.env.ICAROS_SNAPSHOT_SHA256)
if (snapshot.posts.length <= 12) {
  // Next static export requires one generated param for every dynamic route.
  // Remove its temporary page 2 when the snapshot has only one actual page.
  rmSync(resolve('out/posts/page/2'), { recursive: true, force: true })
}
if (!snapshot.posts.some((post) => post.source === 'community')) {
  rmSync(resolve('out/posts/__empty-community'), { recursive: true, force: true })
}

if (snapshot.missions.length === 0) {
  rmSync(resolve('out/missions/__empty-mission'), { recursive: true, force: true })
}

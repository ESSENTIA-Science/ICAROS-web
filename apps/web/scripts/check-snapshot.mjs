import { loadAndValidateSnapshot } from './snapshot-contract.mjs'

const data = loadAndValidateSnapshot(process.env.ICAROS_SNAPSHOT, process.env.ICAROS_SNAPSHOT_SHA256)
console.log(`Snapshot ${data.version}: ${data.vehicles.length} vehicles, ${data.posts.length} posts`)

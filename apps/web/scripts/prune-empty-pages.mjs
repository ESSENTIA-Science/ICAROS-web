import { readdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadAndValidateSnapshot } from './snapshot-contract.mjs'

/** Reserved sentinel segments are build scaffolding, never public routes. */
export function pruneEmptyPages(output) {
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.name.startsWith('__empty-')) rmSync(path, { recursive: true, force: true })
      else if (entry.isDirectory()) walk(path)
    }
  }
  walk(output)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  loadAndValidateSnapshot(process.env.ICAROS_SNAPSHOT, process.env.ICAROS_SNAPSHOT_SHA256)
  pruneEmptyPages(resolve('out'))
}

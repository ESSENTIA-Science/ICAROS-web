import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.slice(2).includes('--help')) {
  console.log('Usage: bash scripts/essentia-production-smoke.sh [--help]')
  process.exit(0)
}

async function main() {
  const names = ['ESSENTIA_SERVICE_ORIGIN', 'ESSENTIA_SERVICE_TOKEN', 'ESSENTIA_SERVICE_CATEGORY', 'ESSENTIA_AUTHOR_LABEL']
  for (const name of names) {
    if (!process.env[name]?.trim()) throw new Error(`Missing ${name}. Load the production config via the shell launcher.`)
  }
  if (process.env.ESSENTIA_SERVICE_ORIGIN !== 'https://api.essentia-sci.org') {
    throw new Error('Production origin must be https://api.essentia-sci.org.')
  }
  const apiDir = resolve(process.env.ICAROS_API_DIR ?? resolve(import.meta.dirname, '../../ICAROS-api'))
  let createEssentiaPostsAdapter
  try {
    const require = createRequire(pathToFileURL(resolve(apiDir, 'package.json')))
    const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href)
    register()
    ;({ createEssentiaPostsAdapter } = await import(pathToFileURL(resolve(apiDir, 'src/essentia/posts.ts')).href))
  } catch {
    throw new Error('Cannot load the ICAROS-api adapter. Check ICAROS_API_DIR and its installed dependencies.')
  }
  const adapter = createEssentiaPostsAdapter({
    origin: process.env.ESSENTIA_SERVICE_ORIGIN,
    token: process.env.ESSENTIA_SERVICE_TOKEN,
    category: process.env.ESSENTIA_SERVICE_CATEGORY,
    authorLabel: process.env.ESSENTIA_AUTHOR_LABEL,
    fetch: async (url, options) => {
      // Refuse every operation except the two explicit production reads.
      const allowed = ['/api/service/icaros/posts', '/api/service/icaros/posts/snapshot']
      const target = new URL(url)
      if (options?.method !== 'GET' || target.origin !== 'https://api.essentia-sci.org' ||
          !allowed.includes(target.pathname) || target.search) throw new Error('Smoke rejected an unexpected request.')
      let response
      try {
        response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
      } catch {
        throw new Error('ESSENTIA read failed: network, TLS, redirect, or 15s timeout.')
      }
      if (response.status === 404) throw new Error('ESSENTIA route returned HTTP 404. Service routes may not be deployed; no local fallback.')
      if ([401, 403].includes(response.status)) throw new Error(`ESSENTIA returned HTTP ${response.status}. Check server SERVICE_TOKEN and service user/project configuration.`)
      if (!response.ok) throw new Error(`ESSENTIA returned HTTP ${response.status}. Check deployment and service configuration.`)
      return response
    },
  })
  for (const method of ['listDrafts', 'readSnapshot']) {
    try {
      const posts = await adapter[method]()
      console.log(`${method}: OK (${posts.length} posts; adapter contract validated)`)
    } catch (error) {
      // Only our fixed diagnostics are printable; never print upstream payloads or stack traces.
      const message = error instanceof Error && error.message.startsWith('ESSENTIA ')
        ? error.message : 'Response failed ICAROS-api adapter contract validation.'
      console.error(`${method}: FAIL. ${message}`)
      process.exitCode = 1
    }
  }
}
main().catch((error) => {
  // Setup errors are fixed strings authored above, never upstream errors.
  console.error(error.message)
  process.exitCode = 1
})

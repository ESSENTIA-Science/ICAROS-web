import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const origin = 'http://127.0.0.1:5175'
const base = `http://127.0.0.1:${process.env.ICAROS_LOCAL_API_PORT ?? 5176}`
const webBase = `http://127.0.0.1:${process.env.ICAROS_LOCAL_WEB_PORT ?? 5174}`
const credentials = JSON.parse(readFileSync('docs/.local/admin-login.json', 'utf8'))
const id = randomUUID()
const title = `Local smoke ${id}`
let cookie = ''
let version = ''
let created = false
async function request(method, path, body, extra = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: {
    origin, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const payload = await response.json()
  if (!response.ok || !payload.ok) throw new Error(`${method} ${path} failed (${response.status})`)
  return { response, data: payload.data }
}
async function waitForPublication(id, initialState) {
  let state = initialState
  for (let i = 0; i < 120 && state === 'publishing'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    state = (await request('GET', `/api/admin/publish/${id}`)).data.state
  }
  if (state !== 'published') throw new Error(`Publish ended as ${state}`)
}
try {
  const login = await request('POST', '/api/admin/login', credentials)
  cookie = login.response.headers.get('set-cookie')?.split(';')[0] ?? ''
  if (!cookie) throw new Error('Login cookie missing')
  await request('GET', '/api/admin/session')
  const createdRecord = await request('POST', '/api/admin/content/missions', {
    id, title, launchDate: '2026-10-01', vehicleId: null, location: 'Local smoke',
    outcome: 'planned', summary: 'Before update', bodyMd: 'Local test body',
    coverMediaId: null, published: true,
  })
  created = true
  version = createdRecord.data.version
  const updated = await request('PUT', `/api/admin/content/missions/${id}`,
    { summary: 'After update' }, { 'if-match': version })
  version = updated.data.version
  const started = await request('POST', '/api/admin/publish', {
    kind: 'missions', id, version, idempotencyKey: `local-smoke:${id}`,
  })
  await waitForPublication(started.data.id, started.data.state)
  const html = await (await fetch(`${webBase}/missions/`)).text()
  if (!html.includes(title)) throw new Error('Published mission missing from static HTML')
  console.log('Local create/update/publish/static smoke passed.')
} finally {
  if (created) {
    try {
      const records = (await request('GET', '/api/admin/content/missions')).data
      const current = records.find((record) => record.id === id)
      if (current) await request('DELETE', `/api/admin/content/missions/${id}`, undefined, { 'if-match': current.version })
      const site = (await request('GET', '/api/admin/content/site')).data
        .find((record) => record.id === 'nav.posts')
      if (!site) throw new Error('Cleanup publication anchor missing')
      const cleanup = await request('POST', '/api/admin/publish', {
        kind: 'site', id: site.id, version: site.version, idempotencyKey: `local-smoke-cleanup:${id}`,
      })
      await waitForPublication(cleanup.data.id, cleanup.data.state)
      const html = await (await fetch(`${webBase}/missions/`)).text()
      if (html.includes(title)) throw new Error('Removed mission remains in public HTML')
      console.log('Local smoke record removed and cleanup release published.')
    } catch (error) { console.error('Local smoke cleanup failed:', error.message); process.exitCode = 1 }
  }
}

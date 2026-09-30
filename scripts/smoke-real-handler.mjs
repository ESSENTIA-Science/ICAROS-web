import { readFileSync } from 'node:fs'

const credentials = JSON.parse(readFileSync('docs/.local/admin-login.json', 'utf8'))
const base = `http://127.0.0.1:${process.env.API_PORT ?? 5176}`
const origin = 'http://127.0.0.1:5175'
const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: {
  origin, 'content-type': 'application/json',
}, body: JSON.stringify(credentials) })
if (login.status !== 200) throw new Error(`Real handler login failed (${login.status})`)
const cookie = login.headers.get('set-cookie')?.split(';')[0]
if (!cookie) throw new Error('Real handler did not set a session cookie')
for (const path of ['/api/admin/session', '/api/admin/content/missions']) {
  const response = await fetch(`${base}${path}`, { headers: { cookie } })
  const result = await response.json()
  if (!response.ok || result.ok !== true) throw new Error(`Real handler read failed (${response.status})`)
}
console.log('Real API handler login and authenticated read passed.')

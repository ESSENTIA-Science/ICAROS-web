import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { Algorithm, hash } from '@node-rs/argon2'

const path = resolve(import.meta.dirname, '../docs/.local/admin-login.json')
if (!existsSync(path)) {
  mkdirSync(resolve(import.meta.dirname, '../docs/.local'), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify({ email: 'local@localhost.invalid',
    password: randomBytes(24).toString('base64url') }), { mode: 0o600, flag: 'wx' })
  console.log('Local CMS credentials created in docs/.local/admin-login.json (mode 0600).')
} else console.log('Using existing local CMS credentials in docs/.local/admin-login.json.')

const databaseUrl = process.env.ICAROS_LOCAL_DATABASE_URL ?? 'postgres://icaros:icaros_local_dev@127.0.0.1:5435/icaros'
const url = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '5435') {
  throw new Error('Admin bootstrap accepts only local PostgreSQL port 5435')
}
const credentials = JSON.parse(readFileSync(path, 'utf8'))
const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 })
try {
  await client.connect()
  const passwordHash = await hash(credentials.password, { algorithm: Algorithm.Argon2id })
  const updated = await client.query(`update icaros.admin_users set password_hash=$2,
    password_changed_at=now(), is_active=true where email=$1`, [credentials.email, passwordHash])
  if (updated.rowCount === 0) await client.query(`insert into icaros.admin_users
    (email, password_hash, display_name) values ($1, $2, 'Local CMS')`, [credentials.email, passwordHash])
  console.log('Local admin account is ready in the local database.')
} finally { await client.end() }

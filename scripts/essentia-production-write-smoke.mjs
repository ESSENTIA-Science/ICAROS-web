import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { lstatSync, mkdirSync, chmodSync, openSync, fchmodSync, writeSync, ftruncateSync, fsyncSync, closeSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const origin = 'https://api.essentia-sci.org'
const base = '/api/service/icaros/posts'
const root = resolve(import.meta.dirname, '..')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const randomIdempotencyKey = () => `icaros-production-smoke-${randomUUID()}`
const check = (condition) => { if (!condition) throw new Error('Smoke assertion failed') }

async function loadAdapter() {
  const directory = resolve(process.env.ICAROS_API_DIR ?? resolve(root, '../ICAROS-api'))
  const require = createRequire(pathToFileURL(resolve(directory, 'package.json')))
  const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href)
  register()
  return (await import(pathToFileURL(resolve(directory, 'src/essentia/posts.ts')).href)).createEssentiaPostsAdapter
}

// The adapter cannot address any existing draft: only the UUID returned by this run.
export function guardedFetch(fetchImpl, state) {
  return async (url, options) => {
    const target = new URL(url)
    const method = options?.method
    const ownPath = state.postId ? `${base}/${state.postId}/draft` : null
    check(target.origin === origin && target.protocol === 'https:' && !target.username && !target.password &&
      !target.search && !target.hash && (
        (method === 'GET' && [base, `${base}/snapshot`, ownPath].includes(target.pathname)) ||
        (method === 'POST' && target.pathname === base) ||
        (method === 'PUT' && ownPath && target.pathname === ownPath)))
    if (method === 'POST') {
      check(options.headers['Idempotency-Key'] === state.createdKey && options.body === state.createBody)
    }
    if (method === 'POST' || method === 'PUT') {
      const body = JSON.parse(options.body)
      check(Array.isArray((body.draft ?? body).attachments) && (body.draft ?? body).attachments.length === 0)
    }
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) })
    check(!response.redirected && !(response.status >= 300 && response.status < 400))
    // Consume the body under the same timeout, before the adapter parses JSON.
    const bytes = await response.arrayBuffer()
    return new Response(bytes.byteLength ? bytes : null, { status: response.status, headers: response.headers })
  }
}

function privateReceipt(state) {
  const directory = resolve(root, 'docs/.local')
  const name = `essentia-production-write-smoke-${randomUUID()}.json`
  execFileSync('git', ['-C', root, 'check-ignore', '-q', `docs/.local/${name}`], { stdio: 'ignore' })
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid())
  chmodSync(directory, 0o700)
  const fd = openSync(resolve(directory, name), 'wx', 0o600)
  fchmodSync(fd, 0o600)
  return {
    save() {
      const bytes = Buffer.from(JSON.stringify(state, null, 2) + '\n')
      writeSync(fd, bytes, 0, bytes.length, 0)
      ftruncateSync(fd, bytes.length)
      fsyncSync(fd)
    },
    close() { closeSync(fd) },
  }
}

export async function runSmoke(createAdapter, config, fetchImpl, save) {
  const state = { createdKey: randomIdempotencyKey(), postId: null, id: null, currentVersion: null,
    status: 'prepared', createdAt: new Date().toISOString() }
  state.idempotencyKey = state.createdKey
  const title = `[ICAROS production draft test] ${randomUUID()}`
  const create = { operation: 'create', idempotencyKey: state.createdKey, title,
    bodyMd: '운영 연결 검증용 미게시 초안입니다.', displayDate: '2026-10-02', attachments: [], published: false }
  state.title = title
  state.initialDraft = { category: config.category, title, content: create.bodyMd,
    displayDate: create.displayDate, attachments: [] }
  state.createBody = JSON.stringify(state.initialDraft)
  const receipt = save(state)
  try {
    receipt.save() // Persist the key and exact payload BEFORE the first production request.
    const adapter = createAdapter({ ...config, fetch: guardedFetch(fetchImpl, state) })
    let created
    try { created = await adapter.create(create) } catch {
      state.status = 'create_retry'; receipt.save()
      // One bounded retry of the exact same create only; never retry PUT.
      created = await adapter.create(create)
    }
    check(created.status === 'saved' && uuid.test(created.id))
    state.id = state.postId = created.id
    state.currentVersion = state.version = created.version
    state.status = 'created'; receipt.save()
    const verify = (draft, fields, version) => check(draft?.id === state.postId && draft.version === version &&
      draft.title === title && draft.bodyMd === fields.bodyMd && draft.displayDate === fields.displayDate &&
      draft.attachments.length === 0 && draft.publishedVersion === null && draft.publishState === 'draft_saved')
    verify(await adapter.readDraft(state.postId), create, created.version)
    const replay = await adapter.create(create)
    check(replay.status === 'saved' && replay.id === state.postId && replay.version === created.version)
    const updatedFields = { ...create, operation: 'update', id: state.postId, version: created.version,
      displayDate: '2026-10-03', bodyMd: '## 운영 초안 검증\n\n| 항목 | 결과 |\n| --- | --- |\n| 저장 | 검증 |\n\n:::gallery{columns=1}\n\n![검증용 이미지](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=)\n\n:::' }
    const updated = await adapter.update(updatedFields)
    check(updated.status === 'saved' && updated.id === state.postId && Number(updated.version) > Number(created.version))
    state.currentVersion = state.version = updated.version
    state.status = 'updated'; receipt.save()
    const staleIfMatch = await adapter.update({ ...updatedFields, bodyMd: '이 stale 수정은 저장되면 안 됩니다.' })
    check(staleIfMatch.status === 'conflict')
    verify(await adapter.readDraft(state.postId), updatedFields, updated.version)
    const drafts = await adapter.listDrafts()
    check(drafts.filter(post => post.id === state.postId).length === 1)
    verify(drafts.find(post => post.id === state.postId), updatedFields, updated.version)
    const snapshot = await adapter.readSnapshot()
    check(!snapshot.some(post => post.id === state.postId || post.title === title))
    state.status = 'passed'; receipt.save()
    return { drafts: drafts.length, published: snapshot.length }
  } catch {
    state.status = 'failed'; receipt.save()
    throw new Error('Production draft smoke failed')
  } finally { receipt.close() }
}

async function selfTest() {
  const assert = (await import('node:assert/strict')).default
  const createAdapter = await loadAdapter()
  let attempts = 0; let record; let savedState; let putCount = 0
  const id = randomUUID()
  const fakeFetch = async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.ok(options.signal)
    const path = new URL(url).pathname
    if (options.method === 'POST') {
      attempts++
      const body = JSON.parse(options.body)
      if (!record) record = { ...body, id, version: 1, updatedAt: new Date().toISOString(), publishedVersion: null }
      assert.equal(options.headers['Idempotency-Key'], savedState.createdKey)
      assert.equal(options.body, savedState.createBody)
      if (attempts === 1) throw new Error('Simulated response loss after create')
      return Response.json({ id, version: 1 })
    }
    if (options.method === 'PUT') {
      putCount++
      const body = JSON.parse(options.body)
      if (body.expectedVersion !== record.version) return Response.json({}, { status: 409 })
      record = { ...record, ...body.draft, version: record.version + 1 }
      return Response.json({ id, version: record.version })
    }
    if (path === `${base}/snapshot`) return Response.json([])
    if (path === base) return Response.json([record])
    return Response.json({ revision: record, draft: record })
  }
  const config = { origin, token: 'fake-token', category: 'fake-category', authorLabel: 'fake-author' }
  const result = await runSmoke(createAdapter, config, fakeFetch, state => {
    savedState = state
    return { save() {}, close() {} }
  })
  assert.deepEqual(result, { drafts: 1, published: 0 })
  assert.equal(attempts, 3); assert.equal(putCount, 2); assert.equal(savedState.status, 'passed')
  assert.ok(uuid.test(savedState.postId)); assert.ok(savedState.createdKey.startsWith('icaros-production-smoke-'))
  assert.equal(savedState.id, savedState.postId)
  assert.equal(savedState.idempotencyKey, savedState.createdKey)
  assert.equal(savedState.currentVersion, '2')
  assert.equal(savedState.title, savedState.initialDraft.title)
  assert.deepEqual(JSON.parse(savedState.createBody), savedState.initialDraft)
  assert.deepEqual(savedState.initialDraft.attachments, [])
  assert.equal(savedState.initialDraft.displayDate, '2026-10-02')
  assert.equal(savedState.initialDraft.content, '운영 연결 검증용 미게시 초안입니다.')
  let calls = 0
  const guard = guardedFetch(async () => { calls++; return Response.json({}) }, savedState)
  for (const [url, method] of [[`${origin}${base}/${id}/publish`, 'POST'], [`${origin}${base}/${randomUUID()}/draft`, 'PUT'],
    [`http://api.essentia-sci.org${base}`, 'GET'], [`${origin}${base}?x=1`, 'GET'], [`https://example.org${base}`, 'GET'], [`${origin}${base}`, 'DELETE']]) {
    await assert.rejects(guard(url, { method }))
  }
  assert.equal(calls, 0)
  const redirectGuard = guardedFetch(async () => new Response(null, { status: 302 }), savedState)
  await assert.rejects(redirectGuard(`${origin}${base}`, { method: 'GET' }))
  let retryCalls = 0; let failureState
  await assert.rejects(runSmoke(createAdapter, config, async () => { retryCalls++; throw new Error('secret upstream error') }, state => {
    failureState = state; return { save() {}, close() {} }
  }), { message: 'Production draft smoke failed' })
  assert.equal(retryCalls, 2); assert.equal(failureState.status, 'failed'); assert.equal(failureState.postId, null)
  assert.equal(failureState.id, null); assert.equal(failureState.currentVersion, null)
  assert.equal(failureState.idempotencyKey, failureState.createdKey)
  assert.deepEqual(JSON.parse(failureState.createBody), failureState.initialDraft)
  for (const failure of ['update', 'snapshot', 'stale']) {
    attempts = 0; record = undefined; putCount = 0
    await assert.rejects(runSmoke(createAdapter, config, async (url, options) => {
      if (failure === 'update' && options.method === 'PUT') {
        putCount++; throw new Error('Simulated update response loss')
      }
      if (failure === 'stale' && options.method === 'PUT' && putCount === 1) {
        return Response.json({ id, version: record.version })
      }
      if (failure === 'snapshot' && new URL(url).pathname === `${base}/snapshot`) {
        return Response.json([{ ...record, forumPostId: randomUUID() }])
      }
      return fakeFetch(url, options)
    }, state => {
      savedState = state; return { save() {}, close() {} }
    }), { message: 'Production draft smoke failed' })
    assert.equal(savedState.status, 'failed'); assert.equal(savedState.postId, id)
    if (failure === 'update') assert.equal(putCount, 1) // PUT is never retried.
  }
  console.log('self-test: OK (retry, idempotency, stale version, roundtrip, snapshot, request guard, failure receipts)')
}

async function main() {
  const args = process.argv.slice(2)
  check(args.length === 1)
  if (args[0] === '--help') {
    console.log('Usage: bash scripts/essentia-production-write-smoke.sh --apply-production-draft-test | --self-test | --help\nProduction: creates and updates one unpublished draft; private receipt in docs/.local/essentia-production-write-smoke-*.json. No publish or cleanup. ICAROS_API_DIR overrides sibling adapter. Self-test uses fake fetch only.')
    return
  }
  if (args[0] === '--self-test') return selfTest()
  check(args[0] === '--apply-production-draft-test')
  const env = process.env
  check(env.ESSENTIA_SERVICE_ORIGIN === origin)
  for (const name of ['ESSENTIA_SERVICE_TOKEN', 'ESSENTIA_SERVICE_CATEGORY', 'ESSENTIA_AUTHOR_LABEL']) check(env[name]?.trim())
  const result = await runSmoke(await loadAdapter(), { origin, token: env.ESSENTIA_SERVICE_TOKEN,
    category: env.ESSENTIA_SERVICE_CATEGORY, authorLabel: env.ESSENTIA_AUTHOR_LABEL }, fetch, privateReceipt)
  console.log(`draft smoke: OK (${result.drafts} drafts; ${result.published} published; private receipt saved)`)
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('draft smoke: FAIL. Check configuration, adapter, service contract, and private receipt; no automatic publish or cleanup.'); process.exitCode = 1 })
}

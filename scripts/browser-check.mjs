import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolsRoot = process.env.ICAROS_TEST_TOOLS ?? path.resolve(root, '../test-tools')
const localRequire = createRequire(path.join(existsSync(path.join(root, 'node_modules/playwright')) ? root : toolsRoot, 'package.json'))
const { chromium } = localRequire('playwright')
const { createServer } = createRequire(path.join(root, 'package.json'))('vite')
const executablePath = process.env.ICAROS_BROWSER_EXECUTABLE ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
const vite = await createServer({ root: path.join(root, 'apps/cms'), configFile: path.join(root, 'apps/cms/vite.config.ts'), server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
  plugins: [{ name: 'hook-test-fixture', load(id) {
    if (!process.env.ICAROS_BROWSER_BASELINE) return null
    const relative = path.relative(root, id.split('?')[0])
    if (!['apps/cms/src/components/ResourceEditor.tsx', 'apps/cms/src/components/MissionsEditor.tsx'].includes(relative)) return null
    return execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root, encoding: 'utf8' })
  }, configureServer(server) { server.middlewares.use(async (request, response, next) => { if (request.url !== '/admin/__hook') return next(); response.setHeader('content-type', 'text/html'); response.end(await server.transformIndexHtml(request.url, `<html><body><div id="root"></div><script type="module" src="/@fs/${root}/scripts/browser-fixtures/hook.tsx"></script></body></html>`)) }) } }] })
await vite.listen()
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
let passed = 0
const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222', memberId = '44444444-4444-4444-8444-444444444444'
const waitUntil = async check => { for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('Condition timeout') }
async function scenario(name, work) { console.log(`RUN ${name}`); await work(); passed++; console.log(`PASS ${name}`) }
function fixture() {
  return { records: { departments: [{ id: first, version: 'v1', name: '제작부', sortOrder: 0 }, { id: second, version: 'v1', name: '전자부', sortOrder: 0 }], members: [{ id: memberId, version: 'v1', name: 'old', departmentIds: [first], bioMd: '', imageMediaId: null, published: true }], missions: [{ id: memberId, version: 'v1', title: 'old mission', launchDate: '2026-10-13', outcome: 'planned', location: 'fixture launch site', summary: '', bodyMd: '', published: false }], rockets: [{ id: 'fixture-vehicle', version: 'v1', publishState: 'draft_saved', updatedAt: '2026-10-13T00:00:00Z', name: 'fixture vehicle', series: 'series-fixture', descriptionMd: '', maxAltitudeM: '', sizeM: '', payloadKg: '', specs: [], published: false }], 'vehicle-types': [{ id: 'type-fixture', version: 'v1', label: 'fixture type' }], 'rocket-series': [{ id: 'series-fixture', version: 'v1', label: 'fixture series', typeId: 'type-fixture' }], posts: [{ id: 'existing-post', version: 'v1', publishState: 'draft_saved', updatedAt: '2026-10-13T00:00:00Z', title: 'existing post', bodyMd: 'old body', authorLabel: 'fixture', displayDate: '2026-10-13', attachments: [] }], site: [{ id: 'donation.current', version: 'v1', updatedAt: '2026-10-13T00:00:00Z', publishState: 'draft_saved', value: '0' }] }, media: { gallery: { id: 'fixture-vehicle', version: 'v1', mediaIds: [first, second] }, model: { id: 'fixture-vehicle', version: 'v1', modelMediaId: null, posterMediaId: null } }, readGate: null, failPut: null, calls: [], createGate: null, loseCreate: false, conflict: false, jobState: 'publishing', publishGate: null }
}
async function setup(state, tab = 'members') {
  const context = await browser.newContext()
  await context.route('**/api/admin/**', async route => {
    const request = route.request(), method = request.method(), pathname = new URL(request.url()).pathname
    const body = request.postDataJSON?.() ?? null
    state.calls.push({ method, pathname, body, version: request.headers()['if-match'] })
    const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, message: 'CONFLICT' }) })
    if (pathname.endsWith('/media/presign')) return send({ mediaId: second, uploadUrl: `${origin}/__fixture-upload`, contentType: body.contentType })
    if (pathname.endsWith('/media/confirm')) return send({ id: second })
    if (pathname.endsWith('/preview')) return send({ mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5p0AAAAASUVORK5CYII=' })
    if (pathname.endsWith('/session')) return send({ userId: 'fixture-admin', email: 'fixture@example.invalid' })
    if (pathname === '/api/admin/publish' && method === 'POST') { if (state.publishGate) await state.publishGate; return send({ id: 'fixture-job', state: state.jobState }) }
    if (pathname === '/api/admin/publish/fixture-job') return send({ id: 'fixture-job', state: state.jobState })
    const pieces = pathname.split('/'), kind = pieces[4], id = pieces[5]
    const records = state.records[kind] ?? []
    if (kind === 'vehicles' && pieces[6]) {
      const which = pieces[6], current = state.media[which]
      if (method === 'GET') return send(structuredClone(current))
      if (state.conflict || request.headers()['if-match'] !== current.version) return send(null, 409)
      state.media[which] = { ...current, ...body, version: `v${Number(current.version.slice(1)) + 1}` }; return send(state.media[which])
    }
    if (method === 'GET') {
      const snapshot = structuredClone(records)
      if (state.readGate?.kind === kind && (!state.readGate.firstOnly || !state.readGate.used)) { state.readGate.used = true; state.readGate.captured?.(); await state.readGate.promise }
      return send(snapshot)
    }
    if (method === 'POST') {
      if (records.some(row => row.id === body.id)) return send(null, 409)
      const row = kind === 'posts' ? { ...body, id: 'created-post', authorLabel: 'fixture', publishState: 'draft_saved', updatedAt: '2026-10-13T00:00:00Z', version: 'v1' } : { ...body, version: 'v1', ...(kind === 'rockets' ? { publishState: 'draft_saved', updatedAt: '2026-10-13T00:00:00Z', maxAltitudeM: body.maxAltitudeM ?? '', sizeM: body.sizeM ?? '', payloadKg: body.payloadKg ?? '' } : {}) }; records.push(row); state.records[kind] = records
      if (state.createGate) await state.createGate
      if (state.loseCreate) { state.loseCreate = false; return route.abort('failed') }
      return send(row)
    }
    if (method === 'PUT' && id === 'order') {
      if (state.conflict) return send(null, 409)
      state.records[kind] = body.ordered.map((item, index) => ({ ...records.find(row => row.id === item.id), version: `order-${index}`, sortOrder: index }))
      return send(state.records[kind])
    }
    if (method === 'PUT') {
      if (state.failPut === 'network') return route.abort('failed')
      if (state.failPut === 'conflict') return send(null, 409)
      const index = records.findIndex(row => row.id === id), current = records[index]
      if (!current || state.conflict || request.headers()['if-match'] !== current.version) return send(null, 409)
      const row = { ...current, ...body, version: `v${Number(current.version.slice(1)) + 1}` }; records[index] = row; return send(row)
    }
    throw new Error(`Unhandled fixture request ${method} ${pathname}`)
  })
  const page = await context.newPage(); const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.goto(`${origin}/admin/?tab=${tab}`)
  await page.locator('.listItems button').first().waitFor()
  return { page, context, errors }
}
const updates = state => state.calls.filter(call => call.method === 'PUT' && !call.pathname.endsWith('/order'))
try {
  await scenario('member and mission no-edit refresh issues zero PUT and shows latest administrator values', async () => {
    for (const kind of ['members', 'missions']) {
      const state = fixture(); const { page, context, errors } = await setup(state, kind)
      await page.locator('.listItems button').first().click()
      state.records[kind][0] = { ...state.records[kind][0], [kind === 'members' ? 'name' : 'title']: 'latest server', version: 'v2' }
      await page.getByRole('button', { name: '새로고침', exact: true }).click()
      await waitUntil(async () => await page.getByRole('textbox', { name: kind === 'members' ? '이름' : '제목', exact: true }).inputValue() === 'latest server').catch(async error => { console.log(JSON.stringify({ refreshFailure: kind, displayed: await page.getByRole('textbox', { name: kind === 'members' ? '이름' : '제목', exact: true }).inputValue(), writes: updates(state).length, stored: state.records[kind][0] })); throw error })
      await page.waitForTimeout(850); assert.equal(updates(state).length, 0); assert.deepEqual(errors, []); await context.close()
    }
  })
  await scenario('delayed member and mission refresh locks editing/selection until captured latest GET completes', async () => {
    for (const kind of ['members', 'missions']) {
      const state = fixture(); const { page, context } = await setup(state, kind)
      await page.locator('.listItems button').first().click()
      state.records[kind][0] = { ...state.records[kind][0], [kind === 'members' ? 'name' : 'title']: 'latest delayed', version: 'v2' }
      let release, captured; const requested = new Promise(resolve => { captured = resolve })
      state.readGate = { kind, promise: new Promise(resolve => { release = resolve }), captured }
      await page.getByRole('button', { name: '새로고침', exact: true }).click(); await requested
      assert.equal(await page.getByRole('textbox', { name: kind === 'members' ? '이름' : '제목', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: kind === 'members' ? '새 항목' : '새 미션', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: '새로고침', exact: true }).isDisabled(), true)
      const selection = page.locator('.listItems button'); for (let i = 0; i < await selection.count(); i++) assert.equal(await selection.nth(i).isDisabled(), true)
      if (kind === 'members') assert.equal(await page.getByRole('checkbox', { name: '제작부', exact: true }).isDisabled(), true)
      release(); await waitUntil(async () => await page.getByRole('textbox', { name: kind === 'members' ? '이름' : '제목', exact: true }).inputValue() === 'latest delayed')
      assert.equal(await page.getByRole('textbox', { name: kind === 'members' ? '이름' : '제목', exact: true }).isDisabled(), false)
      await page.waitForTimeout(850); assert.equal(updates(state).length, 0); await context.close()
    }
  })
  await scenario('React StrictMode late initial GET cannot replace the newer generation response or draft', async () => {
    const state = fixture(); let release
    state.readGate = { kind: 'members', firstOnly: true, promise: new Promise(resolve => { release = resolve }), captured: () => { state.records.members[0] = { ...state.records.members[0], name: 'latest generation', version: 'v2' } } }
    const { page, context } = await setup(state)
    await page.locator('.listItems').getByRole('button', { name: 'latest generation', exact: true }).click(); release()
    await page.waitForTimeout(850); assert.equal(await page.getByLabel('이름', { exact: true }).inputValue(), 'latest generation')
    assert.equal(await page.locator('.listItems').getByRole('button', { name: 'old', exact: true }).count(), 0); assert.equal(updates(state).length, 0); await context.close()
  })
  await scenario('site conflict undo to original clears global flush error and permits actual App tab navigation', async () => {
    const state = fixture(); const { page, context } = await setup(state, 'site')
    state.records.site[0] = { ...state.records.site[0], value: '2', version: 'v2' }
    await page.locator('section[aria-label="콘텐츠 편집"] textarea').fill('1'); await page.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).waitFor()
    await page.locator('section[aria-label="콘텐츠 편집"] textarea').fill('0')
    await page.getByRole('navigation', { name: '관리 영역' }).getByRole('button', { name: '멤버', exact: true }).click()
    await page.waitForURL('**/?tab=members'); assert.equal(updates(state).length, 1); assert.equal(state.records.site[0].value, '2'); await context.close()
  })
  await scenario('site conflict explicit latest preserves draft; reapply uses latest version and discard makes no writes', async () => {
    for (const reapply of [true, false]) {
      const state = fixture(); const { page, context } = await setup(state, 'site'); state.records.site[0] = { ...state.records.site[0], value: '2', version: 'v2' }
      await page.locator('section[aria-label="콘텐츠 편집"] textarea').fill('1')
      await page.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).click(); await page.getByRole('button', { name: '수정본 폐기', exact: true }).waitFor()
      assert.equal(await page.locator('section[aria-label="콘텐츠 편집"] textarea').inputValue(), '1'); await page.waitForTimeout(800); assert.equal(updates(state).length, 1)
      await page.getByRole('button', { name: reapply ? '내 수정본 재적용' : '수정본 폐기', exact: true }).click()
      if (reapply) { await waitUntil(() => state.records.site[0].value === '1'); assert.equal(updates(state).at(-1).version, 'v2') }
      else { assert.equal(await page.locator('section[aria-label="콘텐츠 편집"] textarea').inputValue(), '2'); await page.waitForTimeout(800); assert.equal(updates(state).length, 1) }
      await context.close()
    }
  })
  await scenario('vehicle gallery conflict reads latest without flush and explicit reapply/discard preserve correct IDs', async () => {
    for (const reapply of [true, false]) {
      const state = fixture(); const { page, context } = await setup(state, 'vehicles')
      await page.locator('.mediaList').getByRole('button', { name: '제거', exact: true }).first().waitFor()
      state.media.gallery.version = 'v2'; await page.locator('.mediaList').getByRole('button', { name: '제거', exact: true }).first().click()
      await page.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).click(); await page.getByRole('button', { name: '수정본 폐기', exact: true }).waitFor()
      assert.equal(await page.locator('.mediaList > div').count(), 1); assert.equal(updates(state).length, 1)
      await page.getByRole('button', { name: reapply ? '내 수정본 재적용' : '수정본 폐기', exact: true }).click()
      if (reapply) { await waitUntil(() => state.media.gallery.version === 'v3'); assert.deepEqual(state.media.gallery.mediaIds, [second]); assert.equal(updates(state).at(-1).version, 'v2') }
      else { await waitUntil(async () => await page.locator('.mediaList > div').count() === 2); await page.waitForTimeout(800); assert.equal(updates(state).length, 1) }
      await context.close()
    }
  })
  await scenario('vehicle create 409 recovers same address by latest version update or explicit discard without another POST', async () => {
    for (const reapply of [true, false]) {
      const state = fixture(); const { page, context } = await setup(state, 'vehicles')
      await page.getByRole('button', { name: '새 기체 추가', exact: true }).click()
      await page.getByLabel('기체 이름', { exact: true }).fill('local vehicle'); await page.getByLabel('기체 주소').fill('fixture-vehicle')
      await page.getByRole('combobox', { name: /^기체 분류/ }).selectOption('type-fixture'); await page.getByRole('combobox', { name: /^시리즈/ }).selectOption('series-fixture')
      await page.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).waitFor(); state.records.rockets[0].version = 'v2'
      await page.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).click(); await page.getByRole('button', { name: reapply ? '내 수정본 재적용' : '수정본 폐기' }).click()
      if (reapply) { await waitUntil(() => state.records.rockets[0].name === 'local vehicle'); assert.equal(updates(state).at(-1).version, 'v2') }
      else { await page.getByRole('heading', { name: '새 기체 추가', exact: true }).waitFor({ state: 'detached' }); await page.waitForTimeout(850); assert.equal(updates(state).length, 0) }
      assert.equal(state.calls.filter(call => call.method === 'POST').length, 1); await context.close()
    }
  })
  await scenario('post create follow-up conflict reapply/discard and network-error cancel never create twice or save after unmount', async () => {
    for (const action of ['reapply', 'discard', 'network-cancel']) {
      const state = fixture(); let release; state.createGate = new Promise(resolve => { release = resolve }); const { page, context } = await setup(state, 'posts')
      await page.getByRole('button', { name: '새 게시글', exact: true }).click(); const createPanel = page.getByRole('region', { name: '새 게시글 초안' })
      await createPanel.getByRole('textbox', { name: '제목', exact: true }).fill('post A'); await createPanel.locator('.cm-content').fill('body A')
      await waitUntil(() => state.calls.some(call => call.method === 'POST'))
      await createPanel.getByRole('textbox', { name: '제목', exact: true }).fill('post B'); state.failPut = action === 'network-cancel' ? 'network' : 'conflict'; release()
      await waitUntil(() => updates(state).length === 1); await createPanel.getByRole('button', { name: '입력 취소', exact: true }).waitFor({ state: 'visible' }); await waitUntil(async () => await createPanel.getByRole('button', { name: '입력 취소', exact: true }).isEnabled())
      const created = state.records.posts.find(row => row.id === 'created-post')
      if (action === 'network-cancel') { await createPanel.getByRole('button', { name: '입력 취소', exact: true }).click() }
      else {
        created.version = 'v2'; created.title = 'remote post'; await createPanel.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).click()
        await createPanel.getByRole('button', { name: '수정본 폐기', exact: true }).waitFor(); assert.equal(await createPanel.getByRole('textbox', { name: '제목', exact: true }).inputValue(), 'post B'); assert.equal(updates(state).length, 1)
        state.failPut = null; await createPanel.getByRole('button', { name: action === 'reapply' ? '내 수정본 재적용' : '수정본 폐기', exact: true }).click()
      }
      await createPanel.waitFor({ state: 'detached' }); await page.waitForTimeout(850)
      assert.equal(state.calls.filter(call => call.method === 'POST').length, 1)
      assert.equal(updates(state).length, action === 'reapply' ? 2 : 1)
      if (action === 'reapply') { assert.equal(state.records.posts.find(row => row.id === 'created-post').title, 'post B'); assert.equal(updates(state).at(-1).version, 'v2') }
      await context.close()
    }
  })
  await scenario('pending first create plus edit produces one POST then update to same ID', async () => {
    const state = fixture(); let release; state.createGate = new Promise(resolve => { release = resolve })
    const { page, context } = await setup(state)
    await page.getByRole('button', { name: '새 항목', exact: true }).click(); await page.getByLabel('이름', { exact: true }).fill('A')
    await waitUntil(() => state.calls.some(call => call.method === 'POST'))
    await page.getByLabel('이름', { exact: true }).fill('B'); release()
    await waitUntil(() => state.records.members.some(row => row.name === 'B'))
    assert.equal(state.calls.filter(call => call.method === 'POST').length, 1)
    const post = state.calls.find(call => call.method === 'POST'); assert.equal(updates(state).at(-1).pathname.split('/').at(-1), post.body.id)
    assert.equal(updates(state).at(-1).version, 'v1'); await context.close()
  })
  await scenario('pending create tab switch waits for latest draft before actual editor unmount', async () => {
    const state = fixture(); let release; state.createGate = new Promise(resolve => { release = resolve })
    const { page, context } = await setup(state)
    await page.getByRole('button', { name: '새 항목', exact: true }).click(); await page.getByLabel('이름', { exact: true }).fill('tab A')
    await waitUntil(() => state.calls.some(call => call.method === 'POST'))
    await page.getByLabel('이름', { exact: true }).fill('tab B')
    await page.getByRole('navigation', { name: '관리 영역' }).getByRole('button', { name: '부서', exact: true }).click()
    assert.equal(new URL(page.url()).searchParams.get('tab'), 'members'); release()
    await page.waitForURL('**/?tab=departments')
    assert.equal(state.calls.filter(call => call.method === 'POST').length, 1)
    assert.equal(state.records.members.filter(row => row.name === 'tab B').length, 1)
    assert.equal(updates(state).at(-1).body.name, 'tab B'); await context.close()
  })
  await scenario('lost create response retry retains client ID and recovers one stored record', async () => {
    const state = fixture(); state.loseCreate = true
    const { page, context } = await setup(state)
    await page.getByRole('button', { name: '새 항목', exact: true }).click(); await page.getByLabel('이름', { exact: true }).fill('lost response')
    await page.getByText('자동 저장 실패', { exact: true }).waitFor()
    await page.getByRole('button', { name: '항목 생성', exact: true }).click()
    await page.locator('.listItems').getByRole('button', { name: 'lost response', exact: true }).waitFor()
    const posts = state.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 2); assert.equal(posts[0].body.id, posts[1].body.id)
    assert.equal(state.records.members.filter(row => row.name === 'lost response').length, 1); await context.close()
  })
  await scenario('member and mission 409 stop stale autosave, retain local draft, and explicitly reapply/discard latest', async () => {
    for (const kind of ['members', 'missions']) for (const reapply of [true, false]) {
      const state = fixture(); const { page, context } = await setup(state, kind)
      const key = kind === 'members' ? 'name' : 'title', input = page.getByRole('textbox', { name: kind === 'members' ? '이름' : '제목', exact: true })
      await page.locator('.listItems button').first().click(); state.records[kind][0] = { ...state.records[kind][0], [key]: 'remote B', version: 'v2' }
      await input.fill('local A')
      await page.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).waitFor(); assert.equal(updates(state).length, 1)
      await page.getByRole('button', { name: '내 수정본 유지하며 최신본 확인' }).click(); await page.getByRole('button', { name: '수정본 폐기', exact: true }).waitFor()
      assert.equal(await input.inputValue(), 'local A'); await page.waitForTimeout(850); assert.equal(updates(state).length, 1)
      await page.getByRole('button', { name: reapply ? '내 수정본 재적용' : '수정본 폐기', exact: true }).click()
      if (reapply) { await waitUntil(() => state.records[kind][0][key] === 'local A'); assert.equal(updates(state).at(-1).version, 'v2') }
      else { await waitUntil(async () => await input.inputValue() === 'remote B'); await page.waitForTimeout(850); assert.equal(updates(state).length, 1) }
      await context.close()
    }
  })
  await scenario('rapid multi-department checkboxes persist both IDs; removal preserves other ID across refresh', async () => {
    const state = fixture(); const { page, context } = await setup(state)
    await page.locator('.listItems button').first().click(); await page.getByRole('checkbox', { name: '전자부', exact: true }).check(); await page.getByRole('checkbox', { name: '전자부', exact: true }).uncheck(); await page.getByRole('checkbox', { name: '전자부', exact: true }).check()
    await waitUntil(() => state.records.members[0].departmentIds.length === 2)
    assert.deepEqual(updates(state).at(-1).body.departmentIds, [first, second])
    await page.getByRole('button', { name: '새로고침', exact: true }).click(); assert.equal(await page.getByRole('checkbox', { name: '제작부', exact: true }).isChecked(), true); assert.equal(await page.getByRole('checkbox', { name: '전자부', exact: true }).isChecked(), true)
    await page.getByRole('checkbox', { name: '전자부', exact: true }).uncheck(); await waitUntil(() => state.records.members[0].departmentIds.length === 1)
    assert.deepEqual(state.records.members[0].departmentIds, [first]); await context.close()
  })
  await scenario('department equal-position move uses full order PUT and refresh keeps normalized response', async () => {
    const state = fixture(); const { page, context } = await setup(state, 'departments')
    await page.locator('.listItems button').first().click(); await page.getByRole('button', { name: '아래로', exact: true }).click()
    await waitUntil(() => state.calls.some(call => call.pathname.endsWith('/order')))
    assert.deepEqual(state.calls.find(call => call.pathname.endsWith('/order')).body.ordered, [{ id: second, version: 'v1' }, { id: first, version: 'v1' }])
    await waitUntil(async () => await page.locator('.listItems button').first().innerText() === '전자부')
    await page.getByRole('button', { name: '새로고침', exact: true }).click(); assert.deepEqual(state.records.departments.map(row => row.sortOrder), [0, 1]); assert.equal(updates(state).length, 0); await context.close()
  })
  await scenario('browser WebP conversion uploads exact checksum bytes then confirm and autosave selected photo', async () => {
    const state = fixture(); const { page, context } = await setup(state)
    let uploaded = null
    await context.route(`${origin}/__fixture-upload`, async route => {
      const request = route.request(); uploaded = { method: request.method(), headers: request.headers(), bytes: request.postDataBuffer() }
      await route.fulfill({ status: 200, body: '' })
    })
    await page.locator('.listItems button').first().click()
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); return canvas.toDataURL('image/png').split(',')[1] })
    await page.getByLabel('프로필 사진 업로드').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await waitUntil(() => state.records.members[0].imageMediaId === second)
    assert.equal(uploaded.method, 'PUT'); assert.equal(uploaded.headers['content-type'], 'image/webp'); assert.equal(uploaded.headers['if-none-match'], '*')
    const { createHash } = await import('node:crypto'); assert.equal(uploaded.headers['x-amz-checksum-sha256'], createHash('sha256').update(uploaded.bytes).digest('base64'))
    const presign = state.calls.find(call => call.pathname.endsWith('/media/presign')); assert.equal(presign.body.size, uploaded.bytes.length); assert.equal(presign.body.kind, 'member')
    assert.ok(state.calls.findIndex(call => call.pathname.endsWith('/media/confirm')) < state.calls.findIndex(call => call.method === 'PUT'))
    assert.equal(updates(state).at(-1).body.imageMediaId, second); await context.close()
  })
  await scenario('two real browser tabs synchronize durable changes and publication terminal polling', async () => {
    const state = fixture(); const { page, context } = await setup(state)
    const secondPage = await context.newPage(); secondPage.on('dialog', dialog => dialog.accept()); await secondPage.goto(`${origin}/admin/?tab=members`); await secondPage.locator('.listItems button').first().waitFor()
    await page.locator('.listItems button').first().click(); await page.getByLabel('이름', { exact: true }).fill('tab change')
    await waitUntil(() => state.records.members[0].name === 'tab change')
    await secondPage.getByText('저장됨 · 사이트 미반영', { exact: true }).waitFor()
    await page.getByRole('button', { name: '변경사항 반영하기', exact: true }).click(); await page.getByRole('button', { name: '전체 사이트 반영', exact: true }).click()
    await secondPage.getByText('사이트 반영 중', { exact: true }).waitFor()
    state.jobState = 'published'; await secondPage.getByText('모든 변경사항 반영됨', { exact: true }).waitFor({ timeout: 10000 }); await page.getByText('모든 변경사항 반영됨', { exact: true }).waitFor()
    const publish = state.calls.find(call => call.pathname === '/api/admin/publish'); assert.equal(publish.body.scope, 'all'); assert.ok(publish.body.idempotencyKey)
    await secondPage.reload(); await secondPage.getByText('모든 변경사항 반영됨', { exact: true }).waitFor(); await context.close()
  })
  await scenario('actual hook unmount/remount retains detached pending queue and global flush saves latest payload', async () => {
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(`${origin}/admin/__hook`)
    await page.getByLabel('Lifecycle draft').fill('old A'); await page.waitForFunction(() => window.hookHarness.calls.length === 1)
    await page.getByLabel('Lifecycle draft').fill('old B'); await page.getByRole('button', { name: 'Toggle mount' }).click(); await page.getByRole('button', { name: 'Toggle mount' }).click()
    await page.getByLabel('Lifecycle draft').fill('new C')
    await page.evaluate(() => { window.hookFlush = window.hookHarness.flush(); window.hookHarness.release() })
    await page.evaluate(() => window.hookFlush)
    assert.deepEqual(await page.evaluate(() => window.hookHarness.calls), ['old A', 'old B', 'new C'])
    assert.equal(await page.evaluate(() => window.hookHarness.state().pending), 0); await context.close()
  })
  await scenario('real MarkdownField EditorView harness completes all checks', async () => {
    const page = await browser.newPage(); await page.goto(`${origin}/admin/src/components/MarkdownField.browser-check.html`)
    await page.waitForFunction(() => /RESULT (PASS|FAIL)/.test(document.querySelector('#result')?.textContent ?? ''))
    const result = await page.locator('#result').innerText(); assert.match(result, /RESULT PASS/); console.log(result); await page.close()
  })
  console.log(`CMS browser: ${passed} scenarios passed`)
} finally { await browser.close(); await vite.close() }

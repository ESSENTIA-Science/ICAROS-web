// Optional real Chrome suite; needs Playwright in ICAROS_TEST_TOOLS or sibling test-tools.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const tools = process.env.ICAROS_TEST_TOOLS ?? path.resolve(here, '../../../../../../../test-tools/node_modules')
const { chromium } = await import(pathToFileURL(path.join(tools, 'playwright/index.mjs')).href)
const server = spawn(process.execPath, [path.join(here, 'browser-server.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] })
const started = new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => { if (chunk.toString().includes('W16 fixture:')) resolve() })
  server.once('error', reject)
  server.once('exit', code => reject(Error(`W16 fixture exited (${code})`)))
})
const base = 'http://127.0.0.1:5196/src/components/three/__tests__/browser-check.html'
let browser
const findings = []
try {
  await Promise.race([started, delay(15000, undefined, { ref: false }).then(() => { throw Error('W16 server startup timeout') })])
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break } catch { /* server is starting */ }
    if (attempt > 100) throw Error('W16 fixture server did not start')
    await delay(100)
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] })
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' })
  let glbNetworkRequests = 0
  page.on('request', request => { if (request.url().includes('icx-2.glb')) glbNetworkRequests++ })
  const failures = []
  page.on('pageerror', error => failures.push(error.message))
  await page.goto(base)
  await page.waitForFunction(() => window.graphicsHarness?.stats.ready === 1, { timeout: 30000 })
  const read = () => page.evaluate(() => structuredClone(window.graphicsHarness.stats))
  const patch = options => page.evaluate(options => window.graphicsHarness.set(options), options)
  const rendered = async milliseconds => {
    const before = (await read()).renders
    await page.waitForTimeout(milliseconds)
    return (await read()).renders - before
  }
  assert.equal(await rendered(350), 0, 'reduced-motion detail must sleep')
  findings.push({ check: 'reduced detail settled renders / 350ms', count: 0 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  assert.ok(await rendered(350) > 0, 'detail autoRotate should resume')
  const requests = (await read()).requests
  const detailNetworkRequests = glbNetworkRequests
  await patch({ active: false }); await page.waitForTimeout(100)
  assert.equal(await rendered(350), 0, 'inactive detail must not render')
  await patch({ active: true })
  assert.ok(await rendered(350) > 0, 'detail reentry should resume')
  assert.equal((await read()).requests, requests, 'active transitions must not reload the GLB')
  assert.equal(glbNetworkRequests, detailNetworkRequests, 'reentry must not dispatch another network request')
  findings.push({ check: 'detail inactive/reentry requests', requests, inactiveRenders: 0 })
  const foreground = await browser.newPage()
  await foreground.goto('about:blank'); await foreground.bringToFront(); await page.waitForTimeout(200)
  const hidden = await page.evaluate(() => document.hidden)
  if (hidden) assert.equal(await rendered(350), 0, 'hidden detail must stop')
  findings.push({ check: 'native document hidden', observed: hidden, renders: hidden ? 0 : 'headless tab stayed visible; synthetic subscription tested' })
  await foreground.close(); await page.bringToFront(); await page.waitForTimeout(100)

  await patch({ mode: 'none' }); await page.waitForTimeout(100)
  const detailCleanup = await read()
  assert.ok(detailCleanup.geometryDisposes >= 31)
  assert.ok(detailCleanup.materialDisposes >= 31)
  assert.equal(detailCleanup.rendererDisposes, 1)
  findings.push({ check: 'local GLB detail cleanup', ...detailCleanup })

  const textured = await page.evaluate(() => window.graphicsHarness.texturedModel())
  await patch({ mode: 'detail', src: textured })
  await page.waitForFunction(() => window.graphicsHarness.stats.ready === 2)
  await patch({ mode: 'none' }); await page.waitForTimeout(100)
  assert.ok((await read()).textureDisposes > detailCleanup.textureDisposes)
  assert.ok((await read()).bitmapCloses > detailCleanup.bitmapCloses)
  findings.push({ check: 'textured GLTF cleanup', stats: await read() })

  const beforeLate = await read()
  await patch({ mode: 'detail', src: '/assets/models/icx-2.glb?delay=800' })
  await page.waitForFunction(expected => window.graphicsHarness.stats.requests > expected, beforeLate.requests)
  await patch({ mode: 'none' })
  await page.waitForTimeout(1200)
  const late = await read()
  assert.ok(late.geometryDisposes > beforeLate.geometryDisposes, 'late scene geometries must be disposed')
  assert.equal(late.ready, beforeLate.ready, 'late scene must not render')
  findings.push({ check: 'late GLB cleanup', geometryDisposes: late.geometryDisposes - beforeLate.geometryDisposes, materialDisposes: late.materialDisposes - beforeLate.materialDisposes })

  await patch({ mode: 'detail-stage', src: '/assets/models/icx-2.glb' })
  await page.waitForSelector('[data-ready]', { state: 'attached' })
  assert.ok(await rendered(150) > 0)
  const observedDetailRequests = glbNetworkRequests
  await page.evaluate(() => scrollTo(0, 1800)); await page.waitForTimeout(200)
  assert.equal(await rendered(350), 0, 'actual ModelStage observer must stop offscreen detail')
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100)
  assert.ok(await rendered(150) > 0, 'actual ModelStage observer must resume detail')
  assert.equal(glbNetworkRequests, observedDetailRequests)
  await page.getByRole('button', { name: 'synthetic-stage 3D 모델 크게 보기', exact: true }).click()
  await page.waitForSelector('[aria-modal=true]')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[aria-modal=true]').count(), 0, 'detail modal must still close with Escape')
  findings.push({ check: 'actual ModelStage offscreen/reentry/expand/Escape', inactiveRenders: 0, reentryNetworkAdded: 0 })
  await patch({ mode: 'none' }); await page.waitForTimeout(150)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const beforeHero = await read()
  await patch({ mode: 'hero', src: '/assets/models/icx-2.glb', reduced: true })
  await page.waitForFunction(expected => window.graphicsHarness.stats.ready > expected, beforeHero.ready)
  await page.waitForTimeout(200)
  assert.equal(await rendered(350), 0, 'static hero must sleep after two-frame readiness')
  assert.equal((await read()).roomDisposes, 1)
  await page.evaluate(() => scrollTo(0, 100))
  assert.ok(await rendered(150) > 0, 'static hero must reframe after scrolling')
  await page.waitForTimeout(200)
  assert.equal(await rendered(350), 0)
  await page.evaluate(() => scrollTo(0, 1800)); await page.waitForTimeout(200)
  assert.equal(await rendered(350), 0, 'offscreen hero must stop')
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200)
  const reentered = await read()
  assert.ok(reentered.renders > beforeHero.renders)
  assert.equal(reentered.requests, beforeHero.requests + 1, 'cached hero must not download on reentry')
  findings.push({ check: 'static hero readiness/scroll/offscreen/reentry', stats: reentered })
  await patch({ mode: 'none' }); await page.waitForTimeout(200)
  const beforePointer = (await read()).ready
  await patch({ mode: 'hero', reduced: false, autoRotate: false })
  await page.waitForFunction(expected => window.graphicsHarness.stats.ready > expected, beforePointer)
  await page.waitForTimeout(200)
  assert.equal(await rendered(350), 0, 'autoRotate=false hero must sleep')
  await page.mouse.move(30, 30)
  assert.ok(await rendered(150) > 0, 'pointer parallax must still animate')
  await page.waitForTimeout(300)
  assert.equal(await rendered(350), 0, 'pointer parallax must settle back to demand')
  findings.push({ check: 'autoRotate=false pointer parallax', settledRenders: 0 })
  await patch({ mode: 'none' }); await page.waitForTimeout(200)
  await patch({ mode: 'stage', src: '/assets/models/icx-2.glb' })
  await page.waitForSelector('[data-phase=live]')
  const stageRequests = (await read()).requests
  const stageNetworkRequests = glbNetworkRequests
  await page.setViewportSize({ width: 700, height: 900 })
  await page.waitForSelector('[data-phase=poster]')
  assert.equal(await page.locator('canvas').count(), 0, 'mobile-disabled must unmount Canvas')
  const mobileCount = await read()
  await page.waitForTimeout(100)
  assert.equal(await rendered(350), 0, 'mobile-disabled must stop render')
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.waitForSelector('[data-phase=live]')
  assert.equal(await page.locator('canvas').count(), 1, 'desktop re-promotion must restore Canvas')
  assert.equal((await read()).requests, stageRequests, 'shared hero loader cache should remain reusable')
  assert.equal(glbNetworkRequests, stageNetworkRequests, 'responsive re-promotion must not dispatch another GLB request')
  findings.push({ check: 'desktop/mobile/desktop hero promotion', requests: stageRequests, mobileRenders: 0, mobileRoomDisposes: mobileCount.roomDisposes })
  await patch({ mode: 'none' }); await page.waitForTimeout(200)
  await patch({ mode: 'stage', enabledMobile: true })
  await page.waitForSelector('[data-phase=live]')
  const allowedCanvas = await page.locator('canvas').elementHandle()
  const allowedRequests = glbNetworkRequests
  for (const width of [700, 1200]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(250)
    assert.equal(await page.locator('[data-phase]').getAttribute('data-phase'), 'live', 'allowed breakpoint transition must preserve live readiness')
    assert.equal(await page.locator('img').getAttribute('data-hidden'), 'true', 'poster must stay hidden while the same Scene remains live')
    assert.equal(await allowedCanvas.evaluate(canvas => canvas.isConnected), true, 'both-enabled breakpoint must retain Canvas')
    assert.equal(glbNetworkRequests, allowedRequests, 'both-enabled breakpoint must not dispatch another GLB request')
  }
  for (const enabledMobile of [false, true]) {
    await patch({ enabledMobile }); await page.waitForTimeout(250)
    assert.equal(await page.locator('[data-phase]').getAttribute('data-phase'), 'live', 'allowed desktop policy changes must preserve the live Scene')
    assert.equal(await allowedCanvas.evaluate(canvas => canvas.isConnected), true)
  }
  findings.push({ check: 'both-enabled desktop/mobile/desktop live readiness', phase: 'live', canvasRetained: true, posterHidden: true, reentryNetworkAdded: 0, livePolicyChangesPreserved: true })
  await patch({ mode: 'none' }); await page.waitForTimeout(200)
  assert.deepEqual(failures, [], 'browser JS errors')
  findings.push({ check: 'browser errors', errors: failures })
  findings.push({ check: 'GLB browser network requests', total: glbNetworkRequests, detailReentryAdded: 0, responsiveHeroReentryAdded: 0 })
  console.log(JSON.stringify({ status: 'PASS', engine: 'installed Chrome headless; renderer.info counts only, CPU/GPU bytes unmeasured', findings }, null, 2))
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}

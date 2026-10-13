import { strict as assert } from 'node:assert'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const workspacePlaywright = fileURLToPath(new URL('../../../../node_modules/playwright/index.mjs', import.meta.url))
const modulePath = process.env.ICAROS_TEST_PLAYWRIGHT_MODULE ?? (existsSync(workspacePlaywright) ? workspacePlaywright : fileURLToPath(new URL('../../../../../test-tools/node_modules/playwright/index.mjs', import.meta.url)))
const { chromium } = await import(modulePath)
const server = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  cwd: fileURLToPath(new URL('../../../../', import.meta.url)), env: { ...process.env, ICAROS_UI_TEST_PORT: '5198' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
server.stdout.on('data', chunk => { serverOutput += chunk })
server.stderr.on('data', chunk => { serverOutput += chunk })
const base = 'http://127.0.0.1:5198/'
let browser
const results = []
async function check(name, run) {
  try { const detail = await run(); results.push({ name, status: 'PASS', detail }) }
  catch (error) { results.push({ name, status: 'FAIL', error: error.message }) }
}
async function newPage(options) {
  const page = await browser.newPage(options)
  page.setDefaultTimeout(5000)
  return page
}
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { const response = await fetch(base); if (response.ok) break } catch { /* local fixture is starting */ }
    if (attempt === 49) throw new Error(`Fixture failed to start: ${serverOutput}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const executablePath = process.env.ICAROS_BROWSER_EXECUTABLE ?? process.env.ICAROS_TEST_CHROME ?? (existsSync(localChrome) ? localChrome : undefined)
  browser = await chromium.launch({ executablePath, headless: true })
  await check('mobile menu 390→844 releases scroll and focus trap', async () => {
    const page = await newPage({ viewport: { width: 390, height: 844 } })
    let navigations = 0
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
    const browserErrors = []
    page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`))
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`) })
    page.on('requestfailed', request => browserErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`))
    page.on('response', response => { if (response.status() >= 400) browserErrors.push(`response: ${response.status()} ${response.url()}`) })
    await page.goto(`${base}?hydrateDelay=5500`)
    // The first Vite/React hydration can take longer on a cold CI runner.
    try { await page.waitForSelector('html[data-test-hydrated]', { timeout: 15000 }) }
    catch (error) {
      const state = await page.evaluate(() => ({
        readyState: document.readyState,
        scriptLoaded: document.documentElement.dataset.testScriptLoaded ?? null,
        hydrated: document.documentElement.dataset.testHydrated ?? null,
        enhanced: document.querySelector('header')?.hasAttribute('data-enhanced') ?? null,
        scripts: Array.from(document.scripts, script => script.src),
        resources: performance.getEntriesByType('resource').slice(-12).map(entry => entry.name),
      })).catch(inspectError => ({ inspectionError: String(inspectError) }))
      throw new Error(`${error.message}\nHydration diagnostics: ${JSON.stringify({ state, navigations, browserErrors: browserErrors.slice(0, 12), serverOutput: serverOutput.slice(-2000) })}`)
    }
    await page.getByRole('button', { name: '메뉴 열기' }).click()
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden')
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForFunction(() => document.body.style.overflow !== 'hidden')
    assert.equal(await page.getByRole('button', { name: '메뉴 열기', includeHidden: true }).getAttribute('aria-expanded'), 'false')
    await page.locator('#nav-menu a').last().focus()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '#support')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.getByRole('button', { name: '메뉴 열기' }).getAttribute('aria-expanded'), 'false')
    await page.close()
  })
  await check('A404→B200 renders the next image in the same dialog', async () => {
    const page = await newPage()
    await page.goto(base)
    await page.waitForSelector('html[data-test-hydrated]')
    await page.getByRole('button', { name: 'A 실패 크게 보기' }).click()
    await page.locator('dialog [role="img"]').waitFor()
    await page.getByRole('button', { name: '다음 사진' }).click()
    await page.waitForFunction(() => { const img = document.querySelector('dialog img'); return img?.complete && img.naturalWidth > 0 })
    assert.equal(await page.locator('dialog img').getAttribute('alt'), 'B 정상')
    await page.close()
  })
  await check('support CTA lands and disappears with Donate disabled', async () => {
    const page = await newPage()
    await page.goto(base)
    await page.waitForSelector('html[data-test-hydrated]')
    await page.getByRole('link', { name: '후원', exact: true }).click()
    assert.equal(new URL(page.url()).hash, '#support')
    assert.equal(await page.locator('#support').count(), 1)
    const top = await page.locator('#support').evaluate(element => element.getBoundingClientRect().top)
    assert(top >= 0 && top < 720, `landing top=${top}`)
    await page.locator('#support-toggle').click()
    assert.equal(await page.locator('a[href="#support"]').count(), 0)
    assert.equal(await page.locator('#support').count(), 0)
    await page.close()
    return { supportTop: top }
  })
  await check('JS disabled mobile navigation and poster stay visible', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(base)
    assert(await page.locator('#nav-menu a[href="/vehicles"]').isVisible())
    assert(await page.locator('#nav-menu a[href="/member"]').isVisible())
    assert.equal(await page.getByRole('button', { name: '메뉴 열기' }).isVisible(), false)
    assert(await page.locator('img[src="/assets/poster.svg"]').isVisible())
    assert.equal(await page.locator('video').getAttribute('src'), null)
    await context.close()
  })
  await check('failed hydration chunk leaves mobile navigation usable', async () => {
    const page = await newPage({ viewport: { width: 390, height: 844 } })
    await page.route('**/apps/web/tests/browser/page.tsx', route => route.abort())
    await page.goto(base)
    assert(await page.locator('#nav-menu a[href="/vehicles"]').isVisible())
    assert.equal(await page.getByRole('button', { name: '메뉴 열기' }).isVisible(), false)
    await page.close()
  })
  await check('reduced motion changes, offscreen pause and autoplay rejection retain poster', async () => {
    const page = await newPage({ reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      window.__video = { plays: 0, pauses: 0 }
      HTMLMediaElement.prototype.play = function() {
        window.__video.plays++
        this.dispatchEvent(new Event('playing'))
        return Promise.resolve()
      }
      HTMLMediaElement.prototype.pause = function() { window.__video.pauses++ }
    })
    await page.goto(base)
    await page.waitForSelector('html[data-test-hydrated]')
    assert.equal(await page.locator('video').getAttribute('src'), null)
    assert.equal(await page.locator('video').evaluate(el => getComputedStyle(el).opacity), '0')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => window.__video.plays > 0)
    assert.equal(await page.locator('video').evaluate(el => getComputedStyle(el).opacity), '1')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForFunction(() => document.querySelector('video')?.getAttribute('src') === null)
    assert.equal(await page.locator('video').evaluate(el => getComputedStyle(el).opacity), '0')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(() => document.querySelector('video')?.getAttribute('src'))
    await page.locator('#footer-copy').scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('video')?.getAttribute('src') === null)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForFunction(() => document.querySelector('video')?.getAttribute('src'))
    await page.close()
    const rejected = await newPage()
    await rejected.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'))
      HTMLMediaElement.prototype.pause = () => {}
    })
    await rejected.goto(base)
    await rejected.waitForSelector('html[data-test-hydrated]')
    await rejected.waitForFunction(() => document.querySelector('video')?.getAttribute('src') === null)
    assert(await rejected.locator('img[src="/assets/poster.svg"]').isVisible())
    assert.equal(await rejected.locator('video').evaluate(el => getComputedStyle(el).opacity), '0')
    await rejected.close()
    return 'Real matchMedia/IntersectionObserver; play/pause stubbed to exercise lifecycle deterministically'
  })
  await check('computed nonselected tab and Footer text contrast exceeds 4.5:1', async () => {
    const page = await newPage()
    await page.goto(base)
    await page.waitForSelector('html[data-test-hydrated]')
    const samples = await page.evaluate(() => ['nav[aria-label="종류"] a:not([data-active])', '#footer-copy', '#contact-label', '#mission-number', '#hero-scroll', '#post-meta'].map(selector => {
      const element = document.querySelector(selector)
      const style = getComputedStyle(element)
      let parent = element
      while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement
      return { selector, color: style.color, background: getComputedStyle(parent).backgroundColor, fontSize: style.fontSize }
    }))
    const rgb = color => color.match(/[\d.]+/g).map(Number)
    const luminance = channels => channels.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    for (const sample of samples) {
      const foreground = rgb(sample.color), background = rgb(sample.background)
      const alpha = foreground[3] ?? 1
      const effective = foreground.slice(0, 3).map((value, index) => value * alpha + background[index] * (1 - alpha))
      sample.ratio = (Math.max(luminance(effective), luminance(background)) + 0.05) / (Math.min(luminance(effective), luminance(background)) + 0.05)
      assert(sample.ratio >= 4.5, `${sample.selector}: ${sample.ratio}`)
    }
    await page.close()
    return samples
  })
  await check('slow portrait reserves dimensions before load and keeps the following text stable', async () => {
    const page = await newPage({ viewport: { width: 390, height: 844 } })
    let release
    const held = new Promise(resolve => { release = resolve })
    await page.route('**/assets/portrait.svg', async route => { await held; await route.continue() })
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('html[data-test-hydrated]')
    await page.locator('#portrait-gallery').scrollIntoViewIfNeeded()
    const before = await page.locator('#after-gallery').evaluate(element => element.getBoundingClientRect().top + window.scrollY)
    assert.equal(await page.locator('#portrait-gallery img').first().getAttribute('width'), '512')
    assert.equal(await page.locator('#portrait-gallery img').first().getAttribute('height'), '1024')
    release()
    await page.waitForFunction(() => [...document.querySelectorAll('#portrait-gallery img')].every(image => image.complete && image.naturalWidth > 0))
    const after = await page.locator('#after-gallery').evaluate(element => element.getBoundingClientRect().top + window.scrollY)
    assert(Math.abs(before - after) <= 1, `text moved ${after - before}px`)
    await page.close()
    return { before, after, movement: after - before }
  })
  console.log(JSON.stringify({ harness: 'React SSR + hydration in real Chrome; Next routing/image wrappers replaced by native DOM', results }, null, 2))
  if (results.some(result => result.status === 'FAIL')) process.exitCode = 1
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}

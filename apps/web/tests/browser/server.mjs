import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const baseline = process.env.ICAROS_UI_BASELINE ? JSON.parse(readFileSync(process.env.ICAROS_UI_BASELINE, 'utf8')) : {}
const vite = await createServer({ root, configFile: false, cacheDir: `/tmp/icaros-public-ui-vite-${process.pid}`, esbuild: { jsx: 'automatic' },
  plugins: [{ name: 'public-ui-regression-baseline', enforce: 'pre', transform(code, id) {
    const path = id.split('?')[0].replace(root, '')
    return baseline[path] ?? null
  } }],
  resolve: { alias: {
    '@': `${root}apps/web/src`,
    'next/navigation': `${fixture}navigation.ts`,
    'next/link': `${fixture}link.ts`,
    'next/image': `${fixture}image.ts`,
    [`${root}apps/web/src/assets/logo_text_white.svg`]: `${fixture}logo.ts`,
    'server-only': `${root}apps/web/tests/empty.mjs`,
  } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
const server = createHttpServer(async (req, res) => {
  if (req.url?.startsWith('/assets/')) {
    const portrait = req.url.includes('portrait')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 512 : 960}" height="${portrait ? 1024 : 540}"><rect width="100%" height="100%" fill="#555"/></svg>`
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end(svg); return
  }
  if (req.url?.startsWith('/test-assets/')) { res.writeHead(404); res.end(); return }
  if (req.url === '/' || req.url?.startsWith('/?')) {
    try {
      const { App } = await vite.ssrLoadModule('/apps/web/tests/browser/page.tsx')
      const markup = renderToString(createElement(App))
      const css = ['app/tokens.css', 'components/ui/Header.module.css', 'components/ui/Footer.module.css', 'components/panel/Panel.module.css',
        'components/rocket/VehicleGallery.module.css', 'components/rocket/TabNav.module.css', 'components/posts/PostImageGallery.module.css',
        'components/landing/Section.module.css', 'components/landing/Donate.module.css'].map(path => `<link rel="stylesheet" href="/apps/web/src/${path}?direct">`).join('')
      const html = await vite.transformIndexHtml('/', `<html><head>${css}<style>body{margin:0}ul{list-style:none;margin:0;padding:0}a{color:inherit;text-decoration:none}button{cursor:pointer}main{color:white;background:var(--bg)}#portrait-gallery{max-width:820px}</style></head><body><div id="root">${markup}</div><script type="module" src="/apps/web/tests/browser/page.tsx"></script></body></html>`)
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html)
    } catch (error) { res.writeHead(500); res.end(String(error)) }
    return
  }
  vite.middlewares(req, res, () => { res.writeHead(404); res.end() })
})
server.listen(Number(process.env.ICAROS_UI_TEST_PORT ?? 5197), '127.0.0.1', () => console.log('Public UI fixture: http://127.0.0.1:5197'))

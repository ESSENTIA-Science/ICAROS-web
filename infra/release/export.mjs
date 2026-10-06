import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { sharedAssetPath } from './asset-contract.mjs'
import { compatibilityMediaIndex } from './compat-media-index.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export const safeExportPath = value => value.length > 0 && !value.startsWith('/') &&
  !value.split('/').some(part => !part || part === '.' || part === '..') &&
  (/^[a-zA-Z0-9/_.,-]+$/.test(value) || /^(?:[a-zA-Z0-9_.,-]+\/)*__next\.[a-zA-Z0-9_!$.,-]+\.txt$/.test(value))
const inAssetTree = path => path.startsWith('_next/static/') || path.startsWith('assets/')
const isAsset = sharedAssetPath

export function exportFiles(root) {
  const paths = []
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const name = relative(root, path).split('\\').join('/')
        if (!safeExportPath(name) || name === 'manifest.json') throw new Error('Invalid export file')
        paths.push(name)
      } else throw new Error('Unsupported export entry')
    }
  }
  walk(root)
  return paths.sort()
}

function rewriteCss(text, path, prefix, assets) {
  function scoped(value) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return value
    const url = new URL(value, `https://export.invalid/${path}`)
    const rawName = url.pathname.slice(1)
    const name = rawName.startsWith('fonts/') ? `assets/${rawName}` : rawName
    if (!isAsset(name) || !assets.has(name)) throw new Error(`Missing or escaping CSS dependency: ${path}`)
    return `${prefix}/${name}${url.search}${url.hash}`
  }
  return text.replace(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)'"\n]+))\s*\)/gi, (_whole, double, single, bare) =>
    { const value = double ?? single ?? bare; const next = scoped(value); return next === value ? _whole : `url("${next}")` }).replace(/(@import\s+)(["'])([^"'\n]+)\2/gi,
    (_whole, start, quote, url) => `${start}${quote}${scoped(url)}${quote}`)
}

function rewriteText(text, path, prefix, assets) {
  if (path.endsWith('.css')) return rewriteCss(text, path, prefix, assets)
  if (/(?:["'`(\s=,:])\/assets\/(?:local-media|proxy-members|private)(?:\/|["'])/.test(text)) {
    throw new Error('Private/local media cannot be referenced by a shared release')
  }
  // Match root URL tokens only. Remote/public-media and ordinary page links stay intact.
  let result = text.replace(/(^|["'`(\s=,:])\/(assets\/|_next\/static\/|fonts\/)/g,
    (_whole, boundary, root) => `${boundary}${prefix}/${root === 'fonts/' ? 'assets/fonts/' : root}`)
  if (path.endsWith('.js')) {
    // Turbopack lazy imports use /_next/ (not /_next/static/). Preserve marker
    // strings such as currentScript.indexOf('/_next/') used to infer assetPrefix.
    result = result.replace(/(TURBOPACK_CHUNK_BASE_PATH\s*:\s*)(["'])\/_next\/\2/g,
      (_whole, start, quote) => `${start}${quote}${prefix}/_next/${quote}`)
    result = result.replace(/\$\{([a-zA-Z_$][\w$]*(?:\.[\w$]+)*\.assetPrefix)\}\/_next\//g,
      (_whole, variable) => '${(' + variable + '||"' + prefix + '")}/_next/')
  }
  return result
}

/** Offline preparation. No AWS calls; the uploader consumes the resulting hashes.
 * Namespace hashes original asset bytes plus transformer source, avoiding the
 * HTML→manifest→HTML cycle. Final rewritten bytes have their own manifest SHA.
 */
export function prepareReleaseExport(root, snapshot) {
  const index = compatibilityMediaIndex(snapshot)
  if (snapshot.members?.some(member => member.hasPhoto === true && member.imageSrc?.startsWith('/assets/'))) {
    throw new Error('Selected member portraits cannot be copied to shared immutable assets')
  }
  const paths = exportFiles(root)
  const aliases = new Map()
  for (const path of paths.filter(path => path.startsWith('fonts/'))) {
    const target = `assets/${path}`
    if (!sharedAssetPath(target)) throw new Error('Unsupported root font export')
    const bytes = readFileSync(join(root, path))
    if (existsSync(join(root, target)) && hash(readFileSync(join(root, target))) !== hash(bytes)) throw new Error('Root font alias collision')
    aliases.set(target, bytes)
  }
  for (const target of aliases.keys()) if (!paths.includes(target)) paths.push(target)
  paths.sort()
  for (const required of ['index.html', '404.html', 'sitemap.xml']) if (!paths.includes(required)) throw new Error(`Missing required export: ${required}`)
  const assets = new Set(paths.filter(isAsset))
  if (!assets.size) throw new Error('Missing static export assets')
  const sourceTree = [...assets].map(path => ({ path, sha256: hash(aliases.get(path) ?? readFileSync(join(root, path))) }))
  // Including the transformer bytes prevents reuse after rewrite logic changes.
  const assetHash = hash(JSON.stringify({ transformer: hash(Buffer.concat([readFileSync(new URL(import.meta.url)), readFileSync(new URL('./asset-contract.mjs', import.meta.url))])), files: sourceTree }))
  const prefix = `/_release/${assetHash}`
  // Compute everything first; invalid CSS must not leave a partly prepared tree.
  const rewritten = new Map()
  for (const path of paths) {
    if ((!inAssetTree(path) || assets.has(path)) && /\.(?:html|css|js|txt|rsc|svg)$/.test(path)) {
      const text = readFileSync(join(root, path), 'utf8')
      rewritten.set(path, rewriteText(text, path, prefix, assets))
    }
  }
  for (const [path, bytes] of aliases) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes) }
  for (const path of paths.filter(path => inAssetTree(path) && !assets.has(path))) rmSync(join(root, path))
  for (const [path, text] of rewritten) writeFileSync(join(root, path), text)
  writeFileSync(join(root, 'compat-media-index.json'), `${JSON.stringify(index)}\n`)
  const memberIds = Object.entries(index.media).filter(([, media]) => media.storage === 'private').map(([id]) => id).sort()
  writeFileSync(join(root, 'published-member-media.json'), `${JSON.stringify({ version: snapshot.version, mediaIds: memberIds })}\n`)
  const files = exportFiles(root).map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }))
  return { assetHash, assetPrefix: prefix, files,
    assets: files.filter(file => isAsset(file.path)).map(file => ({ ...file, key: `release-assets/${assetHash}/${file.path}` })) }
}

export function exportContentType(path) {
  const extension = path.split('.').at(-1)
  return ({ html: 'text/html; charset=utf-8', xml: 'application/xml; charset=utf-8',
    css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8', rsc: 'text/plain; charset=utf-8', svg: 'image/svg+xml',
    webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon', ttf: 'font/ttf', otf: 'font/otf',
    woff: 'font/woff', woff2: 'font/woff2', glb: 'model/gltf-binary', mp4: 'video/mp4', pdf: 'application/pdf',
  })[extension] ?? 'application/octet-stream'
}

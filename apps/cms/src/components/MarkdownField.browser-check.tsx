import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { StateEffect } from '@codemirror/state'
import { EditorView, type DecorationSet } from '@codemirror/view'
import MarkdownField from './MarkdownField'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mount = document.querySelector<HTMLDivElement>('#mount')!
const results: string[] = []
const table = '| 이름 | 값 |\n| --- | --- |\n| 원본 | 1 |'
const gallery = ':::gallery{columns=2}\n\n![원본](/assets/img/synthetic.webp)\n\n:::'
const before = '앞부분\n\n'
const after = '\n\n뒷부분'
let current = ''

function Fixture({ initial, uploadIntent }: { initial: string; uploadIntent?: 'member' }) {
  const [value, setValue] = useState(initial)
  useEffect(() => { current = value }, [value])
  return <MarkdownField label="회귀 본문" value={value} onChange={setValue} {...(uploadIntent ? { uploadIntent } : {})} />
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
function button(label: string) {
  const control = [...mount.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label)
  assert(control, `Missing button: ${label}`)
  return control
}
async function run(name: string, check: (view: EditorView) => Promise<void>, initial = `${before}${table}${after}`, uploadIntent?: 'member') {
  const root = createRoot(mount)
  try {
    await act(async () => root.render(<Fixture initial={initial} uploadIntent={uploadIntent} />))
    const view = EditorView.findFromDOM(mount.querySelector('.cm-editor')!)
    assert(view, 'Missing real CodeMirror view')
    await check(view)
    results.push(`PASS ${name}`)
  } catch (error) { results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`) }
  finally { await act(async () => root.unmount()) }
}
async function open(view: EditorView, name: string) {
  await act(async () => view.dispatch({ selection: { anchor: before.length + 3 } }))
  await act(async () => button(name).click())
}
for (const [name, block] of [['표 편집', table], ['이미지 배치', gallery]]) {
  await run(`${name}: insertion before target preserves surrounding text`, async view => {
    await open(view, name!)
    await act(async () => view.dispatch({ changes: { from: 0, insert: '추가\n' } }))
    await act(async () => button('본문에 적용').click())
    assert(current === `추가\n${before}${block}${after}`, `Corrupted body: ${JSON.stringify(current)}`)
  }, `${before}${block}${after}`)
  await run(`${name}: insertions at block edges stay outside replacement`, async view => {
    await open(view, name!)
    await act(async () => view.dispatch({ changes: [
      { from: before.length, insert: '추가 앞\n\n' },
      { from: before.length + block!.length, insert: '\n\n추가 뒤' },
    ] }))
    await act(async () => button('본문에 적용').click())
    assert(current === `${before}추가 앞\n\n${block}\n\n추가 뒤${after}`, `Block-edge text was replaced: ${JSON.stringify(current)}`)
  }, `${before}${block}${after}`)
  await run(`${name}: deletion before target preserves surrounding text`, async view => {
    await open(view, name!)
    await act(async () => view.dispatch({ changes: { from: 0, to: 2 } }))
    await act(async () => button('본문에 적용').click())
    assert(current === `${before.slice(2)}${block}${after}`, `Corrupted body: ${JSON.stringify(current)}`)
  }, `${before}${block}${after}`)
  await run(`${name}: undo redo and selection movement keep the target`, async view => {
    await open(view, name!)
    const change = view.state.update({ changes: { from: 0, insert: '추가\n' } })
    const inverse = change.changes.invert(view.state.doc)
    await act(async () => view.dispatch(change))
    await act(async () => view.dispatch({ changes: inverse }))
    await act(async () => view.dispatch({ changes: change.changes }))
    await act(async () => view.dispatch({ selection: { anchor: view.state.doc.length } }))
    await act(async () => button('본문에 적용').click())
    assert(current === `추가\n${before}${block}${after}`, `Corrupted body after undo/redo: ${JSON.stringify(current)}`)
  }, `${before}${block}${after}`)
  await run(`${name}: deleting target blocks stale apply`, async view => {
    await open(view, name!)
    await act(async () => view.dispatch({ changes: { from: before.length, to: before.length + block!.length } }))
    const deleted = current
    await act(async () => button('본문에 적용').click())
    assert(current === deleted, 'Deleted block was restored into unrelated text')
    assert(button('본문에 적용').disabled, 'Stale apply remains enabled')
    assert(mount.querySelector('[role="alert"]'), 'Conflict is not visible')
  }, `${before}${block}${after}`)
  await run(`${name}: direct edit and undo require reopening`, async view => {
    await open(view, name!)
    const change = view.state.update({ changes: { from: before.length + 4, insert: '수정' } })
    const inverse = change.changes.invert(view.state.doc)
    await act(async () => view.dispatch(change))
    await act(async () => view.dispatch({ changes: inverse }))
    assert(button('본문에 적용').disabled, 'Conflict became valid without reopening')
    await act(async () => button(name!).click())
    // The original block is selected again even if the document cursor was mapped by the direct edit.
    assert(!button('본문에 적용').disabled, 'Reopening did not clear the conflict')
  }, `${before}${block}${after}`)
}

await run('new table: typing at the insertion cursor does not turn it into a replacement range', async view => {
  await act(async () => view.dispatch({ selection: { anchor: before.length } }))
  await act(async () => button('표 편집').click())
  await act(async () => view.dispatch({ changes: { from: before.length, insert: '입력\n\n' } }))
  await act(async () => button('본문에 적용').click())
  assert(current === `${before}입력\n\n| 항목 | 값 |\n| --- | --- |\n|  |  |\n\n뒷부분`, `Insertion text was replaced: ${JSON.stringify(current)}`)
}, `${before}뒷부분`)

function widgets(view: EditorView) {
  const values = []
  for (const source of view.state.facet(EditorView.decorations)) {
    const decorations: DecorationSet = typeof source === 'function' ? source(view) : source
    for (let cursor = decorations.iter(); cursor.value; cursor.next()) {
      if (cursor.value.spec.widget) values.push(cursor.value.spec.widget)
    }
  }
  return values
}
const image = '![사진](/api/media/11111111-1111-4111-8111-111111111111)'
const longDoc = `${'본문 '.repeat(24000)}\n${Array(500).fill(image).join('\n')}`
await run('large document: 60 cursor and viewport updates do not rescan or replace widgets', async view => {
  const original = String.prototype.matchAll
  let scans = 0
  String.prototype.matchAll = function (regexp: RegExp) {
    if (regexp.source.includes('api\\/media') && regexp.source.includes('36')) scans++
    return original.call(this, regexp)
  }
  let viewportUpdates = 0
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(update => {
    if (update.viewportChanged) viewportUpdates++
  })) })
  const previous = widgets(view)
  view.dom.style.height = '200px'
  view.scrollDOM.style.overflow = 'auto'
  try {
    for (let index = 0; index < 60; index++) await act(async () => view.dispatch({ selection: { anchor: index + 1 } }))
    for (let index = 0; index < 60; index++) {
      await act(async () => {
        view.dispatch({ effects: EditorView.scrollIntoView(index % 2 ? 0 : view.state.doc.length) })
        await new Promise(resolve => setTimeout(resolve, 25))
      })
    }
    const next = widgets(view)
    assert(viewportUpdates > 0, 'Scroll effects did not change the real viewport')
    assert(scans === 0, `Full image scans on cursor movement: ${scans}`)
    assert(previous.length === 500 && previous.every((widget, index) => widget === next[index]), 'Image widgets were recreated')
    results.push(`METRIC chars=${longDoc.length} images=500 cursor=60 viewportMoves=60 viewportUpdates=${viewportUpdates} scans=${scans} newWidgets=0`)
    const start = longDoc.indexOf(image)
    await act(async () => view.dispatch({ selection: { anchor: start + 2 } }))
    assert(widgets(view).length === 499, 'Selected image Markdown is hidden')
    await act(async () => view.dispatch({ selection: { anchor: start, head: start + image.length } }))
    assert(widgets(view).length === 499, 'Selected image range Markdown is hidden')
    await act(async () => view.dispatch({ selection: { anchor: 0 } }))
    assert(widgets(view).length === 500, 'Image preview did not return')
    await act(async () => view.dispatch({ changes: { from: start, to: start + image.length } }))
    assert(widgets(view).length === 499, 'Document change left stale image decoration')
    assert(Number(scans) === 1, `Expected one scan after document edit, got ${scans}`)
  } finally { String.prototype.matchAll = original }
}, longDoc)


for (const uploadIntent of [undefined, 'member'] as const) {
  for (const galleryUpload of [false, true]) {
    await run(`${uploadIntent ?? 'generic'} ${galleryUpload ? 'gallery' : 'inline'} upload: intent is present at presign`, async view => {
      const nonImageTool = mount.querySelector('button[aria-label="PDF 삽입"], button[aria-label="영상 삽입"]')
      assert(Boolean(nonImageTool && !nonImageTool.closest('[hidden]')) === !uploadIntent, 'Member editor offers an unsupported public attachment tool')
      if (uploadIntent) assert(mount.textContent?.includes('이미지만'), 'Member attachment restriction is not explained')
      const originalFetch = window.fetch
      const paths: string[] = []
      let presign: Record<string, unknown> | null = null
      window.fetch = async (input, init) => {
        const path = String(input)
        if (path === '/api/admin/media/presign') {
          paths.push('presign')
          presign = JSON.parse(String(init?.body))
          return Response.json({ ok: true, data: { mediaId: '11111111-1111-4111-8111-111111111111', uploadUrl: 'https://upload.example/synthetic', contentType: 'image/webp' } })
        }
        if (path === 'https://upload.example/synthetic') { paths.push('PUT'); return new Response(null, { status: 200 }) }
        if (path === '/api/admin/media/confirm') { paths.push('confirm'); return Response.json({ ok: true, data: { id: '11111111-1111-4111-8111-111111111111' } }) }
        return originalFetch(input, init)
      }
      try {
        if (galleryUpload) await open(view, '이미지 배치')
        const input = mount.querySelector<HTMLInputElement>(galleryUpload ? 'input[type="file"][multiple]' : 'input[aria-label="회귀 본문 이미지 파일"]')!
        const transfer = new DataTransfer()
        transfer.items.add(new File(['RIFFsynthetic-webp'], 'member.webp', { type: 'image/webp' }))
        input.files = transfer.files
        await act(async () => {
          input.dispatchEvent(new Event('change', { bubbles: true }))
          for (let attempt = 0; attempt < 50 && !paths.includes('confirm'); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
        })
        assert(paths.join(',') === 'presign,PUT,confirm', `Incomplete upload protocol: ${paths}`)
        assert((presign as Record<string, unknown> | null)?.kind === (uploadIntent ?? 'media'), `Missing privacy intent: ${JSON.stringify(presign)}`)
        if (galleryUpload) await act(async () => button('본문에 적용').click())
        assert(current.includes('/api/media/11111111-1111-4111-8111-111111111111'), 'Uploaded image was not inserted')
      } finally { window.fetch = originalFetch }
    }, 'synthetic body', uploadIntent)
  }
}

document.querySelector('#result')!.textContent = `${results.join('\n')}\nRESULT ${results.filter(result => result.startsWith('FAIL')).length === 0 ? 'PASS' : 'FAIL'}`

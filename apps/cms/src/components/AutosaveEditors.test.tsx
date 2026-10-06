import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { Post, Rocket } from '../lib/api/types'

// Exercise component callbacks and rerenders without adding a DOM dependency.
const harness = vi.hoisted(() => ({ cells: [] as unknown[], cursor: 0, effects: [] as (() => void)[], autosave: null as null | {
  key: string; dirty: boolean; enabled?: boolean; fingerprint?: string; save: () => Promise<void>
}, flush: vi.fn(), globalFlush: vi.fn() }))
vi.mock('react', async original => {
  const react = await original<typeof import('react')>()
  return { ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const index = harness.cursor++
      if (!(index in harness.cells)) harness.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial
      return [harness.cells[index], (value: T | ((previous: T) => T)) => {
        harness.cells[index] = typeof value === 'function' ? (value as (previous: T) => T)(harness.cells[index] as T) : value
      }]
    },
    useRef: <T,>(value: T) => {
      const index = harness.cursor++
      if (!(index in harness.cells)) harness.cells[index] = { current: value }
      return harness.cells[index]
    },
    useEffect: (effect: () => void, deps: unknown[]) => {
      const index = harness.cursor++
      const previous = harness.cells[index] as unknown[] | undefined
      if (!previous || deps.some((value, at) => !Object.is(value, previous[at]))) { harness.cells[index] = deps; harness.effects.push(effect) }
    },
    useCallback: <T,>(callback: T, deps: unknown[]) => {
      const index = harness.cursor++
      const previous = harness.cells[index] as { deps: unknown[]; callback: T } | undefined
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) harness.cells[index] = { callback, deps }
      return (harness.cells[index] as { callback: T }).callback
    },
  }
})
vi.mock('../lib/useAutosave', () => ({ useAutosave: (options: typeof harness.autosave) => {
  harness.autosave = options
  return { status: 'idle', error: '', flush: harness.flush }
} }))
vi.mock('../lib/cmsChanges', () => ({ flushCmsChanges: harness.globalFlush, noteCmsChange: vi.fn() }))
vi.mock('./MarkdownField', () => ({ default: () => null }))
vi.mock('./ImagePreview', () => ({ default: () => null }))
vi.mock('./Editor', () => ({ default: () => null }))
vi.mock('./PostAttachments', () => ({ default: () => null, koreaToday: () => '2026-10-03' }))
vi.mock('../lib/api/client', () => ({ api: { list: vi.fn(), save: vi.fn(), createPost: vi.fn(), createVehicle: vi.fn() } }))
vi.mock('../lib/api/resources', () => ({ resourcesApi: { list: vi.fn(), vehicleMedia: vi.fn(), saveVehicleMedia: vi.fn(), upload: vi.fn() } }))
import { api } from '../lib/api/client'
import { resourcesApi } from '../lib/api/resources'
import PostCreate from './PostCreate'
import VehicleCreate from './VehicleCreate'
import VehicleMediaEditor from './VehicleMediaEditor'
import AttachmentsEditor from './AttachmentsEditor'

function render(component: () => ReactNode) {
  harness.cursor = 0
  const tree = component()
  const effects = harness.effects.splice(0)
  effects.forEach(effect => effect())
  return tree
}
type Element = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
function input(tree: ReactNode, value: string) { return elements(tree).find(node => node.type === 'input' && node.props.value === value)! }
function change(node: Element, value: string) { (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }) }
function button(tree: ReactNode, text: string) { return elements(tree).find(node => node.type === 'button' && node.props.children === text)! }
function click(node: Element) { (node.props.onClick as () => void)() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function settle() { for (let index = 0; index < 8; index++) await Promise.resolve() }
const base = { version: 'v1', updatedAt: 'now', publishState: 'draft_saved' as const }
const post: Post = { ...base, id: 'post-1', title: '제목', bodyMd: '본문', authorLabel: '작성자', displayDate: '2026-10-03', attachments: [] }
const vehicle: Rocket = { ...base, id: 'raon', name: 'RAON', series: 'A', descriptionMd: '', maxAltitudeM: '', sizeM: '', payloadKg: '', published: false }

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  vi.clearAllMocks()
  harness.cells = []; harness.cursor = 0; harness.effects = []; harness.autosave = null
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  harness.flush.mockImplementation(async () => { if (harness.autosave?.dirty) { if (!harness.autosave.enabled) throw new Error('invalid'); await harness.autosave.save() } })
  harness.globalFlush.mockResolvedValue(undefined)
})

it('keeps an incomplete post locally and registers it as dirty but disabled until cancelled', () => {
  const view = () => PostCreate({ onCreated: vi.fn() })
  let tree = render(view)
  change(input(tree, ''), '작성 중')
  tree = render(view)
  expect(harness.autosave).toMatchObject({ dirty: true, enabled: false })
  expect(localStorage.getItem('icaros:post-create')).toContain('작성 중')
  click(button(tree, '입력 취소'))
  render(view)
  expect(harness.autosave?.dirty).toBe(false)
  expect(localStorage.getItem('icaros:post-create')).toBeNull()
})

it('creates once and saves edits made during the post request before handing off to the parent', async () => {
  const onCreated = vi.fn()
  const view = () => PostCreate({ onCreated })
  let tree = render(view)
  change(input(tree, ''), '제목')
  tree = render(view)
  const markdown = elements(tree).find(node => node.props.label === '본문 (Markdown)')!
  ;(markdown.props.onChange as (value: string) => void)('본문')
  render(view)
  const pending = deferred<Post>()
  vi.mocked(api.createPost).mockReturnValue(pending.promise)
  vi.mocked(api.save).mockResolvedValue({ ...post, title: '최신 제목', version: 'v2' })
  const first = harness.autosave!.save()
  tree = render(view)
  change(input(tree, '제목'), '최신 제목')
  render(view)
  const second = harness.autosave!.save()
  expect(api.createPost).toHaveBeenCalledTimes(1)
  pending.resolve(post)
  await Promise.all([first, second])
  expect(api.save).toHaveBeenCalledWith('posts', post.id, 'v1', expect.objectContaining({ title: '최신 제목' }))
  expect(onCreated).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: '최신 제목', version: 'v2' }))
  expect(localStorage.getItem('icaros:post-create')).toBeNull()
})

it('retries a failed post creation with its original key and payload after more edits', async () => {
  const view = () => PostCreate({ onCreated: vi.fn() })
  let tree = render(view)
  change(input(tree, ''), '제목')
  tree = render(view)
  ;(elements(tree).find(node => node.props.label === '본문 (Markdown)')!.props.onChange as (value: string) => void)('본문')
  render(view)
  vi.mocked(api.createPost).mockRejectedValueOnce(new Error('network')).mockResolvedValue(post)
  await expect(harness.autosave!.save()).rejects.toThrow('network')
  tree = render(view)
  change(input(tree, '제목'), '수정')
  render(view)
  vi.mocked(api.save).mockResolvedValue({ ...post, title: '수정', version: 'v2' })
  await harness.autosave!.save()
  expect(vi.mocked(api.createPost).mock.calls[1]).toEqual(vi.mocked(api.createPost).mock.calls[0])
})

it('freezes every vehicle field while creating and stores incomplete values locally', async () => {
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'vehicle-types' ? [{ ...base, id: 'rocket' }] : [{ ...base, id: 'A', typeId: 'rocket' }])
  const onCreated = vi.fn()
  const view = () => VehicleCreate({ onCreated, onCancel: vi.fn() })
  let tree = render(view)
  await settle()
  change(input(tree, ''), 'RAON')
  tree = render(view)
  expect(harness.autosave).toMatchObject({ dirty: true, enabled: false })
  expect(localStorage.getItem('icaros:vehicle-create')).toContain('RAON')
  change(elements(tree).find(node => node.type === 'input' && node.props.placeholder === 'raon-iii')!, 'raon')
  tree = render(view)
  change(elements(tree).filter(node => node.type === 'select')[0]!, 'rocket')
  tree = render(view)
  change(elements(tree).filter(node => node.type === 'select')[1]!, 'A')
  render(view)
  expect(harness.autosave?.enabled).toBe(true)
  const pending = deferred<Rocket>()
  vi.mocked(api.createVehicle).mockReturnValue(pending.promise)
  const saving = harness.autosave!.save()
  tree = render(view)
  expect(elements(tree).filter(node => node.type === 'input' || node.type === 'select' || node.props.label === '설명 (Markdown)').every(node => node.props.disabled)).toBe(true)
  pending.resolve(vehicle)
  await saving
  expect(onCreated).toHaveBeenCalledExactlyOnceWith(vehicle)
})

it('saves gallery then model in one slot and preserves media edits made during the request', async () => {
  vi.mocked(api.list).mockResolvedValue([vehicle])
  vi.mocked(resourcesApi.vehicleMedia).mockImplementation(async (_id, kind) => ({ id: 'raon', version: 'v1', ...(kind === 'gallery' ? { mediaIds: ['one', 'two'] } : { modelMediaId: 'model', posterMediaId: 'poster' }) }))
  let tree = render(VehicleMediaEditor)
  await settle(); tree = render(VehicleMediaEditor)
  await settle(); tree = render(VehicleMediaEditor)
  click(button(tree, '제거'))
  click(button(tree, '모델 연결 해제'))
  render(VehicleMediaEditor)
  const pending = deferred<Awaited<ReturnType<typeof resourcesApi.saveVehicleMedia>>>()
  vi.mocked(resourcesApi.saveVehicleMedia).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ id: 'raon', version: 'v2', modelMediaId: null, posterMediaId: 'poster' })
  const saving = harness.autosave!.save()
  expect(resourcesApi.saveVehicleMedia).toHaveBeenCalledTimes(1)
  tree = render(VehicleMediaEditor)
  click(button(tree, '제거'))
  render(VehicleMediaEditor)
  pending.resolve({ id: 'raon', version: 'v2', mediaIds: ['two'] })
  await saving
  tree = render(VehicleMediaEditor)
  expect(vi.mocked(resourcesApi.saveVehicleMedia).mock.calls.map(call => call[1])).toEqual(['gallery', 'model'])
  expect(harness.autosave?.dirty).toBe(true)
  expect(elements(tree).filter(node => node.props.alt?.toString().startsWith('기체 갤러리'))).toHaveLength(0)
})

it('preserves newer attachment edits and keeps selection when flushing fails', async () => {
  const other = { ...post, id: 'post-2', title: '두 번째' }
  vi.mocked(api.list).mockResolvedValue([post, other])
  let tree = render(AttachmentsEditor)
  await settle(); tree = render(AttachmentsEditor)
  const attachment = [{ mediaId: 'one', kind: 'pdf' as const, title: '보고서' }]
  ;(elements(tree).find(node => node.props.showInsert === false)!.props.onChange as (value: typeof attachment) => void)(attachment)
  render(AttachmentsEditor)
  const pending = deferred<Post>()
  vi.mocked(api.save).mockReturnValue(pending.promise)
  const saving = harness.autosave!.save()
  tree = render(AttachmentsEditor)
  ;(elements(tree).find(node => node.props.showInsert === false)!.props.onChange as (value: typeof attachment) => void)([{ ...attachment[0]!, title: '수정된 보고서' }])
  render(AttachmentsEditor)
  pending.resolve({ ...post, version: 'v2', attachments: attachment })
  await saving
  tree = render(AttachmentsEditor)
  expect(harness.autosave?.dirty).toBe(true)
  expect(elements(tree).find(node => node.props.showInsert === false)!.props.attachments).toEqual([{ ...attachment[0], title: '수정된 보고서' }])
  harness.flush.mockRejectedValueOnce(new Error('save failed'))
  const target = elements(tree).find(node => node.type === 'button' && elements(node.props.children as ReactNode).some(child => child.type === 'strong' && child.props.children === '두 번째'))!
  click(target)
  await settle(); render(AttachmentsEditor)
  expect(harness.autosave?.key).toBe('post-attachments:post-1')
})

it('keeps media save failures visible to the hook and does not start the model slot after gallery failure', async () => {
  vi.mocked(api.list).mockResolvedValue([vehicle])
  vi.mocked(resourcesApi.vehicleMedia).mockImplementation(async (_id, kind) => ({ id: 'raon', version: 'v1', ...(kind === 'gallery' ? { mediaIds: ['one'] } : { modelMediaId: 'model', posterMediaId: null }) }))
  render(VehicleMediaEditor)
  await settle(); render(VehicleMediaEditor)
  await settle(); const tree = render(VehicleMediaEditor)
  click(button(tree, '제거')); click(button(tree, '모델 연결 해제'))
  render(VehicleMediaEditor)
  vi.mocked(resourcesApi.saveVehicleMedia).mockRejectedValue(new Error('media conflict'))
  await expect(harness.autosave!.save()).rejects.toThrow('media conflict')
  expect(resourcesApi.saveVehicleMedia).toHaveBeenCalledTimes(1)
  render(VehicleMediaEditor)
  expect(harness.autosave?.dirty).toBe(true)
})

it('cancels an incomplete vehicle before notifying the parent, with no creation request', async () => {
  vi.mocked(resourcesApi.list).mockResolvedValue([])
  const onCancel = vi.fn()
  const view = () => VehicleCreate({ onCreated: vi.fn(), onCancel })
  let tree = render(view)
  await settle()
  change(input(tree, ''), '미완성')
  tree = render(view)
  expect(harness.autosave).toMatchObject({ dirty: true, enabled: false })
  click(button(tree, '취소'))
  expect(onCancel).not.toHaveBeenCalled()
  render(view)
  expect(harness.autosave?.dirty).toBe(false)
  expect(onCancel).toHaveBeenCalledOnce()
  expect(api.createVehicle).not.toHaveBeenCalled()
  expect(localStorage.getItem('icaros:vehicle-create')).toBeNull()
})

it('rethrows attachment save errors to prevent a successful flush', async () => {
  vi.mocked(api.list).mockResolvedValue([post])
  render(AttachmentsEditor)
  await settle(); const tree = render(AttachmentsEditor)
  ;(elements(tree).find(node => node.props.showInsert === false)!.props.onChange as (value: Post['attachments']) => void)([{ mediaId: 'one', kind: 'pdf', title: '보고서' }])
  render(AttachmentsEditor)
  vi.mocked(api.save).mockRejectedValue(new Error('attachment conflict'))
  await expect(harness.autosave!.save()).rejects.toThrow('attachment conflict')
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
const h = vi.hoisted(() => ({ cells: [] as unknown[], cursor: 0, effects: [] as (() => void)[], autosave: null as null | { key: string; dirty: boolean; enabled?: boolean; save: () => Promise<void> }, flush: vi.fn(), reset: vi.fn() }))
vi.mock('react', async original => {
  const r = await original<typeof import('react')>()
  return { ...r, useState: <T,>(initial: T | (() => T)) => {
    const i = h.cursor++; if (!(i in h.cells)) h.cells[i] = typeof initial === 'function' ? (initial as () => T)() : initial
    return [h.cells[i], (value: T | ((previous: T) => T)) => { h.cells[i] = typeof value === 'function' ? (value as (previous: T) => T)(h.cells[i] as T) : value }]
  }, useRef: <T,>(value: T) => { const i = h.cursor++; if (!(i in h.cells)) h.cells[i] = { current: value }; return h.cells[i] },
  useEffect: (effect: () => void, deps: unknown[]) => { const i = h.cursor++; const prev = h.cells[i] as unknown[] | undefined; if (!prev || deps.some((v, at) => !Object.is(v, prev[at]))) { h.cells[i] = deps; h.effects.push(effect) } },
  useCallback: <T,>(callback: T, deps: unknown[]) => { const i = h.cursor++; const prev = h.cells[i] as { deps: unknown[]; callback: T } | undefined; if (!prev || deps.some((v, at) => !Object.is(v, prev.deps[at]))) h.cells[i] = { deps, callback }; return (h.cells[i] as { callback: T }).callback }, }
})
vi.mock('../lib/useAutosave', () => ({ useAutosave: (options: typeof h.autosave) => { h.autosave = options; return { status: 'idle', error: '', flush: h.flush, reset: h.reset } } }))
vi.mock('../lib/api/resources', () => ({ resourcesApi: { list: vi.fn(), vehicleMedia: vi.fn(), saveVehicleMedia: vi.fn(), upload: vi.fn() } }))
vi.mock('../lib/api/client', () => ({ api: { list: vi.fn(), save: vi.fn(), createVehicle: vi.fn(), createPost: vi.fn() } }))
vi.mock('./MarkdownField', () => ({ default: () => null }))
vi.mock('./ImagePreview', () => ({ default: () => null }))
vi.mock('./Preview', () => ({ default: () => null }))
vi.mock('./VehicleClassification', () => ({ default: () => null }))
vi.mock('./VehicleSpecsEditor', () => ({ default: () => null }))
import Editor from './Editor'
import VehicleMediaEditor from './VehicleMediaEditor'
import VehicleCreate from './VehicleCreate'
import PostCreate from './PostCreate'
vi.mock('./PostAttachments', () => ({ koreaToday: () => '2026-10-13' }))
import { resourcesApi } from '../lib/api/resources'
import { api } from '../lib/api/client'
import type { SiteContent, Post } from '../lib/api/types'
function render(view: () => ReactNode) { h.cursor = 0; const tree = view(); h.effects.splice(0).forEach(e => e()); return tree }
type E = ReactElement<Record<string, unknown>>
function nodes(node: ReactNode): E[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<Record<string, unknown>>(node)) return []; return [node, ...nodes(node.props.children as ReactNode)] }
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => n.type === 'button' && n.props.children === label)! }
function click(node: E) { (node.props.onClick as () => void)() }
function change(tree: ReactNode, old: string, next: string) { const node = nodes(tree).find(n => n.type === 'input' && n.props.value === old)!; (node.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: next } }) }
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve() }
const base = { version: 'v1', updatedAt: 'now', publishState: 'draft_saved' as const }
const setting = { ...base, id: 'donation.current', value: '0' }
const vehicle = { ...base, id: 'raon', name: 'RAON', series: 'A', descriptionMd: '', maxAltitudeM: '', sizeM: '', payloadKg: '', published: false, specs: [] }
beforeEach(() => { vi.resetAllMocks(); h.cells = []; h.cursor = 0; h.effects = []; h.autosave = null; h.flush.mockResolvedValue(undefined); vi.mocked(api.list).mockResolvedValue([]) })
afterEach(() => vi.unstubAllGlobals())
it('lets a conflicting site editor read the latest value and explicitly reapply with its version', async () => {
  let current: SiteContent = setting
  const onSaved = vi.fn(saved => { current = saved })
  const view = () => Editor({ kind: 'site', record: current, onSaved })
  let tree = render(view)
  const field = nodes(tree).find(n => n.type === 'textarea')!
  ;(field.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'local' } }); render(view)
  vi.mocked(api.save).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  await expect(h.autosave!.save()).rejects.toThrow('conflict'); tree = render(view)
  expect(h.autosave!.enabled).toBe(false)
  vi.mocked(api.list).mockResolvedValue([{ ...setting, value: 'remote', version: 'v2' }])
  click(button(tree, '내 수정본 유지하며 최신본 확인')); await settle(); tree = render(view)
  expect(nodes(tree).find(n => n.type === 'textarea')!.props.value).toBe('local')
  expect(api.save).toHaveBeenCalledTimes(1)
  click(button(tree, '내 수정본 재적용')); render(view)
  vi.mocked(api.save).mockResolvedValue({ ...setting, value: 'local', version: 'v3' })
  await h.autosave!.save()
  expect(api.save).toHaveBeenLastCalledWith('site', setting.id, 'v2', { value: 'local' })
})
it('discards conflicting site input to the latest server value without another write', async () => {
  let current: SiteContent = setting
  const view = () => Editor({ kind: 'site', record: current, onSaved: saved => { current = saved } })
  let tree = render(view)
  ;(nodes(tree).find(n => n.type === 'textarea')!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'local' } }); render(view)
  vi.mocked(api.save).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  await expect(h.autosave!.save()).rejects.toThrow('conflict'); tree = render(view)
  vi.mocked(api.list).mockResolvedValue([{ ...setting, value: 'remote', version: 'v2' }])
  click(button(tree, '내 수정본 유지하며 최신본 확인')); await settle(); tree = render(view)
  click(button(tree, '수정본 폐기')); tree = render(view)
  expect(nodes(tree).find(n => n.type === 'textarea')!.props.value).toBe('remote')
  expect(h.autosave!.dirty).toBe(false)
  expect(api.save).toHaveBeenCalledTimes(1)
})
it('recovers a conflicted vehicle gallery without flushing its stale write first', async () => {
  vi.mocked(api.list).mockResolvedValue([vehicle])
  vi.mocked(resourcesApi.vehicleMedia).mockImplementation(async (_id, kind) => ({ id: 'raon', version: 'v1', ...(kind === 'gallery' ? { mediaIds: ['one'] } : { modelMediaId: null, posterMediaId: null }) }))
  render(VehicleMediaEditor); await settle(); render(VehicleMediaEditor); await settle(); let tree = render(VehicleMediaEditor)
  click(button(tree, '제거')); render(VehicleMediaEditor)
  vi.mocked(resourcesApi.saveVehicleMedia).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  await expect(h.autosave!.save()).rejects.toThrow('conflict'); tree = render(VehicleMediaEditor)
  vi.mocked(resourcesApi.vehicleMedia).mockImplementation(async (_id, kind) => ({ id: 'raon', version: 'v2', ...(kind === 'gallery' ? { mediaIds: ['remote'] } : { modelMediaId: null, posterMediaId: null }) }))
  h.flush.mockRejectedValue(new Error('stale flush'))
  click(button(tree, '내 수정본 유지하며 최신본 확인')); await settle(); tree = render(VehicleMediaEditor)
  expect(h.autosave!.enabled).toBe(false)
  expect(nodes(tree).some(n => n.props.alt === '기체 갤러리 이미지 1')).toBe(false)
  click(button(tree, '내 수정본 재적용')); render(VehicleMediaEditor)
  vi.mocked(resourcesApi.saveVehicleMedia).mockResolvedValue({ id: 'raon', version: 'v3', mediaIds: [] })
  await h.autosave!.save()
  expect(resourcesApi.saveVehicleMedia).toHaveBeenLastCalledWith('raon', 'gallery', 'v2', { mediaIds: [] })
})

it('recovers a vehicle create conflict with explicit latest read and versioned reapply', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'vehicle-types' ? [{ id: 'rocket', version: 'v1', name: '로켓' }] : [{ id: 'A', version: 'v1', typeId: 'rocket', name: 'A' }])
  const onCreated = vi.fn()
  const view = () => VehicleCreate({ onCreated, onCancel: vi.fn() })
  render(view); await settle(); let tree = render(view)
  change(tree, '', 'local vehicle'); tree = render(view)
  const address = nodes(tree).find(n => n.props.placeholder === 'raon-iii')!
  ;(address.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'raon' } }); tree = render(view)
  ;(nodes(tree).filter(n => n.type === 'select')[0]!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'rocket' } }); tree = render(view)
  ;(nodes(tree).filter(n => n.type === 'select')[1]!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'A' } }); render(view)
  vi.mocked(api.createVehicle).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  await expect(h.autosave!.save()).rejects.toThrow('conflict'); tree = render(view)
  vi.mocked(api.list).mockResolvedValue([{ ...vehicle, version: 'v2', name: 'remote' }])
  click(button(tree, '내 수정본 유지하며 최신본 확인')); await settle(); tree = render(view)
  expect(nodes(tree).some(n => n.type === 'input' && n.props.value === 'local vehicle')).toBe(true)
  click(button(tree, '내 수정본 재적용')); render(view)
  vi.mocked(api.save).mockResolvedValue({ ...vehicle, version: 'v3', name: 'local vehicle' })
  await h.autosave!.save()
  expect(api.createVehicle).toHaveBeenCalledTimes(1)
  expect(api.save).toHaveBeenLastCalledWith('rockets', 'raon', 'v2', expect.objectContaining({ name: 'local vehicle' }))
  expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'local vehicle' }))
})

it.each(['reapply', 'discard'] as const)('recovers a created post follow-up conflict through explicit %s', async mode => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  const post: Post = { ...base, id: 'post', title: 'first', bodyMd: 'body', displayDate: '2026-10-13', authorLabel: '작성자', attachments: [] }
  const onCreated = vi.fn()
  const view = () => PostCreate({ onCreated })
  let tree = render(view); change(tree, '', 'first'); tree = render(view)
  ;(nodes(tree).find(n => n.props.label === '본문 (Markdown)')!.props.onChange as (value: string) => void)('body'); render(view)
  let release!: (post: Post) => void
  vi.mocked(api.createPost).mockReturnValue(new Promise(done => { release = done }))
  vi.mocked(api.save).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  const saving = h.autosave!.save(); tree = render(view); change(tree, 'first', 'local title'); render(view)
  release(post); await expect(saving).rejects.toThrow('conflict'); tree = render(view)
  vi.mocked(api.list).mockResolvedValue([{ ...post, title: 'remote', version: 'v2' }])
  click(button(tree, '내 수정본 유지하며 최신본 확인')); await settle(); tree = render(view)
  expect(nodes(tree).some(n => n.type === 'input' && n.props.value === 'local title')).toBe(true)
  if (mode === 'reapply') {
    click(button(tree, '내 수정본 재적용')); render(view)
    vi.mocked(api.save).mockResolvedValue({ ...post, title: 'local title', version: 'v3' })
    await h.autosave!.save()
    expect(api.save).toHaveBeenLastCalledWith('posts', 'post', 'v2', expect.objectContaining({ title: 'local title' }))
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ title: 'local title' }))
  } else {
    click(button(tree, '수정본 폐기')); render(view)
    expect(h.autosave!.dirty).toBe(false)
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ title: 'remote' }))
  }
})

it('locks the nested editor when its parent is refreshing the vehicle baseline', () => {
  const tree = render(() => Editor({ kind: 'site', record: setting, onSaved: vi.fn(), disabled: true }))
  expect(nodes(tree).filter(n => n.type === 'input' || n.type === 'textarea').every(n => n.props.disabled)).toBe(true)
  expect(h.autosave!.enabled).toBe(false)
})

it('ignores an obsolete StrictMode vehicle list read after media editing starts', async () => {
  let release!: (rows: typeof vehicle[]) => void
  const oldRead = new Promise<typeof vehicle[]>(done => { release = done })
  let calls = 0
  vi.mocked(api.list).mockImplementation(async () => ++calls === 1 ? oldRead : [{ ...vehicle, name: 'latest' }])
  vi.mocked(resourcesApi.vehicleMedia).mockImplementation(async (_id, kind) => ({ id: 'raon', version: 'v2', ...(kind === 'gallery' ? { mediaIds: ['one'] } : { modelMediaId: null, posterMediaId: null }) }))
  h.cursor = 0; VehicleMediaEditor(); h.effects.splice(0).forEach(effect => { effect(); effect() })
  await settle(); render(VehicleMediaEditor); await settle(); let tree = render(VehicleMediaEditor)
  click(button(tree, '제거')); render(VehicleMediaEditor)
  release([vehicle]); await settle(); tree = render(VehicleMediaEditor)
  expect(h.autosave!.dirty).toBe(true)
  expect(nodes(tree).find(n => n.props.className === 'listItem')!.props.children).toEqual(expect.arrayContaining([expect.objectContaining({ props: expect.objectContaining({ children: 'latest' }) })]))
})

it('restores the latest rocket classification when discarding a conflicting draft', async () => {
  let current = vehicle
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'vehicle-types' ? [{ id: 'old', version: 'v1' }, { id: 'new', version: 'v1' }] : [{ id: 'A', version: 'v1', typeId: 'old' }, { id: 'B', version: 'v1', typeId: 'new' }])
  const view = () => Editor({ kind: 'rockets', record: current, onSaved: saved => { current = saved as typeof vehicle } })
  render(view); await settle(); let tree = render(view)
  ;(nodes(tree).find(n => n.props.onTypeChange)!.props.onTypeChange as (id: string) => void)('old'); tree = render(view)
  change(tree, 'RAON', 'local'); render(view)
  vi.mocked(api.save).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  await expect(h.autosave!.save()).rejects.toThrow('conflict'); tree = render(view)
  vi.mocked(api.list).mockResolvedValue([{ ...vehicle, name: 'remote', series: 'B', version: 'v2' }])
  click(button(tree, '내 수정본 유지하며 최신본 확인')); await settle(); tree = render(view)
  click(button(tree, '수정본 폐기')); tree = render(view)
  expect(nodes(tree).find(n => n.props.onTypeChange)!.props.typeId).toBe('new')
  expect(h.autosave!.dirty).toBe(false)
})

it('retires the post autosave queue before handing a cancelled server draft to its parent', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
  const post: Post = { ...base, id: 'post', title: 'first', bodyMd: 'body', displayDate: '2026-10-13', authorLabel: '작성자', attachments: [] }
  const onCreated = vi.fn(() => { expect(h.reset).toHaveBeenCalled() })
  const view = () => PostCreate({ onCreated })
  let tree = render(view); change(tree, '', 'first'); tree = render(view)
  ;(nodes(tree).find(n => n.props.label === '본문 (Markdown)')!.props.onChange as (value: string) => void)('body'); render(view)
  let release!: (post: Post) => void
  vi.mocked(api.createPost).mockReturnValue(new Promise(done => { release = done }))
  vi.mocked(api.save).mockRejectedValueOnce(new Error('network'))
  const saving = h.autosave!.save(); tree = render(view); change(tree, 'first', 'new title'); render(view)
  release(post); await expect(saving).rejects.toThrow('network'); tree = render(view)
  click(button(tree, '입력 취소')); render(view)
  expect(onCreated).toHaveBeenCalledWith(post)
  expect(h.autosave!.dirty).toBe(false)
})

it('upserts a recovered vehicle ID in the parent list and edits its latest saved version', async () => {
  vi.mocked(api.list).mockResolvedValue([vehicle])
  vi.mocked(resourcesApi.vehicleMedia).mockImplementation(async (_id, kind) => ({ id: 'raon', version: 'v1', ...(kind === 'gallery' ? { mediaIds: [] } : { modelMediaId: null, posterMediaId: null }) }))
  render(VehicleMediaEditor); await settle(); render(VehicleMediaEditor); await settle(); let tree = render(VehicleMediaEditor)
  click(button(tree, '새 기체 추가')); await settle(); tree = render(VehicleMediaEditor)
  const form = nodes(tree).find(n => n.type === VehicleCreate)!
  ;(form.props.onCreated as (saved: typeof vehicle) => void)({ ...vehicle, name: 'recovered', version: 'v3' }); tree = render(VehicleMediaEditor)
  expect(nodes(tree).filter(n => n.props.className === 'listItem')).toHaveLength(1)
  expect(nodes(tree).find(n => n.type === Editor)!.props.record).toMatchObject({ name: 'recovered', version: 'v3' })
})

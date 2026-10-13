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
vi.mock('../lib/api/resources', () => ({ resourcesApi: { list: vi.fn(), newId: () => 'client-id', create: vi.fn(), update: vi.fn(), reorder: vi.fn() } }))
vi.mock('../lib/api/client', () => ({ api: { list: vi.fn() } }))
vi.mock('./MarkdownField', () => ({ default: () => null }))
vi.mock('./ImagePreview', () => ({ default: () => null }))
import ResourceEditor from './ResourceEditor'
import MissionsEditor from './MissionsEditor'
import { resourcesApi } from '../lib/api/resources'
import { api } from '../lib/api/client'
import type { ResourceRecord } from '../lib/resources'
function render(view: () => ReactNode) { h.cursor = 0; const tree = view(); h.effects.splice(0).forEach(e => e()); return tree }
type E = ReactElement<Record<string, unknown>>
function nodes(node: ReactNode): E[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement<Record<string, unknown>>(node)) return []; return [node, ...nodes(node.props.children as ReactNode)] }
function button(tree: ReactNode, label: string) { return nodes(tree).find(n => n.type === 'button' && n.props.children === label)! }
function click(node: E) { (node.props.onClick as () => void)() }
function change(tree: ReactNode, old: string, next: string) { const node = nodes(tree).find(n => n.type === 'input' && n.props.value === old)!; (node.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: next } }) }
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve() }
const department = { id: 'one', version: 'v1', name: 'old', position: 0 }
const mission = { id: 'one', version: 'v1', title: 'old', location: '제주', launchDate: '2026-10-13', outcome: 'planned' as const }
beforeEach(() => { vi.resetAllMocks(); h.cells = []; h.cursor = 0; h.effects = []; h.autosave = null; h.flush.mockResolvedValue(undefined); vi.mocked(api.list).mockResolvedValue([]) })
afterEach(() => vi.unstubAllGlobals())
it.each(['departments', 'missions'] as const)('refreshes %s selection and draft together without making a write dirty', async kind => {
  const row = kind === 'departments' ? department : mission
  vi.mocked(resourcesApi.list).mockImplementation(async k => k === kind ? [row] : [])
  const view = () => kind === 'departments' ? ResourceEditor({ kind }) : MissionsEditor()
  render(view); await settle(); let tree = render(view)
  const select = nodes(tree).find(n => n.type === 'button' && n.props.className === 'listItem')!
  click(select); await settle(); tree = render(view)
  vi.mocked(resourcesApi.list).mockImplementation(async k => k === kind ? [{ ...row, version: 'v2', ...(kind === 'departments' ? { name: 'new' } : { title: 'new' }) }] : [])
  click(button(tree, '새로고침')); await settle(); tree = render(view)
  expect(nodes(tree).some(n => n.type === 'input' && n.props.value === 'new')).toBe(true)
  expect(h.autosave?.dirty).toBe(false)
})
it.each(['departments', 'missions'] as const)('keeps one %s create identity while accepting edits during its response', async kind => {
  vi.mocked(resourcesApi.list).mockResolvedValue([])
  const view = () => kind === 'departments' ? ResourceEditor({ kind }) : MissionsEditor()
  render(view); await settle(); let tree = render(view)
  change(tree, '', 'first'); tree = render(view)
  if (kind === 'missions') { change(tree, '', '2026-10-13'); tree = render(view); change(tree, '', '제주'); render(view) }
  let resolve!: (row: ResourceRecord) => void
  vi.mocked(resourcesApi.create).mockReturnValue(new Promise(done => { resolve = done }))
  vi.mocked(resourcesApi.update).mockResolvedValue({ ...(kind === 'departments' ? department : mission), version: 'v2', name: 'second', title: 'second' })
  const key = h.autosave!.key
  const saving = h.autosave!.save()
  tree = render(view); change(tree, 'first', 'second'); render(view)
  resolve({ ...(kind === 'departments' ? department : mission), name: 'first', title: 'first' })
  await saving; render(view)
  expect(h.autosave!.key).toBe(key)
  await h.autosave!.save()
  expect(resourcesApi.create).toHaveBeenCalledTimes(1)
  expect(resourcesApi.update).toHaveBeenCalledWith(kind, 'one', 'v1', expect.objectContaining(kind === 'departments' ? { name: 'second' } : { title: 'second' }))
})
it('sends the entire department order for equal positions in one request', async () => {
  const other = { ...department, id: 'two', name: 'two' }
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'departments' ? [department, other] : [])
  const view = () => ResourceEditor({ kind: 'departments' })
  render(view); await settle(); let tree = render(view)
  click(button(tree, 'old')); await settle(); tree = render(view)
  vi.mocked(resourcesApi.reorder).mockResolvedValue([{ ...other, version: 'v2', position: 0 }, { ...department, version: 'v2', position: 1 }])
  expect(button(tree, '아래로')).toBeDefined()
  click(button(tree, '아래로')); await settle(); tree = render(view)
  expect(resourcesApi.reorder).toHaveBeenCalledWith('departments', [{ id: 'two', version: 'v1' }, { id: 'one', version: 'v1' }])
  expect(resourcesApi.update).not.toHaveBeenCalled()
  expect(nodes(tree).filter(n => n.props.className === 'listItem').map(n => n.props.children)).toEqual(['two', 'old'])
  expect(h.autosave?.dirty).toBe(false)
})

it('preserves changes after a lost create response and retries its frozen payload', async () => {
  vi.mocked(resourcesApi.list).mockResolvedValue([])
  const view = () => ResourceEditor({ kind: 'departments' })
  render(view); await settle(); let tree = render(view)
  change(tree, '', 'original'); render(view)
  vi.mocked(resourcesApi.create).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ...department, name: 'original' })
  await expect(h.autosave!.save()).rejects.toThrow('network')
  tree = render(view); change(tree, 'original', 'latest'); render(view)
  vi.mocked(resourcesApi.update).mockResolvedValue({ ...department, name: 'latest', version: 'v2' })
  await h.autosave!.save(); tree = render(view)
  expect(resourcesApi.update).toHaveBeenCalledWith('departments', 'one', 'v1', expect.objectContaining({ name: 'latest' }))
  expect(vi.mocked(resourcesApi.create).mock.calls[1]).toEqual(vi.mocked(resourcesApi.create).mock.calls[0])
  expect(nodes(tree).some(n => n.type === 'input' && n.props.value === 'latest')).toBe(true)
  expect(h.autosave!.dirty).toBe(false)
})
it('reads latest content after a conflict and only overwrites it after explicit reapply', async () => {
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'departments' ? [department] : [])
  const view = () => ResourceEditor({ kind: 'departments' })
  render(view); await settle(); let tree = render(view)
  click(button(tree, 'old')); await settle(); tree = render(view)
  change(tree, 'old', 'local'); render(view)
  vi.mocked(resourcesApi.update).mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
  await expect(h.autosave!.save()).rejects.toThrow('conflict'); tree = render(view)
  h.flush.mockRejectedValue(new Error('stale flush'))
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'departments' ? [{ ...department, name: 'remote', version: 'v2' }] : [])
  click(button(tree, '내 수정본 유지하며 최신본 확인')); await settle(); tree = render(view)
  expect(nodes(tree).some(n => n.type === 'input' && n.props.value === 'local')).toBe(true)
  expect(h.autosave!.enabled).toBe(false)
  expect(resourcesApi.update).toHaveBeenCalledTimes(1)
  click(button(tree, '내 수정본 재적용')); tree = render(view)
  vi.mocked(resourcesApi.update).mockResolvedValue({ ...department, name: 'local', version: 'v3' })
  await h.autosave!.save()
  expect(resourcesApi.update).toHaveBeenLastCalledWith('departments', 'one', 'v2', expect.objectContaining({ name: 'local' }))
})

it('retains a recovered create record when saving later edits fails', async () => {
  vi.mocked(resourcesApi.list).mockResolvedValue([])
  const view = () => ResourceEditor({ kind: 'departments' })
  render(view); await settle(); let tree = render(view)
  change(tree, '', 'original'); render(view)
  vi.mocked(resourcesApi.create).mockRejectedValueOnce(new Error('lost response')).mockResolvedValue({ ...department, name: 'original' })
  await expect(h.autosave!.save()).rejects.toThrow('lost response')
  tree = render(view); change(tree, 'original', 'latest'); render(view)
  vi.mocked(resourcesApi.update).mockRejectedValueOnce(new Error('update failed')).mockResolvedValueOnce({ ...department, name: 'latest', version: 'v2' })
  await expect(h.autosave!.save()).rejects.toThrow('update failed'); render(view)
  await h.autosave!.save(); render(view)
  expect(resourcesApi.create).toHaveBeenCalledTimes(2)
  expect(resourcesApi.update).toHaveBeenCalledTimes(2)
})

it('clears a removed selection on read without recreating the old item', async () => {
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'departments' ? [department] : [])
  const view = () => ResourceEditor({ kind: 'departments' })
  render(view); await settle(); let tree = render(view)
  click(button(tree, 'old')); await settle(); tree = render(view)
  vi.mocked(resourcesApi.list).mockResolvedValue([])
  click(button(tree, '새로고침')); await settle(); tree = render(view)
  expect(nodes(tree).some(n => n.type === 'input' && n.props.value === 'old')).toBe(false)
  expect(h.autosave?.dirty).toBe(false)
  expect(resourcesApi.create).not.toHaveBeenCalled()
})

it('starts a fresh create attempt after a previously created selection is removed on the server', async () => {
  vi.mocked(resourcesApi.list).mockResolvedValue([])
  const view = () => ResourceEditor({ kind: 'departments' })
  render(view); await settle(); let tree = render(view)
  change(tree, '', 'first'); render(view)
  vi.mocked(resourcesApi.create).mockResolvedValueOnce({ ...department, name: 'first' }).mockResolvedValueOnce({ ...department, id: 'new', name: 'new name' })
  await h.autosave!.save(); tree = render(view)
  click(button(tree, '새로고침')); await settle(); tree = render(view)
  change(tree, '', 'new name'); render(view)
  vi.mocked(resourcesApi.update).mockResolvedValue({ ...department, id: 'new', name: 'new name', version: 'v2' })
  await h.autosave!.save()
  expect(resourcesApi.create).toHaveBeenLastCalledWith('departments', { name: 'new name' }, 'client-id')
})

it.each(['departments', 'missions'] as const)('locks editable controls and selection during delayed %s refresh', async kind => {
  const row = kind === 'departments' ? department : mission
  vi.mocked(resourcesApi.list).mockImplementation(async k => k === kind ? [row] : [])
  const view = () => kind === 'departments' ? ResourceEditor({ kind }) : MissionsEditor()
  render(view); await settle(); let tree = render(view)
  click(nodes(tree).find(n => n.props.className === 'listItem')!); await settle(); tree = render(view)
  let resolve!: (rows: ResourceRecord[]) => void
  const delayed = new Promise<ResourceRecord[]>(done => { resolve = done })
  vi.mocked(resourcesApi.list).mockImplementation(async k => k === kind ? delayed : [])
  click(button(tree, '새로고침')); await settle(); tree = render(view)
  const editable = nodes(tree).filter(n => ['input', 'select', 'textarea'].includes(String(n.type)) && !n.props.readOnly)
  expect(editable.length).toBeGreaterThan(0)
  expect(editable.every(n => n.props.disabled)).toBe(true)
  expect(button(tree, '새로고침').props.disabled).toBe(true)
  expect(button(tree, kind === 'departments' ? '새 항목' : '새 미션').props.disabled).toBe(true)
  expect(nodes(tree).filter(n => n.props.className === 'listItem').every(n => n.props.disabled)).toBe(true)
  expect(h.autosave!.enabled).toBe(false)
  resolve([{ ...row, version: 'v2', ...(kind === 'departments' ? { name: 'latest' } : { title: 'latest' }) }]); await settle(); tree = render(view)
  expect(nodes(tree).find(n => n.type === 'input' && n.props.value === 'latest')!.props.disabled).toBe(false)
  expect(h.autosave!.dirty).toBe(false)
  expect(resourcesApi.update).not.toHaveBeenCalled()
})

it('ignores an earlier StrictMode initial read that finishes after a later read and edit', async () => {
  let resolve!: (rows: ResourceRecord[]) => void
  const first = new Promise<ResourceRecord[]>(done => { resolve = done })
  let calls = 0
  vi.mocked(resourcesApi.list).mockImplementation(async kind => kind === 'departments' ? ++calls === 1 ? first : [{ ...department, name: 'latest', version: 'v2' }] : [])
  const view = () => ResourceEditor({ kind: 'departments' })
  h.cursor = 0; view(); h.effects.splice(0).forEach(effect => { effect(); effect() })
  await settle(); let tree = render(view)
  click(button(tree, 'latest')); await settle(); tree = render(view)
  change(tree, 'latest', 'local edit'); render(view)
  resolve([department]); await settle(); tree = render(view)
  expect(nodes(tree).some(n => n.type === 'input' && n.props.value === 'local edit')).toBe(true)
  expect(h.autosave!.dirty).toBe(true)
})

it('routes only member biography Markdown uploads through member privacy intent', async () => {
  vi.mocked(resourcesApi.list).mockResolvedValue([])
  const view = () => ResourceEditor({ kind: 'members' })
  render(view); await settle(); const tree = render(view)
  expect(nodes(tree).find(n => typeof n.type === 'function' && n.props.label)?.props.uploadIntent).toBe('member')
})

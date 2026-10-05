import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ResourceEditor from './ResourceEditor'
import { useAutosave } from '../lib/useAutosave'
import { resourcesApi } from '../lib/api/resources'
import { fields, resourceTabs } from '../lib/resources'

const state = vi.hoisted(() => ({ index: 0, overrides: new Map<number, unknown>(), draftSetter: vi.fn() }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: (initial: unknown) => {
    const result = actual.useState(initial)
    const index = state.index++
    return state.overrides.has(index) ? [state.overrides.get(index), index === 2 ? state.draftSetter : vi.fn()] : result
  } }
})
vi.mock('../lib/useAutosave', () => ({ useAutosave: vi.fn(() => ({ status: 'idle', error: '', flush: vi.fn(async () => {}) })) }))
vi.mock('../lib/api/resources', () => ({ resourcesApi: { list: vi.fn(), update: vi.fn(), create: vi.fn() } }))
beforeEach(() => { state.index = 0; state.overrides.clear(); state.draftSetter.mockClear(); vi.clearAllMocks() })


describe('ResourceEditor read-only mode', () => {
  beforeEach(() => vi.stubEnv('VITE_ICAROS_DEMO', '1'))
  afterEach(() => vi.unstubAllEnvs())
  it.each(resourceTabs)('disables every editing control for $id', ({ id }) => {
    const html = renderToStaticMarkup(<ResourceEditor kind={id} />)
    expect(html).toContain('로컬 DB 미리보기는 읽기 전용입니다')
    if (id !== 'donation-rounds') expect(html).toContain('새 항목</button>')
    if (id !== 'donation-rounds') expect(html).toContain('항목 생성</button>')
    const controls = [...html.matchAll(/<(input|select|button)\b[^>]*>/g)].map(match => match[0])
    expect(controls.filter(control => !control.includes('disabled'))).toEqual([
      '<button type="button">',
      ...(['vehicles', 'panels', 'post-attachments'].includes(id) ? ['<input readOnly="" value=""/>'] : []),
    ])
  })

  it('represents the donation round as a free-text label', () => {
    expect(fields['donation-rounds']).toContain('roundLabel')
    const html = renderToStaticMarkup(<ResourceEditor kind="donation-rounds" />)
    expect(html).toContain('후원 차수<input disabled="" type="text"')
  })

  it('shows the Markdown toolbar for descriptive resources', () => {
    const html = renderToStaticMarkup(<ResourceEditor kind="members" />)
    expect(html).toContain('aria-label="설명 (Markdown) 서식 도구"')
  })
  it('shows panel CTA label and internal destination controls', () => {
    const html = renderToStaticMarkup(<ResourceEditor kind="panels" />)
    expect(html).toContain('이동 버튼 문구')
    expect(html).toContain('이동할 페이지 링크')
    expect(html).toContain('value="/missions"')
  })
})

describe('ResourceEditor API-backed mode', () => {
  it('offers an image-only profile upload and removal for members', () => {
    vi.stubEnv('VITE_ICAROS_DEMO', '0')
    try {
      const html = renderToStaticMarkup(<ResourceEditor kind="members" />)
      expect(html).toContain('aria-label="프로필 사진 업로드"')
      expect(html).toContain('accept="image/jpeg,image/png,image/webp"')
      expect(html).toContain('프로필 사진 제거')
      expect(html).toContain('공개<input type="checkbox"')
    } finally { vi.unstubAllEnvs() }
  })
  it('enables supported content forms outside the local demo', () => {
    vi.stubEnv('VITE_ICAROS_DEMO', '0')
    try {
      const html = renderToStaticMarkup(<ResourceEditor kind="departments" />)
      expect(html).toContain('<h3>새 항목</h3>')
      expect(html).toContain('항목 생성</button>')
      expect(html).not.toContain('로컬 DB 미리보기는 읽기 전용입니다')
    } finally { vi.unstubAllEnvs() }
  })
})


describe('ResourceEditor autosave', () => {
  beforeEach(() => vi.stubEnv('VITE_ICAROS_DEMO', '0'))
  afterEach(() => vi.unstubAllEnvs())
  it('autosaves profile removal without losing other member fields', async () => {
    const active = { id: 'member', version: 'v1', name: '부원', imageMediaId: 'old-photo', published: true }
    state.overrides.set(0, [active])
    state.overrides.set(1, active.id)
    state.overrides.set(2, { ...active, imageMediaId: null })
    vi.mocked(resourcesApi.update).mockResolvedValue({ ...active, version: 'v2', imageMediaId: null })
    renderToStaticMarkup(<ResourceEditor kind="members" />)
    const autosave = vi.mocked(useAutosave).mock.calls.at(-1)![0]
    expect(autosave).toMatchObject({ enabled: true, dirty: true })
    await autosave.save()
    expect(resourcesApi.update).toHaveBeenCalledWith('members', 'member', 'v1', { name: '부원', imageMediaId: null, published: true })
  })
  function setup(draft: Record<string, unknown>, active?: { id: string; version: string; name: string }) {
    state.overrides.set(0, active ? [active] : [])
    state.overrides.set(1, active?.id ?? null)
    state.overrides.set(2, draft)
    const html = renderToStaticMarkup(<ResourceEditor kind="departments" />)
    return { html, autosave: vi.mocked(useAutosave).mock.calls.at(-1)![0] }
  }
  it('registers incomplete new drafts without attempting creation', () => {
    const { autosave, html } = setup({ name: '', position: 1 })
    expect(autosave).toMatchObject({ key: 'departments:new', dirty: true, enabled: false })
    expect(html).toContain('항목 생성')
    expect(html).not.toContain('초안 저장')
    expect(html).not.toContain('사이트 전체 게시</button>')
  })
  it('autosaves valid creation and preserves edits made during the request', async () => {
    const draft = { name: '추진공학부', position: 1 }
    const result = { ...draft, id: 'new-id', version: 'v1' }
    vi.mocked(resourcesApi.create).mockResolvedValue(result)
    const { autosave } = setup(draft)
    expect(autosave).toMatchObject({ key: 'departments:new', enabled: true, fingerprint: JSON.stringify(draft) })
    await autosave.save()
    expect(resourcesApi.create).toHaveBeenCalledWith('departments', draft)
    const apply = state.draftSetter.mock.calls[0]![0] as (previous: typeof draft) => unknown
    expect(apply(draft)).toEqual(result)
    const newer = { ...draft, name: '전자부' }
    expect(apply(newer)).toBe(newer)
  })
  it('propagates save failures to the hook without replacing the draft', async () => {
    const cause = new Error('CONFLICT')
    vi.mocked(resourcesApi.update).mockRejectedValue(cause)
    const active = { id: 'department', version: 'v1', name: '이전 이름' }
    const { autosave } = setup({ ...active, name: '새 이름' }, active)
    await expect(autosave.save()).rejects.toBe(cause)
    expect(state.draftSetter).not.toHaveBeenCalled()
  })
  it('uses the saved version for another request before the next render', async () => {
    const active = { id: 'department', version: 'v1', name: '이전 이름' }
    vi.mocked(resourcesApi.update).mockResolvedValue({ ...active, name: '새 이름', version: 'v2' })
    const { autosave } = setup({ ...active, name: '새 이름' }, active)
    await autosave.save()
    await autosave.save()
    expect(resourcesApi.update).toHaveBeenNthCalledWith(2, 'departments', active.id, 'v2', { name: '새 이름' })
  })
})

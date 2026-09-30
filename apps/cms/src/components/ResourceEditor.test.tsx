import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ResourceEditor from './ResourceEditor'
import { fields, resourceTabs } from '../lib/resources'

vi.mock('../lib/api/resources', () => ({ resourcesApi: { list: vi.fn() } }))

describe('ResourceEditor read-only mode', () => {
  beforeEach(() => vi.stubEnv('VITE_ICAROS_DEMO', '1'))
  afterEach(() => vi.unstubAllEnvs())
  it.each(resourceTabs)('disables every editing control for $id', ({ id }) => {
    const html = renderToStaticMarkup(<ResourceEditor kind={id} />)
    expect(html).toContain('로컬 DB 미리보기는 읽기 전용입니다')
    if (id !== 'donation-rounds') expect(html).toContain('새 항목</button>')
    expect(html).toContain('초안 저장</button>')
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
})

describe('ResourceEditor API-backed mode', () => {
  it('enables supported content forms outside the local demo', () => {
    vi.stubEnv('VITE_ICAROS_DEMO', '0')
    try {
      const html = renderToStaticMarkup(<ResourceEditor kind="departments" />)
      expect(html).toContain('<h3>새 항목</h3>')
      expect(html).toContain('초안 저장</button>')
      expect(html).not.toContain('로컬 DB 미리보기는 읽기 전용입니다')
    } finally { vi.unstubAllEnvs() }
  })
})

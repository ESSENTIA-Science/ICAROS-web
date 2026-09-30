import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostCreate from './PostCreate'

afterEach(() => vi.unstubAllEnvs())

it('shows title and Markdown body inputs and a draft creation action', () => {
  const html = renderToStaticMarkup(<PostCreate onCreated={() => {}} />)
  expect(html).toContain('제목')
  expect(html).toContain('본문 (Markdown)')
  expect(html).toContain('표시 날짜')
  expect(html).toContain('이미지·PDF·MP4 첨부')
  expect(html).toContain('초안 생성')
  expect(html).not.toMatch(/<label>작성자 표시/)
})

it('disables draft creation in demo mode', () => {
  vi.stubEnv('VITE_ICAROS_DEMO', '1')
  const html = renderToStaticMarkup(<PostCreate onCreated={() => {}} />)
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>초안 생성<\/button>/)
})

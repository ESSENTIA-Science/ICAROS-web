import { afterEach, expect, it, vi } from 'vitest'
import * as media from './bodyMedia'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import PostMarkdown from '../../../web/src/components/posts/PostMarkdown'
import MarkdownField from './MarkdownField'

const id = '11111111-1111-4111-8111-111111111111'
afterEach(() => vi.unstubAllGlobals())

it('inserts a confirmed PDF at the selection and preserves surrounding text', () => {
  const result = media.insertBodyMediaMarkdown('앞 삭제 뒤', 2, 4, id, '보고서.pdf', 'pdf')
  expect(result.value).toBe('앞 \n\n[보고서](/api/media/11111111-1111-4111-8111-111111111111 "icaros:pdf")\n\n 뒤')
  expect(result.start).toBe(result.value.indexOf(' 뒤'))
  expect(result.end).toBe(result.start)
})

it('escapes filenames so an upload cannot inject Markdown or HTML', () => {
  const result = media.insertBodyMediaMarkdown('', 0, 0, id, '[자료] <img>\n.mp4', 'video')
  const html = renderToStaticMarkup(createElement(PostMarkdown, { content: result.value.replace(`/api/media/${id}`, '/assets/launch.mp4') }))
  expect(html.match(/<video\b/g)).toHaveLength(1)
  expect(html).not.toContain('<img')
  expect(html).toContain('[자료] &lt;img&gt;')
})

it.each([
  [{ type: 'application/pdf', name: 'report.pdf', size: 8 * 1024 * 1024 }, 'pdf'],
  [{ type: 'video/mp4', name: 'launch.MP4', size: 32 * 1024 * 1024 }, 'video'],
  [{ type: 'image/jpeg', name: 'photo.jpg', size: 100 }, 'image'],
] as const)('accepts a supported file within its upload limit', (file, kind) => {
  expect(media.bodyMediaFileKind(file)).toBe(kind)
})

it.each([
  { type: 'application/pdf', name: 'report.pdf', size: 8 * 1024 * 1024 + 1 },
  { type: 'video/mp4', name: 'launch.mp4', size: 32 * 1024 * 1024 + 1 },
  { type: 'text/html', name: 'report.pdf', size: 100 },
  { type: 'application/pdf', name: 'report.html', size: 100 },
  { type: 'video/mp4', name: 'launch.mp4', size: 0 },
])('rejects empty, oversized or mismatched files before upload', file => {
  expect(() => media.bodyMediaFileKind(file)).toThrow()
})

it('fetches a saved private PDF preview using the authenticated short-lived URL contract', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { url: 'https://media.example.org/report.pdf?signature=short-lived', mime: 'application/pdf' } }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  const source = await media.fetchBodyMediaUrl(`/api/media/${id}`, 'pdf')
  expect(source).toBe('https://media.example.org/report.pdf?signature=short-lived')
  expect(fetch).toHaveBeenCalledWith(`/api/admin/media/${id}/url`, expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }))
})

it('reissues an expired video URL with a fresh request', async () => {
  let count = 0
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, data: { url: `https://media.example.org/launch.mp4?signature=${++count}`, mime: 'video/mp4' } })))
  expect(await media.fetchBodyMediaUrl(`/api/media/${id}`, 'video')).toBe('https://media.example.org/launch.mp4?signature=1')
  expect(await media.fetchBodyMediaUrl(`/api/media/${id}`, 'video')).toBe('https://media.example.org/launch.mp4?signature=2')
})

it.each([403, 404])('uses a fixed preview error for HTTP %s, without leaking a response body', async status => {
  vi.stubGlobal('fetch', async () => new Response('sensitive server details', { status }))
  await expect(media.fetchBodyMediaUrl(`/api/media/${id}`, 'pdf')).rejects.toThrow('파일 미리보기를 불러오지 못했습니다. 다시 시도해 주세요.')
})

it('shows the confirmed upload immediately using a trusted object URL, including after an editor remount', () => {
  const file = new File(['%PDF-1.7'], '보고서.pdf', { type: 'application/pdf' })
  media.rememberBodyMediaPreview(id, file, 'pdf')
  const value = '[보고서](/api/media/11111111-1111-4111-8111-111111111111 "icaros:pdf")'
  const html = renderToStaticMarkup(createElement(MarkdownField, { label: '본문', value, onChange: () => {} }))
  expect(html).toContain('<iframe')
  expect(html).toContain('src="blob:')
  expect(html).not.toContain('src="/api/media/')
  expect(html).toContain('미리보기 새로고침')
  expect(media.bodyMediaPreview(`/api/media/${id}`, 'video')).toBeNull()
})

it('uses the authenticated preview flow for a saved private video instead of a nonexistent public API URL', () => {
  const html = renderToStaticMarkup(createElement(MarkdownField, { label: '본문', value: '[영상](/api/media/22222222-2222-4222-8222-222222222222 "icaros:video")', onChange: () => {} }))
  expect(html).toContain('파일 미리보기 불러오는 중…')
  expect(html).toContain('미리보기 새로고침')
  expect(html).not.toContain('src="/api/media/')
})

it('supports the local MinIO signed URL, but rejects other plaintext origins', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { url: 'http://127.0.0.1:9010/media/report.pdf?signature=test', mime: 'application/pdf' } })))
  expect(await media.fetchBodyMediaUrl(`/api/media/${id}`, 'pdf')).toBe('http://127.0.0.1:9010/media/report.pdf?signature=test')
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { url: 'http://example.org/report.pdf', mime: 'application/pdf' } })))
  await expect(media.fetchBodyMediaUrl(`/api/media/${id}`, 'pdf')).rejects.toThrow(media.bodyMediaPreviewError)
})

it.each([
  { url: 'javascript:alert(1)', mime: 'application/pdf' },
  { url: 'https://user:secret@media.example.org/report.pdf', mime: 'application/pdf' },
  { url: 'https://media.example.org/report.pdf', mime: 'text/html' },
  { url: 'https://media.example.org/report.pdf', mime: 'video/mp4' },
])('rejects untrusted preview URL schemes and mismatched MIME', async data => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, data })))
  await expect(media.fetchBodyMediaUrl(`/api/media/${id}`, 'pdf')).rejects.toThrow('파일 미리보기를 불러오지 못했습니다. 다시 시도해 주세요.')
})

import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostAttachments, { imageMarkdown, koreaToday } from './PostAttachments'

it('uses the Korea calendar day at the UTC boundary', () => {
  expect(koreaToday(new Date('2026-09-29T16:00:00Z'))).toBe('2026-09-30')
})

it('inserts an image using its confirmed media id', () => {
  expect(imageMarkdown({ mediaId: 'media-1', kind: 'image', title: '발사 장면' })).toBe('![발사 장면](/api/media/media-1)')
})

it('shows attachment controls and disables them in demo mode', () => {
  const html = renderToStaticMarkup(<PostAttachments attachments={[{ mediaId: 'media-1', kind: 'pdf', title: '보고서' }]} onChange={() => {}} onInsert={() => {}} disabled />)
  expect(html).toContain('PDF 첨부됨')
  expect(html).toContain('보고서')
  expect(html).toMatch(/<input[^>]*type="file"[^>]*disabled=""/)
  expect(html).toContain('제거')
})

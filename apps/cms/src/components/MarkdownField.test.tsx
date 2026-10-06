import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownField, { formatMarkdown, insertImageMarkdown } from './MarkdownField'
import { insertTableMarkdown, insertGalleryMarkdown, readTableAt, readGalleryAt, parseSpreadsheetCells, readSelectedImages } from './markdownBlocks'

it('wraps a selected phrase without replacing surrounding text', () => {
  expect(formatMarkdown('앞 텍스트 뒤', 2, 5, 'bold')).toEqual({ value: '앞 **텍스트** 뒤', start: 4, end: 7 })
})

it('prefixes each selected line for a list', () => {
  expect(formatMarkdown('첫 줄\n둘째 줄', 0, 9, 'list').value).toBe('- 첫 줄\n- 둘째 줄')
})

it('renders a disabled toolbar for a read-only editor', () => {
  const html = renderToStaticMarkup(<MarkdownField label="본문 (Markdown)" value="" onChange={() => {}} disabled />)
  expect(html).toContain('aria-label="본문 (Markdown) 서식 도구"')
  expect(html).toMatch(/<button[^>]*disabled=""/)
  expect(html).toContain('aria-label="이미지 삽입"')
})

it('inserts an uploaded image at the saved cursor position', () => {
  expect(insertImageMarkdown('앞 뒤', 2, 2, 'media-id', '발사 사진.png')).toEqual({
    value: '앞 ![발사 사진](/api/media/media-id)뒤', start: 31, end: 31,
  })
})

it('turns spreadsheet cells into a GFM table without losing surrounding text', () => {
  expect(insertTableMarkdown('앞\n\n뒤', 3, 3, [['시각', '고도 (m)'], ['T+1', '120 | 추정']]).value)
    .toBe('앞\n\n| 시각 | 고도 (m) |\n| --- | --- |\n| T+1 | 120 \\| 추정 |\n\n뒤')
})

it('finds an existing table so its cells can be edited in place', () => {
  const markdown = '기록\n\n| 시각 | 고도 |\n| --- | --- |\n| T+1 | 120 |\n\n결론'
  expect(readTableAt(markdown, markdown.indexOf('T+1'))).toEqual({
    from: 4, to: markdown.indexOf('\n\n결론'), cells: [['시각', '고도'], ['T+1', '120']],
  })
})

it('preserves image order, alt text and captions in a gallery block', () => {
  const images = [
    { src: '/api/media/11111111-1111-4111-8111-111111111111', alt: '발사대', caption: '점화 직전' },
    { src: '/api/media/22222222-2222-4222-8222-222222222222', alt: '기체', caption: '' },
  ]
  const result = insertGalleryMarkdown('앞\n\n뒤', 3, 3, images, 2, 'center')
  expect(result.value).toBe('앞\n\n:::gallery{columns=2}\n\n![발사대](/api/media/11111111-1111-4111-8111-111111111111 "점화 직전")\n\n![기체](/api/media/22222222-2222-4222-8222-222222222222)\n\n:::\n\n뒤')
  expect(readGalleryAt(result.value, result.value.indexOf('기체]'))).toEqual({
    from: 3, to: result.value.indexOf('\n\n뒤'), columns: 2, align: 'center', images,
  })
})

it('accepts tabular data pasted from a spreadsheet', () => {
  expect(parseSpreadsheetCells('시각\t고도\nT+1\t120\nT+2\t230')).toEqual([
    ['시각', '고도'], ['T+1', '120'], ['T+2', '230'],
  ])
})

it('keeps uneven pasted rows editable as a rectangular table', () => {
  expect(parseSpreadsheetCells('시각\t고도\nT+1\t120\t메모')).toEqual([
    ['시각', '고도', ''], ['T+1', '120', '메모'],
  ])
})

it('can turn selected ordinary Markdown images into an editable gallery', () => {
  const value = '![발사](/api/media/11111111-1111-4111-8111-111111111111)\n\n![회수](/api/media/22222222-2222-4222-8222-222222222222)'
  expect(readSelectedImages(value, 0, value.length)).toEqual([
    { src: '/api/media/11111111-1111-4111-8111-111111111111', alt: '발사', caption: '' },
    { src: '/api/media/22222222-2222-4222-8222-222222222222', alt: '회수', caption: '' },
  ])
})

it('shows a gallery layout and caption in the CMS preview', () => {
  const value = ':::gallery{columns=1 align=right}\n\n![발사](/assets/img/rocket/icx1.webp "점화 직전")\n\n:::'
  const html = renderToStaticMarkup(<MarkdownField label="본문" value={value} onChange={() => {}} />)
  expect(html).toContain('data-gallery-columns="1"')
  expect(html).toContain('data-gallery-align="right"')
  expect(html).toContain('<figcaption>점화 직전</figcaption>')
})

it('does not show camera filenames as captions in the CMS preview', () => {
  const value = ':::gallery{columns=1}\n\n![IMG_0001.jpeg](/assets/img/rocket/icx1.webp)\n\n:::'
  const html = renderToStaticMarkup(<MarkdownField label="본문" value={value} onChange={() => {}} />)
  expect(html).toContain('data-gallery-columns="1"')
  expect(html).not.toContain('<figcaption>IMG_0001.jpeg</figcaption>')
})

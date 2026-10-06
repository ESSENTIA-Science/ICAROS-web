import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownField from './MarkdownField'
import PostMarkdown from '../../../web/src/components/posts/PostMarkdown'

const cms = (content: string) => renderToStaticMarkup(<MarkdownField label="본문" value={content} onChange={() => {}} />)
const publicHtml = (content: string) => renderToStaticMarkup(<PostMarkdown content={content} />)

it('offers PDF and MP4 upload inside the Markdown toolbar', () => {
  const html = cms('')
  expect(html).toContain('aria-label="PDF 삽입"')
  expect(html).toContain('aria-label="영상 삽입"')
  expect(html).toContain('application/pdf')
  expect(html).toContain('video/mp4')
})

it.each([['CMS', cms], ['public', publicHtml]] as const)('%s previews marked PDF links with an isolated frame and an open link', (_, render) => {
  const html = render('[시험 보고서](/assets/report.pdf "icaros:pdf")')
  expect(html).toContain('<iframe')
  expect(html).toContain('src="/assets/report.pdf"')
  expect(html).toContain('sandbox=""')
  expect(html).toContain('title="시험 보고서 PDF 미리보기"')
  expect(html).toContain('PDF 열기')
  expect(html).not.toContain('allow-scripts')
})

it.each([['CMS', cms], ['public', publicHtml]] as const)('%s previews marked MP4 links without autoplay or eager downloading', (_, render) => {
  const html = render('앞 [발사 영상](https://media.example.org/launch.mp4 "icaros:video") 뒤')
  expect(html).toContain('<video')
  expect(html).toContain('controls=""')
  expect(html).toContain('preload="none"')
  expect(html).toContain('playsInline=""')
  expect(html).toContain('src="https://media.example.org/launch.mp4"')
  expect(html).toContain('앞 ')
  expect(html).toContain(' 뒤')
  expect(html).not.toContain('autoPlay')
})

it.each([cms, publicHtml])('preserves ordinary links, images and GFM tables', render => {
  const html = render('[자료](https://example.org/report.pdf)\n\n![사진](/assets/photo.webp)\n\n| 항목 | 값 |\n| --- | --- |\n| 고도 | 12 |')
  expect(html).toContain('<a href="https://example.org/report.pdf">자료</a>')
  expect(html).toContain('<img')
  expect(html).toContain('<table>')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('<video')
})

it.each([cms, publicHtml])('does not turn raw HTML or unsafe marked links into embeds', render => {
  for (const src of ['javascript:alert(1)', 'data:text/html,test', '//evil.example/test', '/api/admin/session', '/assets/../secret', 'https://user:password@evil.example/test']) {
    const html = render(`[첨부](${src} "icaros:pdf")`)
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<video')
  }
  const html = render('<video src="https://evil.example/test" autoplay></video>\n\n<iframe src="https://evil.example/test"></iframe>')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('<video')
})

it('does not serve private API media paths as public embeds', () => {
  const html = publicHtml('[보고서](/api/media/11111111-1111-4111-8111-111111111111 "icaros:pdf")')
  expect(html).not.toContain('<iframe')
})

it('keeps legacy attachment-only images, PDFs and videos in the Markdown flow', () => {
  const html = renderToStaticMarkup(<PostMarkdown content="기존 기록" attachments={[
    { kind: 'image', src: '/assets/vehicle.webp', title: '기체 사진' },
    { kind: 'pdf', src: '/assets/report.pdf', title: '시험 보고서' },
    { kind: 'video', src: '/assets/launch.mp4', title: '발사 영상' },
  ]} />)
  expect(html).toContain('기존 기록')
  expect(html).toContain('alt="기체 사진"')
  expect(html).toContain('<iframe')
  expect(html).toContain('<video')
  expect(html).not.toContain('첨부 자료')
})

it('does not repeat body images, reference links, gallery images or duplicate metadata', () => {
  const html = renderToStaticMarkup(<PostMarkdown content={'![발사대](/assets/vehicle.webp)\n\n[보고서][report]\n\n[report]: /assets/report.pdf\n\n:::gallery{columns=1}\n\n![기체](/assets/second.webp)\n\n:::\n\n```\n/assets/launch.mp4\n```'} attachments={[
    { kind: 'image', src: '/assets/vehicle.webp', title: '중복 대표 사진' },
    { kind: 'image', src: '/assets/second.webp', title: '중복 갤러리 사진' },
    { kind: 'pdf', src: '/assets/report.pdf', title: '중복 보고서' },
    { kind: 'video', src: '/assets/launch.mp4', title: '발사 영상' },
    { kind: 'video', src: '/assets/launch.mp4', title: '중복 영상' },
  ]} />)
  expect(html.match(/<img\b/g)).toHaveLength(2)
  expect(html.match(/<video\b/g)).toHaveLength(1)
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('중복')
})

it('rejects unsafe attachment metadata and treats titles as text', () => {
  const html = renderToStaticMarkup(<PostMarkdown content="기록" attachments={[
    { kind: 'pdf', src: 'javascript:alert(1)', title: 'unsafe' },
    { kind: 'image', src: '/api/admin/session', title: 'unsafe image' },
    { kind: 'pdf', src: '/assets/report.pdf', title: '<img src=x onerror=alert(1)> [bad](javascript:alert(1))' },
  ]} />)
  expect(html.match(/<iframe\b/g)).toHaveLength(1)
  expect(html).not.toMatch(/<img[^>]*onerror=/)
  expect(html).not.toContain('href="javascript:')
  expect(html).not.toContain('<img')
  expect(html).toContain('&lt;img')
})

it('preserves a safe legacy video poster without accepting unsafe poster metadata', () => {
  const safe = renderToStaticMarkup(<PostMarkdown content="기록" attachments={[{ kind: 'video', src: '/assets/launch.mp4', title: '발사', posterSrc: '/assets/launch.webp' }]} />)
  expect(safe).toContain('poster="/assets/launch.webp"')
  const unsafe = renderToStaticMarkup(<PostMarkdown content="기록" attachments={[{ kind: 'video', src: '/assets/launch.mp4', title: '발사', posterSrc: 'javascript:alert(1)' }]} />)
  expect(unsafe).toContain('<video')
  expect(unsafe).not.toContain('poster=')
})

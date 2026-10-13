import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostMarkdown from '../src/components/posts/PostMarkdown'
import PanelVideo from '../src/components/panel/PanelVideo'
import Donate, { type DonateContent } from '../src/components/landing/Donate'
import type { Snapshot } from '../src/lib/content/snapshot'
import HeaderNav from '../src/components/ui/HeaderNav'
import Panel from '../src/components/panel/Panel'
import type { LandingPanel } from '../src/lib/panels'
import { readFileSync } from 'node:fs'
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/assets/logo_text_white.svg', () => ({ default: { src: '/assets/logo.svg', width: 180, height: 24 } }))

const fixture = vi.hoisted(() => ({ snapshot: { version: 'a', posts: [] } as unknown as Snapshot }))
vi.mock('@/lib/content/snapshot', () => ({ getSnapshot: () => fixture.snapshot }))
import { getFeed } from '../src/lib/posts/feed'

const attachments = [
  { kind: 'image' as const, src: '/assets/portrait.webp', title: '세로 사진', width: 512, height: 1024 },
  { kind: 'image' as const, src: '/assets/landscape.webp', title: '가로 사진', width: 960, height: 540 },
]

it.each(['', '![세로](/assets/portrait.webp)', '![세로][portrait]\n\n[portrait]: /assets/portrait.webp',
  ':::gallery{columns="2"}\n![세로](/assets/portrait.webp)\n\n![가로](/assets/landscape.webp)\n:::'])('reserves attachment dimensions in SSR: %s', content => {
  const html = renderToStaticMarkup(<PostMarkdown content={content} attachments={attachments} />)
  expect(html).toMatch(/<img[^>]*src="\/assets\/portrait.webp"[^>]*width="512"[^>]*height="1024"/)
  expect(html).toMatch(/<img[^>]*src="\/assets\/landscape.webp"[^>]*width="960"[^>]*height="540"/)
  expect(html.match(/src="\/assets\/portrait.webp"/g)).toHaveLength(1)
})

it('uses known proportions for gallery slots before hydration', () => {
  const html = renderToStaticMarkup(<PostMarkdown content="" attachments={attachments} />)
  expect(html).toContain('style="flex:0.5 1 0%"')
  expect(html).toContain('style="flex:1.7777777777777777 1 0%"')
})

it('keeps unknown external images without guessed dimensions', () => {
  const html = renderToStaticMarkup(<PostMarkdown content="![external](https://example.com/image.webp)" />)
  expect(html).toContain('src="https://example.com/image.webp"')
  expect(html).not.toContain('width=')
})

it('renders a video poster before hydration without requesting motion', () => {
  const props = { src: '/assets/video.mp4', width: 1920, height: 1080, first: true, poster: '/assets/poster.webp' }
  const html = renderToStaticMarkup(<PanelVideo {...props} />)
  expect(html).toContain('poster="/assets/poster.webp"')
  expect(html).not.toContain('src="/assets/video.mp4"')
})

it('provides the legacy support landing target only for nonempty Donate', () => {
  const empty: DonateContent = { intro: undefined, usageTitle: undefined, usageItems: [], quote: undefined, outro: undefined,
    current: 0, goal: 0, roundLabel: undefined, ctaLabel: undefined, ctaHref: undefined }
  const shell = { id: 'donate', label: 'Support', index: 1 }
  expect(renderToStaticMarkup(<Donate {...shell} {...empty} />)).toBe('')
  expect(renderToStaticMarkup(<Donate {...shell} {...empty} intro="후원 안내" />)).toContain('id="support"')
})

it('keeps mobile navigation available before hydration', () => {
  const html = renderToStaticMarkup(<HeaderNav items={[{ href: '/vehicles', label: 'Vehicles' }]} />)
  expect(html).toContain('href="/vehicles"')
  expect(html).not.toContain('data-enhanced=""')
})

it('hides a panel support CTA when Donate is disabled or empty', () => {
  const panel: LandingPanel = { id: 'p', mediaSrc: '/assets/image.webp', mime: 'image/webp', width: 100, height: 100, alt: '',
    focalX: 50, focalY: 50, scrim: 'none', anchor: 'center', heightMode: 'half', headline: 'Team', body: null, ctaHref: '#support', ctaLabel: '후원' }
  expect(renderToStaticMarkup(<Panel panel={panel} first supportAvailable={false} />)).not.toContain('href="#support"')
  expect(renderToStaticMarkup(<Panel panel={panel} first supportAvailable />)).toContain('href="#support"')
})

it('sorts a snapshot once while preserving date/source/id ties and refreshing the next revision', () => {
  const posts = ['z', 'a', 'b'].map((id, index) => ({ id, title: id, source: index === 2 ? 'legacy' : 'community', slug: id,
    displayDate: '2026-10-01', excerpt: '', thumb: null, published: true, contentMd: '' })) as Snapshot['posts']
  const sort = vi.spyOn(Array.prototype, 'sort')
  fixture.snapshot = { version: 'first', posts } as Snapshot
  expect(getFeed(0, 2).items.map(post => post.id)).toEqual(['a', 'z'])
  expect(getFeed(1, 2).items.map(post => post.id)).toEqual(['b'])
  expect(sort).toHaveBeenCalledTimes(1)
  sort.mockRestore()
  fixture.snapshot = { version: 'second', posts: [{ ...posts[0]!, id: 'new', displayDate: '2026-10-02' }] } as Snapshot
  expect(getFeed(0, 2).items.map(post => post.id)).toEqual(['new'])
  expect(getFeed(0, 2).hasNext).toBe(false)
})

it('measures repeated feed work using the current synthetic count and a growth fixture', () => {
  const current = JSON.parse(readFileSync(new URL('../fixtures/public.synthetic.json', import.meta.url), 'utf8')).posts.length as number
  const samples = [current, 10_000].map(count => {
    const posts = Array.from({ length: count }, (_, index) => ({ id: String(index).padStart(6, '0'), title: 'Fixture', source: 'community' as const,
      displayDate: '2026-10-01', excerpt: '', thumb: null, published: true as const, contentMd: '' }))
    const pages = Math.ceil(count / 15)
    const baselineStart = performance.now()
    for (let page = 0; page < pages; page++) posts.map(post => ({ id: post.id, href: `/posts/${post.id}`, title: post.title,
      displayDate: post.displayDate, source: post.source, excerpt: post.excerpt, thumb: post.thumb }))
      .sort((a, b) => b.displayDate.localeCompare(a.displayDate) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id)).slice(page * 15, (page + 1) * 15)
    const baselineMs = performance.now() - baselineStart
    fixture.snapshot = { version: `measure-${count}`, posts } as Snapshot
    const sort = vi.spyOn(Array.prototype, 'sort')
    const cachedStart = performance.now()
    for (let page = 0; page < pages; page++) getFeed(page, 15)
    const cachedMs = performance.now() - cachedStart
    expect(sort).toHaveBeenCalledTimes(1)
  sort.mockRestore()
    return { count, pages, baselineMapItems: count * pages, cachedMapItems: count, baselineMs, cachedMs }
  })
  console.log('Synthetic feed measurement (single process; not a full Next build):', JSON.stringify(samples))
})

import { groupBySquad, type MemberDto } from '../src/app/(public)/member/_data'
it('moves only each department leader first while preserving all remaining order and roles', () => {
  const a = '123e4567-e89b-42d3-a456-426614174010', b = '123e4567-e89b-42d3-a456-426614174011'
  const member = (id: string, departmentIds: string[]): MemberDto => ({ id, name: id, role: 'original', squad: null, departmentIds, school: null, bioMd: null, imageSrc: '', hasPhoto: false })
  const people = [member('first', [a, b]), member('second', [a, b]), member('third', [a, b]), member('none', [])]
  const departments = [{ id: b, name: 'B', sortOrder: 1, leadMemberId: 'second' }, { id: a, name: 'A', sortOrder: 0, leadMemberId: 'third' }]
  const groups = groupBySquad(people, departments)
  expect(groups.map(group => [group.squad, group.members.map(person => person.id)])).toEqual([
    ['A', ['third', 'first', 'second']], ['B', ['second', 'first', 'third']], [null, ['none']],
  ])
  expect(people.map(person => person.id)).toEqual(['first', 'second', 'third', 'none'])
  expect(groups.flatMap(group => group.members).every(person => person.role === 'original')).toBe(true)
  for (const leadMemberId of [null, undefined, 'missing']) {
    expect(groupBySquad(people, [{ ...departments[1]!, leadMemberId }])[0]!.members.map(person => person.id)).toEqual(['first', 'second', 'third'])
  }
  expect(groupBySquad(people.filter(person => person.id !== 'third'), departments)[0]!.members.map(person => person.id)).toEqual(['first', 'second'])
})

import { cache } from 'react'
import type { Metadata } from 'next'
import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/lib/db'
import { getSiteContent, toList, toNumber, type SiteContent } from '@/lib/content'
import Hero from '@/components/landing/Hero'
import Statement, { hasStatementContent } from '@/components/landing/Statement'
import Research, { hasResearchContent } from '@/components/landing/Research'
import Mission, { hasMissionContent } from '@/components/landing/Mission'
import Donate, { hasDonateContent, type DonateContent } from '@/components/landing/Donate'
import Contact, { hasContactContent } from '@/components/landing/Contact'
import type { SectionTheme } from '@/components/landing/Section'

/**
 * 랜딩은 CMS 가 그때그때 고치는 화면이다. cacheComponents 를 끈 상태(04 §Caching posture)에서는
 * DB 만 읽는 페이지가 빌드 타임에 프리렌더돼 버려서 카피를 고쳐도 재배포 전까지 반영되지 않는다.
 * 요청 시각 렌더로 못박아 둔다.
 */
export const dynamic = 'force-dynamic'

/** generateMetadata 와 본문이 같은 요청 안에서 쿼리를 한 번만 쓰도록 묶는다. */
const loadContent = cache(getSiteContent)

const loadSections = cache(async () =>
  db
    .select({ id: schema.pageSections.id, label: schema.pageSections.label })
    .from(schema.pageSections)
    .where(eq(schema.pageSections.enabled, true))
    // sort_order 가 겹쳐도 순서가 흔들리지 않게 id 로 tie-break 한다
    .orderBy(asc(schema.pageSections.sortOrder), asc(schema.pageSections.id))
)

/**
 * 섹션 테마. page_sections 에는 테마 컬럼이 없고 스키마는 건드리지 않으므로 id 로 고정한다.
 * 레퍼런스 비율(밝은 쪽 ~80% / 어두운 쪽 ~20%)에 맞춰 어두운 섹션은 양 끝 둘뿐이고,
 * contact 는 이미 dark 인 Footer 로 그대로 이어진다.
 */
const SECTION_THEME: Readonly<Record<string, SectionTheme>> = {
  hero: 'dark',
  vision: 'tint',
  mission: 'tint',
  contact: 'dark',
}

/** about.body 앞부분을 메타 description 으로. 카피를 따로 쓰지 않고 CMS 값을 그대로 쓴다 (A10). */
function toDescription(body: string | undefined): string | undefined {
  if (!body) return undefined
  const flat = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
  if (flat === '') return undefined
  return flat.length <= 160 ? flat : `${flat.slice(0, 159).trimEnd()}…`
}

export async function generateMetadata(): Promise<Metadata> {
  const c = await loadContent()
  const description = toDescription(c['about.body'])
  return {
    alternates: { canonical: '/' },
    ...(description ? { description, openGraph: { description } } : {}),
  }
}

type SectionRow = { id: string; label: string }
type BuildContext = { donateCtaHref: string | undefined }

/**
 * 인덱스와 hero 다음 앵커는 "무엇이 살아남았는지"를 알아야 정해진다. 그래서 빌드 단계에서
 * 확정하지 않고 렌더 시점 인자로 미룬다.
 */
/**
 * 섹션 렌더 함수. **컴포넌트가 아니다** — 이미 만들어진 엘리먼트를 번호만 받아 돌려준다.
 * 번호를 배열 위치가 아니라 "실제 렌더되는 섹션" 기준으로 매기려면
 * 무엇이 렌더될지 먼저 정해진 뒤에 번호가 붙어야 해서 이 2단계 구조가 필요하다.
 *
 * 이름 있는 함수 표현식으로 쓴다. 익명 화살표로 두면 `react/display-name` 이
 * 익명 컴포넌트로 오인해 lint 를 깬다.
 */
type SectionRenderer = (index: number, nextAfterHero: string | undefined) => React.ReactNode

/**
 * 섹션 하나를 "그릴 수 있으면 렌더 함수, 비었으면 null" 로 판정한다.
 *
 * 번호를 배열 위치로 매기면 빈 섹션이 빠질 때 02·03·05 처럼 구멍이 난다.
 * 비었는지 판정하는 규칙은 각 컴포넌트가 export 하는 술어 하나뿐이다(컴포넌트도 같은 술어로
 * 자기 자신을 막는다). 여기와 컴포넌트가 서로 다른 기준을 갖는 일이 없다.
 */
function buildSection(row: SectionRow, c: SiteContent, ctx: BuildContext): SectionRenderer | null {
  const theme = SECTION_THEME[row.id]
  const shell = { id: row.id, label: row.label, theme }

  switch (row.id) {
    case 'hero': {
      // Hero 는 카피가 비어도 로고와 스크롤 지시가 남는다 — 항상 그린다.
      // 번호는 쓰지 않지만 자리는 차지한다(About 이 02 로 시작하는 현재 조판 유지).
      const tagline = c['hero.tagline']
      return function renderHero(_index, nextAfterHero) {
        return (
          <Hero key={row.id} tagline={tagline} nextSectionId={nextAfterHero} />
        )
      }
    }

    case 'about': {
      const content = { slogan: c['about.slogan'], body: c['about.body'] }
      if (!hasStatementContent(content)) return null
      return function renderAbout(index) {
        return (
          <Statement key={row.id} {...shell} index={index} variant="split" {...content} />
        )
      }
    }

    case 'vision': {
      const content = { slogan: c['vision.slogan'], body: c['vision.body'] }
      if (!hasStatementContent(content)) return null
      return function renderVision(index) {
        return (
          <Statement key={row.id} {...shell} index={index} variant="center" {...content} />
        )
      }
    }

    case 'research': {
      const blocks = [
        { key: 'uav', title: c['research.uav.title'], body: c['research.uav.body'] },
        { key: 'control', title: c['research.control.title'], body: c['research.control.body'] },
        {
          key: 'rocketry',
          title: c['research.rocketry.title'],
          body: c['research.rocketry.body'],
        },
      ]
      if (!hasResearchContent(blocks)) return null
      return function renderResearch(index) {
        return <Research key={row.id} {...shell} index={index} blocks={blocks} />
      }
    }

    case 'mission': {
      const content = {
        body: c['mission.body'],
        listIntro: c['mission.list_intro'],
        items: toList(c['mission.list']),
      }
      if (!hasMissionContent(content)) return null
      return function renderMission(index) {
        return <Mission key={row.id} {...shell} index={index} {...content} />
      }
    }

    case 'donate': {
      const content: DonateContent = {
        intro: c['donate.intro'],
        usageTitle: c['donate.usage_title'],
        usageItems: toList(c['donate.usage_list']),
        quote: c['donate.quote'],
        outro: c['donate.outro'],
        current: toNumber(c['donation.current']),
        goal: toNumber(c['donation.goal']),
        ctaLabel: c['donate.cta_label'],
        ctaHref: ctx.donateCtaHref,
      }
      if (!hasDonateContent(content)) return null
      return function renderDonate(index) {
        return <Donate key={row.id} {...shell} index={index} {...content} />
      }
    }

    case 'contact': {
      const content = {
        body: c['contact.body'],
        email: c['contact.email'],
        instagram: c['contact.instagram'],
      }
      if (!hasContactContent(content)) return null
      return function renderContact(index) {
        return <Contact key={row.id} {...shell} index={index} {...content} />
      }
    }

    default:
      // CMS 에 알 수 없는 섹션 id 가 생기면 조용히 건너뛴다 — 페이지를 깨뜨리지 않는다
      return null
  }
}

export default async function HomePage() {
  const [c, sections] = await Promise.all([loadContent(), loadSections()])

  // 후원 CTA 는 alert 대신 앵커다 (B8). contact 가 꺼져 있거나 카피가 전부 비어 통째로 빠지면
  // `#contact` 는 죽은 앵커가 되므로 메일로 보낸다.
  const email = c['contact.email']
  const contactRenders =
    sections.some((s) => s.id === 'contact') &&
    hasContactContent({ body: c['contact.body'], email, instagram: c['contact.instagram'] })
  const donateCtaHref = contactRenders ? '#contact' : email ? `mailto:${email}` : undefined

  const rendered = sections.flatMap((row) => {
    const render = buildSection(row, c, { donateCtaHref })
    return render ? [{ id: row.id, render }] : []
  })

  // 스크롤 화살표는 "실제로 그려진 다음 섹션"으로 간다 — 빈 섹션이 빠져도 죽은 앵커가 되지 않는다
  const heroPos = rendered.findIndex((r) => r.id === 'hero')
  const nextAfterHero = heroPos >= 0 ? rendered[heroPos + 1]?.id : rendered[0]?.id

  return (
    <>
      {/* 리빌은 JS 가 살아 있을 때만 의미가 있다. 스크립트가 없으면 숨김 상태로 갇히지 않게 푼다. */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html: '[data-reveal]{opacity:1!important;transform:none!important}',
          }}
        />
      </noscript>

      {/* 번호는 배열 위치가 아니라 살아남은 순서다 — 빈 섹션이 빠져도 02·03·05 로 뛰지 않는다 */}
      {rendered.map((r, i) => r.render(i + 1, nextAfterHero))}
    </>
  )
}

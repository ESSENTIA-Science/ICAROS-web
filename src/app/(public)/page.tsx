import { cache } from 'react'
import type { Metadata } from 'next'
import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/lib/db'
import { getSiteContent, toList, toNumber, type SiteContent } from '@/lib/content'
import Hero from '@/components/landing/Hero'
import Statement from '@/components/landing/Statement'
import Research from '@/components/landing/Research'
import Mission from '@/components/landing/Mission'
import Donate from '@/components/landing/Donate'
import Contact from '@/components/landing/Contact'
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

function renderSection(
  row: SectionRow,
  index: number,
  c: SiteContent,
  ctx: { nextAfterHero: string | undefined; donateCtaHref: string | undefined }
) {
  const theme = SECTION_THEME[row.id]
  const common = { id: row.id, label: row.label, index, theme }

  switch (row.id) {
    case 'hero':
      return (
        <Hero key={row.id} tagline={c['hero.tagline']} nextSectionId={ctx.nextAfterHero} />
      )

    case 'about':
      return (
        <Statement
          key={row.id}
          {...common}
          variant="split"
          slogan={c['about.slogan']}
          body={c['about.body']}
        />
      )

    case 'vision':
      return (
        <Statement
          key={row.id}
          {...common}
          variant="center"
          slogan={c['vision.slogan']}
          body={c['vision.body']}
        />
      )

    case 'research':
      return (
        <Research
          key={row.id}
          {...common}
          blocks={[
            { key: 'uav', title: c['research.uav.title'], body: c['research.uav.body'] },
            {
              key: 'control',
              title: c['research.control.title'],
              body: c['research.control.body'],
            },
            {
              key: 'rocketry',
              title: c['research.rocketry.title'],
              body: c['research.rocketry.body'],
            },
          ]}
        />
      )

    case 'mission':
      return (
        <Mission
          key={row.id}
          {...common}
          body={c['mission.body']}
          listIntro={c['mission.list_intro']}
          items={toList(c['mission.list'])}
        />
      )

    case 'donate':
      return (
        <Donate
          key={row.id}
          {...common}
          intro={c['donate.intro']}
          usageTitle={c['donate.usage_title']}
          usageItems={toList(c['donate.usage_list'])}
          quote={c['donate.quote']}
          outro={c['donate.outro']}
          current={toNumber(c['donation.current'])}
          goal={toNumber(c['donation.goal'])}
          ctaLabel={c['donate.cta_label']}
          ctaHref={ctx.donateCtaHref}
        />
      )

    case 'contact':
      return (
        <Contact
          key={row.id}
          {...common}
          body={c['contact.body']}
          email={c['contact.email']}
          instagram={c['contact.instagram']}
        />
      )

    default:
      // CMS 에 알 수 없는 섹션 id 가 생기면 조용히 건너뛴다 — 페이지를 깨뜨리지 않는다
      return null
  }
}

export default async function HomePage() {
  const [c, sections] = await Promise.all([loadContent(), loadSections()])

  const heroIndex = sections.findIndex((s) => s.id === 'hero')
  const nextAfterHero = heroIndex >= 0 ? sections[heroIndex + 1]?.id : sections[0]?.id

  // 후원 CTA 는 alert 대신 앵커다 (B8). contact 섹션이 꺼져 있으면 앵커가 죽으므로 메일로 보낸다.
  const contactEnabled = sections.some((s) => s.id === 'contact')
  const email = c['contact.email']
  const donateCtaHref = contactEnabled ? '#contact' : email ? `mailto:${email}` : undefined

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

      {sections.map((row, i) => renderSection(row, i + 1, c, { nextAfterHero, donateCtaHref }))}
    </>
  )
}

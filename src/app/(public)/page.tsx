import { cache } from 'react'
import type { Metadata } from 'next'
import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/lib/db'
import { getSiteContentSafe, toList, toNumber, type SiteContent } from '@/lib/content'
import { getLandingPanelsSafe } from '@/lib/panels'
import Panel from '@/components/panel/Panel'
import Hero from '@/components/landing/Hero'
import Statement, { hasStatementContent } from '@/components/landing/Statement'
import Research, { hasResearchContent } from '@/components/landing/Research'
import Mission, { hasMissionContent } from '@/components/landing/Mission'
import Donate, { hasDonateContent, type DonateContent } from '@/components/landing/Donate'
import Contact, { hasContactContent } from '@/components/landing/Contact'
import type { SectionTheme } from '@/components/landing/Section'

/**
 * **온디맨드 무효화 + 60초 백스톱.** `force-dynamic` 이었다 (W4, 2026-09-06 전환).
 *
 * ─── 왜 60초인가. CLAUDE.md 지뢰 "ISR 로 공개 여부를 감싸지 말 것"과의 관계 ──────────
 * 그 지뢰는 **시간 기반 revalidate 를 유일한 무효화 신호로 쓰는 것**을 경고한다 —
 * `published=false` 로 내린 패널이 최대 그 시간만큼 계속 보인다는 뜻이다.
 * 여기서 시간은 유일한 신호가 아니라 **백스톱**이다:
 *   · 공개 여부를 바꾸는 경로는 전부 `_actions` 를 지나고, 그 다섯 곳이 모두
 *     `revalidatePath('/')`(panels·scene) / `('/', 'layout')`(landing) 를 부른다 → 노출 창 0.
 *   · 60초는 "아무도 아무것도 저장하지 않았을 때의 상한"이다. 그 상황에서는 바뀐 것도 없다.
 * 반대로 `revalidate = false`(온디맨드 전용)로 두면 아래 (2)의 빈 프리렌더가 **영구히** 박힌다.
 * 훅이 실패해도 60초 안에 스스로 낫는 것 — 그것이 이 값의 유일한 목적이다.
 *
 * ─── (2) 빌드가 DB 를 못 쳐도 죽지 않는다 ─────────────────────────────────────
 * A6 이 여기서 막혔다. `/` 는 동적 세그먼트가 없어 `revalidate` 를 주는 순간 빌드가 반드시 한 번
 * 프리렌더하고, 그 안의 `getSiteContent()` 가 그대로 RDS 로 나가 `ECONNREFUSED` 로 빌드를 죽였다.
 * `/rocket/[slug]` 의 `generateStaticParams(): []` 우회는 동적 세그먼트가 있는 라우트 전용이다.
 * 그래서 **로더 세 개를 전부 fail-safe 로** 바꿨다 — `getSiteContentSafe()`·`loadSections()`·
 * `getLandingPanelsSafe()`. 셋 다 실패하면 그 자리를 비우고 렌더는 계속된다.
 * 대가는 하나뿐이다: **빌드가 DB 를 못 읽은 배포는 빈 랜딩을 프리렌더해 캐시에 넣는다.**
 * 그 창을 닫는 것이 배포 성공 웹훅(`POST /api/revalidate`)이고, 훅이 실패했을 때의 상한이 위 60초다.
 * 그래도 남는 마지막 그물이 `npm run smoke` 의 `/` 본문 검사다 — 사람 눈이 아니라 스모크가 잡는다.
 *
 * 배포 빌드를 RDS 도달성에 묶지 않는다는 규칙(D27)은 그대로다. 이 파일은 그 규칙을 지킨 채
 * 캐시로 넘어간 것이지, 규칙을 판 것이 아니다.
 */
export const revalidate = 60

/**
 * generateMetadata 와 본문이 같은 요청 안에서 쿼리를 한 번만 쓰도록 묶는다.
 *
 * **`getSiteContent`(throw) 가 아니라 `getSiteContentSafe`(swallow) 다.** 루트 레이아웃이
 * 같은 이유로 safe 를 쓴다 — 다만 여기서는 이유가 하나 더 있다: `generateMetadata` 도 이 로더를
 * 타므로, 던지는 버전을 쓰면 본문을 아무리 방어해도 **메타데이터 단계에서 빌드가 죽는다.**
 * 실패 시 `description` 이 undefined 가 되어 아래 openGraph 블록이 통째로 빠지고,
 * 루트 레이아웃의 og:* 가 그대로 살아남는다(키 단위 치환 지뢰가 오히려 안전한 방향으로 작동한다).
 */
const loadContent = getSiteContentSafe

/**
 * 섹션 목록. 실패하면 **빈 배열**이다 — 랜딩이 통째로 500 이 되는 대신 그 자리를 비운다.
 * (패널이 하나라도 살아 있으면 화면은 여전히 성립한다. 둘 다 비면 스모크가 잡는다.)
 */
const loadSections = cache(async (): Promise<SectionRow[]> => {
  try {
    return await db
      .select({ id: schema.pageSections.id, label: schema.pageSections.label })
      .from(schema.pageSections)
      .where(eq(schema.pageSections.enabled, true))
      // sort_order 가 겹쳐도 순서가 흔들리지 않게 id 로 tie-break 한다
      .orderBy(asc(schema.pageSections.sortOrder), asc(schema.pageSections.id))
  } catch (err) {
    console.error('[landing] page_sections 조회 실패 — 섹션 없이 렌더합니다', err)
    return []
  }
})

/**
 * 섹션 테마 배분. page_sections 에는 테마 컬럼이 없고 스키마는 건드리지 않으므로 id 로 고정한다.
 *
 * 5값을 전부 쓰되 비율을 지킨다 (03 §4: 밝은 쪽 ~80% / 어두운 쪽 ~20%) —
 * ink 는 양 끝 둘뿐이고, contact 는 이미 dark 인 Footer 로 그대로 이어진다.
 * graphite(중간톤)는 모금액이 주인공인 donate 하나에만 준다. 중간톤이 두 번 나오면
 * "앵커"가 아니라 "또 하나의 배경"이 된다.
 *
 * hero 는 Section 껍데기를 쓰지 않아 자기 안에서 ink 를 직접 선언한다 — 여기 목록은
 * 배분을 한눈에 보기 위한 것이므로 hero 도 같이 적어 둔다.
 */
const SECTION_THEME: Readonly<Record<string, SectionTheme>> = {
  hero: 'ink',
  about: 'paper',
  vision: 'white',
  research: 'mist',
  mission: 'paper',
  donate: 'graphite',
  contact: 'ink',
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
    // Next 는 `openGraph` 를 **최상위 키 단위로 치환**한다 — 여기서 `{ description }` 만 주면
    // 루트 레이아웃의 og:image·og:url·og:site_name·og:type 이 **홈에서만** 사라진다.
    // 실측으로 홈에 og:image 태그가 없었다. 그래서 나머지 필드를 명시적으로 다시 얹는다.
    ...(description
      ? {
          description,
          openGraph: {
            type: 'website',
            url: 'https://icaros.kr',
            siteName: 'ICAROS',
            title: 'ICAROS',
            description,
            images: ['/og.png'],
          },
        }
      : {}),
  }
}

type SectionRow = { id: string; label: string }
type BuildContext = { donateCtaHref: string | undefined }

/**
 * hero 다음 앵커는 "무엇이 살아남았는지"를 알아야 정해진다. 그래서 빌드 단계에서
 * 확정하지 않고 렌더 시점 인자로 미룬다.
 */
/**
 * 섹션 렌더 함수. **컴포넌트가 아니다** — 이미 만들어진 엘리먼트를 인자만 받아 돌려준다.
 * `index` 는 `Section` 이 더 이상 그리지 않지만(`01` `02` 라벨을 걷어냈다) 시그니처에는
 * 남아 있고, 값은 여전히 "실제 렌더되는 섹션" 기준으로 매긴다 — 되살릴 때 구멍이 없게.
 *
 * 이름 있는 함수 표현식으로 쓴다. 익명 화살표로 두면 `react/display-name` 이
 * 익명 컴포넌트로 오인해 lint 를 깬다.
 */
type SectionRenderer = (index: number, nextAfterHero: string | undefined) => React.ReactNode

/**
 * 섹션 하나를 "그릴 수 있으면 렌더 함수, 비었으면 null" 로 판정한다.
 *
 * 비었는지 판정하는 규칙은 각 컴포넌트가 export 하는 술어 하나뿐이다(컴포넌트도 같은 술어로
 * 자기 자신을 막는다). 여기와 컴포넌트가 서로 다른 기준을 갖는 일이 없다.
 */
function buildSection(row: SectionRow, c: SiteContent, ctx: BuildContext): SectionRenderer | null {
  const theme = SECTION_THEME[row.id]
  const shell = { id: row.id, label: row.label, theme }

  switch (row.id) {
    case 'hero': {
      // Hero 는 카피가 비어도 로고와 스크롤 지시가 남는다 — 항상 그린다.
      // 번호는 쓰지 않지만 자리는 차지한다.
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
          <Statement
            key={row.id}
            {...shell}
            index={index}
            variant="split"
            emphasis="words"
            {...content}
          />
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
  const [c, sections, panels] = await Promise.all([loadContent(), loadSections(), getLandingPanelsSafe()])

  /**
   * 패널이 하나라도 공개돼 있으면 **패널 더미가 곧 히어로**다. 그때 `hero` 섹션(3D 무대)을
   * 같이 그리면 첫 화면이 두 개가 된다.
   *
   * 이 판정을 코드가 하는 이유: `page_sections` 에서 `hero` 를 끄는 것으로도 같은 결과가 되지만,
   * 그 한 줄을 잊은 채 패널을 공개하는 순간 랜딩이 눈에 띄게 깨진다. 데이터로만 막을 수 있는
   * 규칙을 코드가 한 번 더 잡아 준다 — 반대로 패널을 전부 내리면 3D 히어로가 저절로 돌아온다.
   */
  /**
   * 패널이 대체하는 섹션 목록. 히어로(3D 무대)와 **소개 글 넷**이다.
   *
   * 패널 다섯 장이 이미 "무엇을 하는 팀인가"를 말하므로 그 아래에 같은 이야기를 문단으로
   * 다시 적으면 랜딩이 사진 페이지와 소개 문서를 겹쳐 놓은 것이 된다 —
   * 하위 페이지로 밀어낸 밀도가 랜딩 하단으로 되돌아오는 셈이다.
   *
   * `donate` 와 `contact` 는 남긴다. 패널 CTA 가 `#support`·`#contact` 로 내려가는 착지점이고,
   * 모금 현황·연락처는 패널이 대신할 수 없는 **기능**이다.
   */
  const REPLACED_BY_PANELS = new Set(['hero', 'about', 'vision', 'research', 'mission'])
  const usable = panels.length > 0 ? sections.filter((s) => !REPLACED_BY_PANELS.has(s.id)) : sections

  // 후원 CTA 는 alert 대신 앵커다 (B8). contact 가 꺼져 있거나 카피가 전부 비어 통째로 빠지면
  // `#contact` 는 죽은 앵커가 되므로 메일로 보낸다.
  const email = c['contact.email']
  const contactRenders =
    sections.some((s) => s.id === 'contact') &&
    hasContactContent({ body: c['contact.body'], email, instagram: c['contact.instagram'] })
  const donateCtaHref = contactRenders ? '#contact' : email ? `mailto:${email}` : undefined

  const rendered = usable.flatMap((row) => {
    const render = buildSection(row, c, { donateCtaHref })
    return render ? [{ id: row.id, render }] : []
  })

  // 스크롤 화살표는 "실제로 그려진 다음 섹션"으로 간다 — 빈 섹션이 빠져도 죽은 앵커가 되지 않는다
  const heroPos = rendered.findIndex((r) => r.id === 'hero')
  const nextAfterHero = heroPos >= 0 ? rendered[heroPos + 1]?.id : rendered[0]?.id

  return (
    <div data-palette={panels.length > 0 ? 'mono' : undefined}>
      {/* 리빌은 JS 가 살아 있을 때만 의미가 있다. 스크립트가 없으면 숨김 상태로 갇히지 않게 푼다.
          세 종류(덩어리·순차 자식·단어)를 전부 풀어야 한다 — 하나라도 빠지면 그 자리만 안 보인다.
          CSS Modules 의 해시 클래스명은 여기서 지목할 수 없어 리빌 상태를 전부 데이터 속성으로 둔다. */}
      <noscript>
        <style
          dangerouslySetInnerHTML={{
            __html:
              '[data-reveal],[data-reveal-item],[data-word]{opacity:1!important;transform:none!important}',
          }}
        />
      </noscript>

      {/* 사진 패널이 먼저다. 랜딩이 무엇을 하는 팀인지 사진으로 말하고, 자료는 하위 페이지가 진다. */}
      {panels.map((panel, i) => (
        <Panel key={panel.id} panel={panel} first={i === 0} />
      ))}

      {/* index 는 배열 위치가 아니라 살아남은 순서다 — 화면에 나가지는 않지만 구멍은 만들지 않는다 */}
      {rendered.map((r, i) => r.render(i + 1, nextAfterHero))}
    </div>
  )
}

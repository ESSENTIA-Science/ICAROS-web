import type { Metadata } from 'next'
import { getSnapshot } from '@/lib/content/snapshot'
import { getSeo, toList, toNumber, type SiteContent } from '@/lib/content'
import Panel from '@/components/panel/Panel'
import styles from './page.module.css'
import Hero from '@/components/landing/Hero'
import Statement, { hasStatementContent } from '@/components/landing/Statement'
import Research, { hasResearchContent } from '@/components/landing/Research'
import Mission, { hasMissionContent } from '@/components/landing/Mission'
import Donate, { hasDonateContent, type DonateContent } from '@/components/landing/Donate'
import Contact, { hasContactContent } from '@/components/landing/Contact'
import type { SectionTheme } from '@/components/landing/Section'
import { isInternalCtaHref } from '@/lib/cta'

const loadContent = async (): Promise<SiteContent> => getSnapshot().site
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
  const seo = getSeo(c)
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
            locale: 'ko_KR',
            url: 'https://icaros.kr',
            siteName: seo.title,
            title: seo.title,
            description,
            images: [{ url: seo.ogImage, alt: 'ICAROS' }],
          },
          twitter: { card: 'summary_large_image', title: seo.title, description, images: [seo.ogImage] },
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
        roundLabel: c['donation.round_label'],
        ctaLabel: c['donate.cta_label'],
        ctaHref: c['donate.cta_href'] === undefined ? ctx.donateCtaHref : isInternalCtaHref(c['donate.cta_href']) ? c['donate.cta_href'] : undefined,
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
  const snapshot = getSnapshot()
  const c = snapshot.site
  const sections = snapshot.sections
  const panels = snapshot.panels

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

  // 기존 스냅샷에 donate.cta_href 가 없을 때만 연락처 앵커/메일을 기본 링크로 쓴다.
  // CMS 에서 설정한 링크는 buildSection 이 우선 사용한다.
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
    <div className={styles.home} data-palette={panels.length > 0 ? 'mono' : undefined}>
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

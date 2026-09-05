import type { Metadata } from 'next'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import RocketCard from '@/components/rocket/RocketCard'
import SeriesTabs from '@/components/rocket/SeriesTabs'
import {
  parseSeries,
  seriesHref,
  seriesLabel,
  type RocketSeries,
  type RocketSeriesOption,
} from '@/components/rocket/series'
import { listRocketSeries, listRocketsBySeries } from './_data'
import styles from './page.module.css'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * **빌드가 DB 도달성을 요구하지 않게 한다.**
 *
 * 이 선언이 없으면 Next 가 빌드 시점에 이 페이지를 한 번 프리렌더해 보고, 그 안의 DB 조회가
 * 그대로 나간다. 실측: `DATABASE_URL` 을 죽은 포트로 두면 `next build` 가
 * `Error occurred prerendering page "/rocket"` → `ECONNREFUSED` 로 죽는다.
 *
 * 프리렌더 결과는 어차피 버려진다 — 이 페이지는 `searchParams` 를 읽어 요청마다 내용이 달라진다.
 * 즉 **아무 이득 없이 배포 빌드가 DB 를 필수 의존성으로 갖게 된다.** 빌드 환경에서 RDS 에
 * 닿지 못하는 순간(네트워크·자격증명·정책 어느 것이든) 배포 자체가 실패한다.
 *
 * `[slug]/page.tsx` 에는 같은 이유로 이미 이 선언이 있다. 여기 70번째 줄 주석은
 * "이 페이지는 force-dynamic 이고"라고 **단정하고 있었지만 실제 선언은 없었다** —
 * 옆 라우트의 사실을 이 파일에 옮겨 적은 것이었고, 그래서 아무도 눈치채지 못했다.
 */
export const dynamic = 'force-dynamic'

/**
 * 시리즈는 쿼리스트링에 있고 목록 내용이 통째로 달라진다 — 두 시리즈가 같은 title·canonical 을
 * 들고 있으면 검색엔진이 한쪽을 중복으로 접는다. 기본 시리즈만 `/rocket` 을 canonical 로 쓴다.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams
}): Promise<Metadata> {
  const all = await listRocketSeries()
  const series = parseSeries((await searchParams).series, all)
  // 카테고리가 하나도 없으면 목록 자체가 빈 화면이다. 그때는 시리즈 없는 메타데이터를 낸다.
  if (series === null) {
    return { title: 'Rockets', description: 'ICAROS가 설계·제작한 발사체.', alternates: { canonical: '/rocket' } }
  }
  const label = seriesLabel(series, all)
  const canonical = seriesHref(series, all)

  return {
    title: `Rockets · ${label}`,
    description: `ICAROS가 설계·제작한 ${label} 발사체의 제원과 엔진 구성.`,
    alternates: { canonical },
    openGraph: { title: `Rockets · ${label} · ICAROS`, url: canonical },
  }
}

export default async function RocketIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const all = await listRocketSeries()
  const series = parseSeries((await searchParams).series, all)

  return (
    // 기체 렌더가 밝은 회색 실루엣이라 어두운 면 위에서만 형태가 선다.
    // `ink` 는 tokens.css 의 섹션 테마 5값 중 어두운 앵커다.
    /* `mono` 는 이 트리 전체를 검정·흰색으로 잠근다. 랜딩이 사진 패널로 바뀐 뒤
       하위 페이지만 시그널(청록)을 쓰면 링크 하나 눌렀을 뿐인데 다른 사이트로 넘어간 것처럼 읽힌다. */
    <section className={styles.page} data-section-theme="ink" data-palette="mono">
      <RevealNoScript />
      <div className="container">
        <header className={styles.head}>
          <h1 lang="en">Rockets</h1>
          <p className={styles.lede}>
            ICAROS가 직접 설계·제작하고 발사한 기체입니다.
          </p>
        </header>

        {/* Suspense 경계를 두지 않는다.
            경계가 실제로 지연되면 React 가 fallback 을 DOM 으로 먼저 내보내고 완료 스크립트($RC)로
            교체하는데, 그러면 JS 없는 클라이언트·크롤러에게는 스켈레톤만 남는다.
            실측에서 로컬 DB 인데도 8회 중 4회가 그랬다.
            더 나쁜 건 SeriesTabs 가 경계 안에 있으면 **시리즈 B 로 가는 유일한 내비게이션**까지
            사라진다는 것이다 — 방금 generateMetadata 로 시리즈별 canonical 을 나눠 놓은 것과 모순된다.
            이 페이지는 force-dynamic 이고 로켓 4기짜리 쿼리 2개라 스트리밍으로 얻을 게 없다. */}
        {series === null ? (
          <p className={styles.empty}>등록된 카테고리가 없습니다.</p>
        ) : (
          <RocketFleet series={series} all={all} />
        )}
      </div>
    </section>
  )
}

async function RocketFleet({
  series,
  all,
}: {
  series: RocketSeries
  all: readonly RocketSeriesOption[]
}) {
  const rockets = await listRocketsBySeries(series)

  return (
    <>
      <SeriesTabs active={series} all={all} />

      {rockets.length === 0 ? (
        <p className={styles.empty}>
          {seriesLabel(series, all)}에 공개된 기체가 아직 없습니다.
        </p>
      ) : (
        // 리빌은 격자에만 건다 — 탭은 내비게이션이라 어떤 조건에서도 즉시 보여야 한다.
        <InView>
          <ul className={styles.grid}>
            {rockets.map((r) => (
              <RocketCard key={r.slug} rocket={r} />
            ))}
          </ul>
        </InView>
      )}
    </>
  )
}

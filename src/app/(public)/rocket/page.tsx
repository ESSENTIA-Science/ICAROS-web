import type { Metadata } from 'next'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import RocketCard from '@/components/rocket/RocketCard'
import SeriesTabs from '@/components/rocket/SeriesTabs'
import { DEFAULT_SERIES, parseSeries, seriesLabel, type RocketSeries } from '@/components/rocket/series'
import { countRocketsBySeries, listRocketsBySeries } from './_data'
import styles from './page.module.css'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * 시리즈는 쿼리스트링에 있고 목록 내용이 통째로 달라진다 — 두 시리즈가 같은 title·canonical 을
 * 들고 있으면 검색엔진이 한쪽을 중복으로 접는다. 기본 시리즈만 `/rocket` 을 canonical 로 쓴다.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams
}): Promise<Metadata> {
  const series = parseSeries((await searchParams).series)
  const label = seriesLabel(series)
  const canonical = series === DEFAULT_SERIES ? '/rocket' : `/rocket?series=${series}`

  return {
    title: `Rockets · ${label}`,
    description: `ICAROS가 설계·제작한 ${label} 발사체의 제원과 엔진 구성.`,
    alternates: { canonical },
    openGraph: { title: `Rockets · ${label} · ICAROS`, url: canonical },
  }
}

export default async function RocketIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const series = parseSeries((await searchParams).series)

  return (
    // 기체 렌더가 밝은 회색 실루엣이라 어두운 면 위에서만 형태가 선다.
    // `ink` 는 tokens.css 의 섹션 테마 5값 중 어두운 앵커다.
    /* `mono` 는 이 트리 전체를 검정·흰색으로 잠근다. 랜딩이 사진 패널로 바뀐 뒤
       하위 페이지만 시그널(청록)을 쓰면 링크 하나 눌렀을 뿐인데 다른 사이트로 넘어간 것처럼 읽힌다. */
    <section className={styles.page} data-section-theme="ink" data-palette="mono">
      <RevealNoScript />
      <div className="container">
        <header className={styles.head}>
          <p className="eyebrow" lang="en">Fleet</p>
          <h1 lang="en">Rockets</h1>
          <p className={styles.lede}>
            ICAROS가 직접 설계·제작하고 발사한 기체입니다. 카드를 선택하면 제원과 엔진 구성을 볼 수 있습니다.
          </p>
        </header>

        {/* Suspense 경계를 두지 않는다.
            경계가 실제로 지연되면 React 가 fallback 을 DOM 으로 먼저 내보내고 완료 스크립트($RC)로
            교체하는데, 그러면 JS 없는 클라이언트·크롤러에게는 스켈레톤만 남는다.
            실측에서 로컬 DB 인데도 8회 중 4회가 그랬다.
            더 나쁜 건 SeriesTabs 가 경계 안에 있으면 **시리즈 B 로 가는 유일한 내비게이션**까지
            사라진다는 것이다 — 방금 generateMetadata 로 시리즈별 canonical 을 나눠 놓은 것과 모순된다.
            이 페이지는 force-dynamic 이고 로켓 4기짜리 쿼리 2개라 스트리밍으로 얻을 게 없다. */}
        <RocketFleet series={series} />
      </div>
    </section>
  )
}

async function RocketFleet({ series }: { series: RocketSeries }) {
  const [rockets, counts] = await Promise.all([
    listRocketsBySeries(series),
    countRocketsBySeries(),
  ])

  return (
    <>
      <SeriesTabs active={series} counts={counts} />

      {rockets.length === 0 ? (
        <p className={styles.empty}>
          {seriesLabel(series)}에 공개된 기체가 아직 없습니다.
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

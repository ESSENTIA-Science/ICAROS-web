import type { Metadata } from 'next'
import InView from '@/components/rocket/InView'
import Prose from '@/components/rocket/Prose'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import RocketCard from '@/components/rocket/RocketCard'
import TabNav from '@/components/rocket/TabNav'
import {
  parseSeries,
  parseVehicleType,
  seriesLabel,
  seriesOfType,
  typeLabel,
  vehiclesHref,
  type RocketSeries,
  type VehicleSeriesOption,
  type VehicleTaxonomy,
  type VehicleType,
} from '@/components/rocket/series'
import { listRocketsBySeries, listVehicleTaxonomy } from './_data'
import styles from './page.module.css'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * **빌드가 DB 도달성을 요구하지 않게 한다.**
 *
 * 이 선언이 없으면 Next 가 빌드 시점에 이 페이지를 한 번 프리렌더해 보고, 그 안의 DB 조회가
 * 그대로 나간다. 실측: `DATABASE_URL` 을 죽은 포트로 두면 `next build` 가
 * `Error occurred prerendering page "/vehicles"` → `ECONNREFUSED` 로 죽는다.
 *
 * 프리렌더 결과는 어차피 버려진다 — 이 페이지는 `searchParams` 를 읽어 요청마다 내용이 달라진다.
 * 즉 **아무 이득 없이 배포 빌드가 DB 를 필수 의존성으로 갖게 된다.** 빌드 환경에서 RDS 에
 * 닿지 못하는 순간(네트워크·자격증명·정책 어느 것이든) 배포 자체가 실패한다.
 *
 * ─── ISR 전환을 시도했고, 되돌렸다 (2026-09-06, 라우트가 `/rocket` 이던 시절) ───────────
 * 무효화 배선은 충분하다(`rockets.ts`·`rocket-series.ts`·`scene.ts` 가 `revalidatePath`).
 * 막은 것은 **`searchParams` 다.** 이 라우트는 `?type=`·`?series=` 를 읽고, 정적 생성 중
 * `await searchParams` 는 동적 렌더로 빠진다 — `revalidate` 를 무엇으로 두든 빌드 표에서
 * `ƒ (Dynamic)` 이다(실측). 게다가 `generateMetadata` 가 **searchParams 를 await 하기 전에**
 * 택소노미를 읽으므로 그 동적 탈출이 일어나기 전에 DB 왕복이 먼저 나간다 — 죽은 포트 빌드에서
 * 그대로 실패한다. `[slug]` 쪽에 쓴 `generateStaticParams(): []` 우회는 동적 세그먼트가 없는
 * 여기에는 쓸 수 없다.
 *
 * **`/rocket` → `/vehicles` 개편은 이 사정을 바꾸지 않았다.** 분류를 경로 세그먼트로 올리면
 * 캐시 대상이 되지만, `/vehicles/[type]` 과 `/vehicles/[slug]` 가 같은 자리에서 충돌한다.
 * 성능은 개편 전과 같다.
 */
export const dynamic = 'force-dynamic'

/** 분류·시리즈를 한 번에 읽고 쿼리스트링을 검증한다. 메타데이터와 본문이 같은 판정을 쓰도록. */
async function resolve(searchParams: SearchParams): Promise<{
  tax: VehicleTaxonomy
  typeId: VehicleType | null
  seriesId: RocketSeries | null
  inType: VehicleSeriesOption[]
}> {
  const tax = await listVehicleTaxonomy()
  const sp = await searchParams
  const typeId = parseVehicleType(sp['type'], sp['series'], tax)
  const inType = seriesOfType(typeId, tax.series)
  return { tax, typeId, seriesId: parseSeries(sp['series'], inType), inType }
}

/**
 * 분류·시리즈는 쿼리스트링에 있고 목록 내용이 통째로 달라진다 — 두 조합이 같은 title·canonical 을
 * 들고 있으면 검색엔진이 한쪽을 중복으로 접는다. 기본 조합만 `/vehicles` 를 canonical 로 쓴다.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams
}): Promise<Metadata> {
  const { tax, typeId, seriesId, inType } = await resolve(searchParams)

  // 분류가 하나도 없으면 목록 자체가 빈 화면이다. 그때는 분류 없는 메타데이터를 낸다.
  if (typeId === null) {
    return {
      title: 'Vehicles',
      description: 'ICAROS가 설계·제작한 기체.',
      alternates: { canonical: '/vehicles' },
    }
  }

  const label =
    seriesId === null
      ? typeLabel(typeId, tax.types)
      : `${typeLabel(typeId, tax.types)} · ${seriesLabel(seriesId, inType)}`
  const canonical = vehiclesHref(typeId, seriesId, tax)

  return {
    title: `Vehicles · ${label}`,
    description: `ICAROS가 설계·제작한 ${label} 기체의 제원과 구성.`,
    alternates: { canonical },
    openGraph: { title: `Vehicles · ${label} · ICAROS`, url: canonical },
  }
}

export default async function VehiclesIndexPage({ searchParams }: { searchParams: SearchParams }) {
  const { tax, typeId, seriesId, inType } = await resolve(searchParams)

  return (
    // 기체 렌더가 밝은 회색 실루엣이라 어두운 면 위에서만 형태가 선다.
    // `ink` 는 tokens.css 의 섹션 테마 5값 중 어두운 앵커다.
    /* `mono` 는 이 트리 전체를 검정·흰색으로 잠근다. 랜딩이 사진 패널로 바뀐 뒤
       하위 페이지만 시그널(청록)을 쓰면 링크 하나 눌렀을 뿐인데 다른 사이트로 넘어간 것처럼 읽힌다. */
    <section className={styles.page} data-section-theme="ink" data-palette="mono">
      <RevealNoScript />
      <div className="container">
        <header className={styles.head}>
          <h1 lang="en">Vehicles</h1>
          <p className={styles.lede}>
            ICAROS가 직접 설계·제작하고 시험한 기체입니다.
          </p>
        </header>

        {/* Suspense 경계를 두지 않는다.
            경계가 실제로 지연되면 React 가 fallback 을 DOM 으로 먼저 내보내고 완료 스크립트($RC)로
            교체하는데, 그러면 JS 없는 클라이언트·크롤러에게는 스켈레톤만 남는다.
            실측에서 로컬 DB 인데도 8회 중 4회가 그랬다.
            더 나쁜 건 탭이 경계 안에 있으면 **다른 분류·시리즈로 가는 유일한 내비게이션**까지
            사라진다는 것이다 — 방금 generateMetadata 로 조합별 canonical 을 나눠 놓은 것과 모순된다.
            이 페이지는 force-dynamic 이고 쿼리 3개라 스트리밍으로 얻을 게 없다. */}
        {typeId === null ? (
          <p className={styles.empty}>등록된 분류가 없습니다.</p>
        ) : (
          <>
            <TabNav
              level="primary"
              label="기체 분류"
              active={typeId}
              items={tax.types.map((t) => ({
                id: t.id,
                label: t.label,
                // 분류를 바꾸면 시리즈는 그 분류의 첫 번째로 간다 — 남은 ?series= 를 들고 가면
                // 존재하지 않는 조합이 되고, parseSeries 가 어차피 되돌린다.
                href: vehiclesHref(t.id, null, tax),
              }))}
            />

            {seriesId === null ? (
              <p className={styles.empty}>
                {typeLabel(typeId, tax.types)}에 등록된 시리즈가 아직 없습니다.
              </p>
            ) : (
              <VehicleFleet tax={tax} typeId={typeId} seriesId={seriesId} inType={inType} />
            )}
          </>
        )}
      </div>
    </section>
  )
}

async function VehicleFleet({
  tax,
  typeId,
  seriesId,
  inType,
}: {
  tax: VehicleTaxonomy
  typeId: VehicleType
  seriesId: RocketSeries
  inType: readonly VehicleSeriesOption[]
}) {
  const rockets = await listRocketsBySeries(seriesId)
  const description = inType.find((s) => s.id === seriesId)?.descriptionMd?.trim()

  return (
    <>
      <TabNav
        level="secondary"
        label={`${typeLabel(typeId, tax.types)} 시리즈`}
        active={seriesId}
        items={inType.map((s) => ({
          id: s.id,
          label: s.label,
          href: vehiclesHref(typeId, s.id, tax),
        }))}
      />

      {/* 시리즈 설명은 탭 바로 아래·격자 위다. 리빌로 감싸지 않는다 — 접힌 화면 맨 위라
          거의 항상 처음부터 보이고, 그 자리에서 뜨는 애니메이션은 탭을 누른 직후의
          내용 교체를 늦게 보이게만 한다. 값이 없으면(대부분의 시리즈) 아무것도 그리지 않는다. */}
      {description ? (
        <div className={styles.intro}>
          <Prose markdown={description} />
        </div>
      ) : null}

      {rockets.length === 0 ? (
        <p className={styles.empty}>
          {seriesLabel(seriesId, inType)}에 공개된 기체가 아직 없습니다.
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

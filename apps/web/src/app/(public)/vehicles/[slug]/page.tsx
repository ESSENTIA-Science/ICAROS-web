import { getVehicleSpecs, vehicleSpecFacts } from '@/lib/vehicle-specs'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import EngineTable from '@/components/rocket/EngineTable'
import MediaImage from '@/components/rocket/MediaImage'
import ModelStage from '@/components/rocket/ModelStage'
import VehicleGallery from '@/components/rocket/VehicleGallery'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import Prose from '@/components/rocket/Prose'
import SpecList from '@/components/rocket/SpecList'
import { typeLabel, vehiclesHref } from '@/components/rocket/series'
import { textLang } from '@/components/landing/text-lang'
import { getRocket, listVehicleTaxonomy } from '../_data'
import { getSnapshot } from '@/lib/content/snapshot'
import { pageMetadata } from '@/lib/seo'
import styles from './page.module.css'

type Params = { slug: string }

/** Build every published vehicle path from the pinned snapshot. */
export const dynamicParams = true
export const revalidate = 3600
export function generateStaticParams(): { slug: string }[] {
  const vehicles = getSnapshot().vehicles
  return vehicles.map((vehicle) => ({ slug: vehicle.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const rocket = await getRocket(slug)
  if (!rocket) return { title: '기체를 찾을 수 없습니다' }

  const facts = vehicleSpecFacts(rocket)

  const description =
    facts.length > 0
      ? `${rocket.name} — ${facts.join(' · ')}. ICAROS ${rocket.seriesLabel}.`
      : `${rocket.name} — ICAROS ${rocket.seriesLabel}.`

  return pageMetadata({ title: rocket.name, description, path: `/vehicles/${rocket.slug}`, image: rocket.imageSrc })
}

export default async function VehicleDetailPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const rocket = await getRocket(slug)
  // notFound() 는 이 컴포넌트가 직접 await 한 뒤에 던져야 한다. 이 위(또는 이 안)에 Suspense
  // 경계가 생기면 Next 16 이 fallback shell 을 먼저 흘려보내 상태 코드가 200 으로 굳는다(soft 404).
  // 이 라우트에 loading.tsx 를 만들거나 이 호출을 Suspense 로 감싸지 말 것.
  if (!rocket) notFound()

  // 뒤로가기는 **이 기체가 실제로 서 있는 탭**으로 돌아간다 — 분류·시리즈 둘 다 맞춰야 한다.
  // 기본 조합이면 쿼리를 붙이지 않는다(목록 페이지의 canonical 과 같은 규칙).
  const tax = await listVehicleTaxonomy()
  const backHref = vehiclesHref(rocket.typeId, rocket.series, tax)
  // 분류 라벨을 아이브로에 함께 세운다. 시리즈만으로는 위성인지 로켓인지 알 수 없다.
  const eyebrow =
    rocket.typeId === null
      ? rocket.seriesLabel
      : `${typeLabel(rocket.typeId, tax.types)} · ${rocket.seriesLabel}`
  const poster = rocket.imageSrc || rocket.model?.posterSrc ? (
    <MediaImage
      src={rocket.imageSrc ?? rocket.model?.posterSrc ?? ''}
      alt={`${rocket.name} 기체 외형`}
      sizes="(max-width: 899px) 62vw, 26rem"
      className={styles.img}
      preload
    />
  ) : (
    <span className={styles.noImage} aria-hidden="true" />
  )

  return (
    /* 섹션은 하나다. 예전엔 히어로(ink) + 상세(paper) 둘이었지만 `mono` 아래에서는
       두 면이 같은 검정이라 경계가 색으로 생기지 않았다 — 그 한 줄 괘선을 위해
       화면 하나를 더 쓰고 있었을 뿐이다. */
    <article data-palette="mono">
      <RevealNoScript />

      <section className={styles.sheet} data-section-theme="ink">
        <div className={`container ${styles.shell}`}>
          <Link href={backHref} className={styles.back}>
            <span aria-hidden="true">←</span> 기체 목록
          </Link>

          {/* DOM 순서 = 읽는 순서다: 기체 이름 → 그림 → 설명·제원·엔진.
              그림 열을 왼쪽에 세우는 것은 CSS 의 명시 배치가 한다. */}
          <div className={styles.grid}>
            <header className={styles.head}>
              {/* 라벨은 CMS 자유 텍스트다 — 언어를 값에서 판별한다 */}
              <p className="eyebrow" lang={textLang(eyebrow)}>{eyebrow}</p>
              {/* 기체명은 CMS 자유 텍스트다 — 언어를 값에서 판별한다 */}
              <h1 className={styles.title} lang={textLang(rocket.name)}>{rocket.name}</h1>
            </header>

            <div className={styles.aside}>
              {/* 모델이 있으면 포스터 위에 3D 뷰어를 올린다. 프레임 크기는 CSS 가 정한다. */}
              <div className={styles.stage} data-rocket-viewer={rocket.slug}>
                {rocket.model?.src ? (
                  <ModelStage src={rocket.model.src} label={rocket.name}>{poster}</ModelStage>
                ) : (
                  <div className={styles.poster}>{poster}</div>
                )}
              </div>
            </div>

            <div className={styles.main}>
              {rocket.descriptionMd ? (
                <InView block className={styles.overviewBlock}>
                  <h2 className={styles.blockTitle} lang="en">Overview</h2>
                  <Prose markdown={rocket.descriptionMd} className={styles.overviewProse} />
                </InView>
              ) : null}

              {getVehicleSpecs(rocket).length > 0 ? <InView block className={styles.block}>
                <h2 className={styles.blockTitle} lang="en">Specifications</h2>
                <SpecList {...rocket} />
              </InView> : null}

              <InView block className={styles.block}>
                <h2 className={styles.blockTitle} lang="en">Propulsion</h2>
                {/* slug 는 PK 라 한 문서에 같은 값이 두 번 나올 수 없다 — 캡션 id 를 여기서 유일하게 만든다 */}
                <EngineTable engines={rocket.engines} scopeId={rocket.slug} />
              </InView>
            </div>
          </div>
          {rocket.gallery?.length ? <section className={styles.gallery} aria-label={`${rocket.name} 사진`}>
            <h2 className={styles.blockTitle}>Gallery</h2>
            <VehicleGallery images={rocket.gallery} label={rocket.name} />
          </section> : null}
        </div>
      </section>
    </article>
  )
}

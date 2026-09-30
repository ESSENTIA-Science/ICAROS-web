import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import EngineTable from '@/components/rocket/EngineTable'
import MediaImage from '@/components/rocket/MediaImage'
import ModelPreview from '@/components/rocket/ModelPreview'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import Prose from '@/components/rocket/Prose'
import ScrollRegion from '@/components/rocket/ScrollRegion'
import SpecList from '@/components/rocket/SpecList'
import { typeLabel, vehiclesHref } from '@/components/rocket/series'
import { textLang } from '@/components/landing/text-lang'
import { getRocket, listVehicleTaxonomy } from '../_data'
import { getSnapshot } from '@/lib/content/snapshot'
import styles from './page.module.css'

type Params = { slug: string }

/** Build every published vehicle path from the pinned snapshot. */
export const dynamicParams = false
export function generateStaticParams(): { slug: string }[] {
  return getSnapshot().vehicles.map((vehicle) => ({ slug: vehicle.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const rocket = await getRocket(slug)
  if (!rocket) return { title: '기체를 찾을 수 없습니다' }

  const facts = [
    rocket.maxAltitudeM ? `최대 고도 ${rocket.maxAltitudeM}m` : null,
    rocket.sizeM ? `길이 ${rocket.sizeM}m` : null,
    rocket.payloadKg ? `페이로드 ${rocket.payloadKg}kg` : null,
  ].filter((v): v is string => v !== null)

  const description =
    facts.length > 0
      ? `${rocket.name} — ${facts.join(' · ')}. ICAROS ${rocket.seriesLabel}.`
      : `${rocket.name} — ICAROS ${rocket.seriesLabel}.`

  return {
    title: rocket.name,
    description,
    alternates: { canonical: `/vehicles/${rocket.slug}` },
    openGraph: {
      type: 'article',
      title: `${rocket.name} · ICAROS`,
      description,
      url: `/vehicles/${rocket.slug}`,
      ...(rocket.imageSrc ? { images: [rocket.imageSrc] } : {}),
    },
  }
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
  // 설명 스크롤 영역의 이름을 제목에서 빌려 온다. slug 는 PK 라 한 문서에서 유일하다
  // (EngineTable 의 scopeId 와 같은 사정 — 서버 컴포넌트라 useId() 를 쓸 수 없다).
  const overviewId = `vehicle-${rocket.slug}-overview`

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

          {/* DOM 순서 = 읽는 순서다: 기체 이름 → 그림·제원 → 설명·엔진.
              그림 열을 왼쪽에 세우는 것은 CSS 의 명시 배치가 하고 마크업은 건드리지 않는다.
              (제원이 h1 보다 먼저 읽히면 리더 모드·스크린리더에서 이름 없는 숫자가 먼저 온다.) */}
          <div className={styles.grid}>
            <header className={styles.head}>
              {/* 라벨은 CMS 자유 텍스트다 — 언어를 값에서 판별한다 */}
              <p className="eyebrow" lang={textLang(eyebrow)}>{eyebrow}</p>
              {/* 기체명은 CMS 자유 텍스트다 — 언어를 값에서 판별한다 */}
              <h1 className={styles.title} lang={textLang(rocket.name)}>{rocket.name}</h1>
            </header>

            <div className={styles.aside}>
              {/* 3D 뷰어 마운트 지점. 캔버스는 여기서 만들지 않는다 — 3d 트랙이 이 박스 안에
                  붙이고 [data-viewer-poster] 를 감춘다. 박스 크기는 CSS 가 정하므로
                  캔버스가 나중에 들어와도 열 높이가 바뀌지 않는다. */}
              <div className={styles.stage} data-rocket-viewer={rocket.slug}>
                <div className={styles.poster} data-viewer-poster="">
                  {rocket.imageSrc || rocket.model?.posterSrc ? (
                    <MediaImage
                      src={rocket.imageSrc ?? rocket.model?.posterSrc ?? ""}
                      alt={`${rocket.name} 기체 외형`}
                      sizes="(max-width: 899px) 62vw, 26rem"
                      className={styles.img}
                      preload
                    />
                  ) : (
                    <span className={styles.noImage} aria-hidden="true" />
                  )}
                </div>
              </div>

              {rocket.model?.src ? <ModelPreview src={rocket.model.src} label={rocket.name} /> : null}

              <div className={styles.specs}>
                <SpecList
                  maxAltitudeM={rocket.maxAltitudeM}
                  sizeM={rocket.sizeM}
                  payloadKg={rocket.payloadKg}
                />
              </div>
            </div>

            <div className={styles.main}>
              {rocket.descriptionMd ? (
                /* `.block` 을 함께 걸지 않는다 — 둘 다 `flex` 단축을 같은 특이도로 선언한다 */
                <InView block className={styles.flowBlock}>
                  <h2 id={overviewId} className={styles.blockTitle} lang="en">Overview</h2>
                  {/* 데스크톱에서는 이 상자만 스크롤한다. 스크롤이 **실제로 있을 때만**
                      포커스 가능해야 한다 — 데스크톱에서는 키보드로 잘린 본문에 도달할 수
                      있어야 하고(WCAG 2.1.1), 모바일 1열에서는 overflow 가 visible 이라
                      같은 tabIndex 가 아무것도 하지 않는 정지점이 된다. 뷰포트를 아는 쪽은
                      브라우저뿐이라 이 래퍼만 클라이언트다. */}
                  <ScrollRegion
                    className={styles.flow}
                    wrapClassName={styles.flowWrap}
                    hintClassName={styles.hint}
                    labelledBy={overviewId}
                    hint="↓ 아래로 더 있습니다"
                  >
                    <Prose markdown={rocket.descriptionMd} />
                  </ScrollRegion>
                </InView>
              ) : null}

              <InView block className={styles.block}>
                <h2 className={styles.blockTitle} lang="en">Propulsion</h2>
                {/* slug 는 PK 라 한 문서에 같은 값이 두 번 나올 수 없다 — 캡션 id 를 여기서 유일하게 만든다 */}
                <EngineTable engines={rocket.engines} scopeId={rocket.slug} />
              </InView>
            </div>
          </div>
          {rocket.gallery?.length ? <section className={styles.gallery} aria-label={`${rocket.name} 사진`}>
            <h2 className={styles.blockTitle}>Gallery</h2>
            <div className={styles.galleryGrid}>{rocket.gallery.map((image, index) =>
              <figure key={`${image.src}-${index}`} className={styles.galleryItem}>
                <MediaImage src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(max-width: 599px) 100vw, (max-width: 899px) 50vw, 33vw" className={styles.galleryImage} />
              </figure>
            )}</div>
          </section> : null}
        </div>
      </section>
    </article>
  )
}

import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import EngineTable from '@/components/rocket/EngineTable'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import RocketDescription from '@/components/rocket/RocketDescription'
import SpecList from '@/components/rocket/SpecList'
import { seriesLabel } from '@/components/rocket/series'
import { textLang } from '@/components/landing/text-lang'
import { getRocket, listPublishedRocketSlugs } from '../_data'
import styles from './page.module.css'

type Params = { slug: string }

/**
 * ISR 을 쓰지 않는다. published=false 전환이 revalidate 주기 동안(+stale-while-revalidate)
 * 상세에 그대로 노출돼 C8 을 깬다. 어드민이 revalidatePath 를 붙이기 전까지는
 * 요청 시각 렌더가 유일하게 올바른 동작이다 (04-architecture.md §Caching posture).
 */
export const dynamic = 'force-dynamic'

/** 공개 기체만 프리렌더한다. 목록에 없는 slug 도 요청은 오므로 아래에서 다시 막는다 (C8). */
export async function generateStaticParams(): Promise<Params[]> {
  const slugs = await listPublishedRocketSlugs()
  return slugs.map((slug) => ({ slug }))
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
      ? `${rocket.name} — ${facts.join(' · ')}. ICAROS ${seriesLabel(rocket.series)}.`
      : `${rocket.name} — ICAROS ${seriesLabel(rocket.series)}.`

  return {
    title: rocket.name,
    description,
    alternates: { canonical: `/rocket/${rocket.slug}` },
    openGraph: {
      type: 'article',
      title: `${rocket.name} · ICAROS`,
      description,
      url: `/rocket/${rocket.slug}`,
      ...(rocket.imageSrc ? { images: [rocket.imageSrc] } : {}),
    },
  }
}

export default async function RocketDetailPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const rocket = await getRocket(slug)
  // notFound() 는 이 컴포넌트가 직접 await 한 뒤에 던져야 한다. 이 위(또는 이 안)에 Suspense
  // 경계가 생기면 Next 16 이 fallback shell 을 먼저 흘려보내 상태 코드가 200 으로 굳는다(soft 404).
  // 이 라우트에 loading.tsx 를 만들거나 이 호출을 Suspense 로 감싸지 말 것.
  if (!rocket) notFound()

  const backHref = rocket.series === 'A' ? '/rocket' : `/rocket?series=${rocket.series}`

  return (
    <article>
      <RevealNoScript />

      <section className={styles.hero} data-section-theme="ink">
        <div className="container">
          <Link href={backHref} className={styles.back}>
            <span aria-hidden="true">←</span> 기체 목록
          </Link>

          <div className={styles.heroGrid}>
            {/* 3D 뷰어 마운트 지점. 캔버스는 여기서 만들지 않는다 — 3d 트랙이 이 박스 안에
                붙이고 [data-viewer-poster] 를 감춘다. 박스 크기는 CSS 가 고정하므로
                캔버스가 나중에 들어와도 히어로 높이가 바뀌지 않는다. */}
            <div className={styles.stage} data-rocket-viewer={rocket.slug}>
              <div className={styles.poster} data-viewer-poster="">
                {rocket.imageSrc ? (
                  <Image
                    src={rocket.imageSrc}
                    alt={`${rocket.name} 기체 외형`}
                    fill
                    sizes="(max-width: 899px) 62vw, 30rem"
                    className={styles.img}
                    priority
                  />
                ) : (
                  <span className={styles.noImage} aria-hidden="true" />
                )}
              </div>
            </div>

            <div className={styles.heroBody}>
              <p className="eyebrow" lang="en">{seriesLabel(rocket.series)}</p>
              {/* 기체명은 CMS 자유 텍스트다 — 언어를 값에서 판별한다 */}
              <h1 className={styles.title} lang={textLang(rocket.name)}>{rocket.name}</h1>
              <SpecList
                maxAltitudeM={rocket.maxAltitudeM}
                sizeM={rocket.sizeM}
                payloadKg={rocket.payloadKg}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.detail} data-section-theme="paper">
        <div className="container">
          {rocket.descriptionMd ? (
            <InView block className={styles.block}>
              <h2 className={styles.blockTitle} lang="en">Overview</h2>
              <RocketDescription markdown={rocket.descriptionMd} />
            </InView>
          ) : null}

          <InView block className={styles.block}>
            <h2 className={styles.blockTitle} lang="en">Propulsion</h2>
            {/* slug 는 PK 라 한 문서에 같은 값이 두 번 나올 수 없다 — 캡션 id 를 여기서 유일하게 만든다 */}
            <EngineTable engines={rocket.engines} scopeId={rocket.slug} />
          </InView>
        </div>
      </section>
    </article>
  )
}

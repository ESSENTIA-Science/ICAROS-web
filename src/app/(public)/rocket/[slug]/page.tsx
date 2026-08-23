import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import EngineTable from '@/components/rocket/EngineTable'
import RocketDescription from '@/components/rocket/RocketDescription'
import SpecList from '@/components/rocket/SpecList'
import { seriesLabel } from '@/components/rocket/series'
import { getRocket, listPublishedRocketSlugs } from '../_data'
import styles from './page.module.css'

type Params = { slug: string }

/**
 * 전 기체를 빌드 시점에 프리렌더한다. 그대로 두면 CMS 수정이 재배포 전까지 반영되지 않으므로
 * 5분 상한을 둔다 — 관리 콘솔의 Server Action 이 `revalidatePath` 를 호출하면 즉시 갱신되고,
 * 그 배선이 빠지더라도 최대 5분 뒤에는 맞춰진다.
 */
// ISR 을 쓰지 않는다. published=false 전환이 최대 5분(+stale-while-revalidate) 동안
// 상세/명단에 그대로 노출돼 C8·E5 를 깬다. 어드민이 revalidatePath 를 붙이기 전까지는
// 요청 시각 렌더가 유일하게 올바른 동작이다 (04-architecture.md §Caching posture).
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
  // 알려진 제약: 상위에 loading.tsx(=Suspense 경계)가 있으면 Next 16 이 fallback shell 을
  // 먼저 흘려보내 상태 코드가 200 으로 확정된다. 404 화면은 정상적으로 뜨지만 HTTP 상태는 soft 404 다.
  // 앱 전역 `src/app/loading.tsx` 가 이미 그 경계라서 이 파일 안에서는 해소할 수 없다.
  if (!rocket) notFound()

  const backHref = rocket.series === 'A' ? '/rocket' : `/rocket?series=${rocket.series}`

  return (
    <article>
      <section className={styles.hero} data-theme="dark">
        <div className="container">
          <Link href={backHref} className={styles.back}>
            <span aria-hidden="true">←</span> 기체 목록
          </Link>

          <div className={styles.heroGrid}>
            <div className={styles.figure}>
              {rocket.imageSrc ? (
                <Image
                  src={rocket.imageSrc}
                  alt={`${rocket.name} 기체 외형`}
                  fill
                  sizes="(max-width: 899px) 90vw, 40rem"
                  className={styles.img}
                  priority
                />
              ) : (
                <span className={styles.noImage} aria-hidden="true" />
              )}
            </div>

            <div className={styles.heroBody}>
              <p className="eyebrow" lang="en">{seriesLabel(rocket.series)}</p>
              <h1 className={styles.title} lang="en">{rocket.name}</h1>
              <SpecList
                maxAltitudeM={rocket.maxAltitudeM}
                sizeM={rocket.sizeM}
                payloadKg={rocket.payloadKg}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.detail}>
        <div className="container">
          {rocket.descriptionMd ? (
            <div className={styles.block}>
              <h2 className={styles.blockTitle} lang="en">Overview</h2>
              <RocketDescription markdown={rocket.descriptionMd} />
            </div>
          ) : null}

          <div className={styles.block}>
            <h2 className={styles.blockTitle} lang="en">Propulsion</h2>
            <EngineTable engines={rocket.engines} />
          </div>
        </div>
      </section>
    </article>
  )
}

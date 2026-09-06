import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import EngineTable from '@/components/rocket/EngineTable'
import InView from '@/components/rocket/InView'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import Prose from '@/components/rocket/Prose'
import ScrollRegion from '@/components/rocket/ScrollRegion'
import SpecList from '@/components/rocket/SpecList'
import { typeLabel, vehiclesHref } from '@/components/rocket/series'
import { textLang } from '@/components/landing/text-lang'
import { getRocket, listVehicleTaxonomy } from '../_data'
import styles from './page.module.css'

type Params = { slug: string }

/**
 * **온디맨드 무효화 전용 ISR.** 시간 기반이 아니다 — `revalidate = false` 는 "만료되지 않는다"는
 * 뜻이고, 캐시를 비우는 주체는 오직 `revalidatePath` 다.
 *
 * 예전 주석은 "ISR 을 쓰지 않는다 — published=false 가 revalidate 주기 동안 노출돼 C8 을 깬다.
 * 어드민이 revalidatePath 를 붙이기 전까지는"이라고 적혀 있었다. **그 전제가 이제 성립하지 않는다.**
 * `_actions/rockets.ts`·`rocket-series.ts`·`scene.ts` 세 파일이 모든 mutation 끝에
 * `revalidatePath('/vehicles/[slug]', 'page')` 를 부른다(= 이 라우트의 모든 slug 를 한 번에 비운다).
 * 공개 여부가 바뀌는 경로가 전부 그 셋을 지나므로 노출 창(window)이 0이다.
 * CLAUDE.md 지뢰 "ISR 로 공개 여부를 감싸지 말 것"이 경고한 것은 **시간 기반** revalidate 다.
 */
export const revalidate = false

/**
 * **빈 배열을 반환하는 `generateStaticParams` 가 이 라우트를 캐시 대상으로 만든다.**
 *
 * 실측(2026-09-06, `next build` 라우트 표): 이 함수가 없으면 `revalidate` 를 무엇으로 두든
 * 라우트가 `ƒ (Dynamic)` 으로 남아 **엣지 캐시가 0** 이다. 빈 배열을 반환하면 `● (SSG)` 가 되고,
 * 목록에 없는 slug 는 첫 요청에 렌더돼 ISR 캐시에 들어간다(`dynamicParams` 기본값 true).
 *
 * 빈 배열이라는 점이 핵심이다 — 예전 주석이 경고한 "빌드 시점에 DB 를 친다"는 **slug 를 DB 에서
 * 읽어 오는 구현**의 이야기다. 여기서는 DB 를 치지 않으므로 프리렌더되는 페이지가 0개인 것은
 * 그대로이고, 죽은 포트 빌드(`DATABASE_URL` → 127.0.0.1:1)도 그대로 통과한다.
 * **이 함수 안에서 DB 를 읽지 말 것.** 읽는 순간 배포 빌드가 RDS 도달성을 필수로 요구하게 된다.
 */
export function generateStaticParams(): { slug: string }[] {
  return []
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
                  {rocket.imageSrc ? (
                    <Image
                      src={rocket.imageSrc}
                      alt={`${rocket.name} 기체 외형`}
                      fill
                      sizes="(max-width: 899px) 62vw, 26rem"
                      className={styles.img}
                      priority
                    />
                  ) : (
                    <span className={styles.noImage} aria-hidden="true" />
                  )}
                </div>
              </div>

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
        </div>
      </section>
    </article>
  )
}

import type { Metadata } from 'next'
import RocketCard from '@/components/rocket/RocketCard'
import SeriesTabs from '@/components/rocket/SeriesTabs'
import { parseSeries, seriesLabel } from '@/components/rocket/series'
import { countRocketsBySeries, listRocketsBySeries } from './_data'
import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'Rockets',
  description: 'ICAROS가 설계·제작한 발사체 ICX 1/2 시리즈와 ICX MV 시리즈의 제원과 엔진 구성.',
  alternates: { canonical: '/rocket' },
}

export default async function RocketIndexPage({
  searchParams,
}: {
  // Next 16 에서 searchParams 는 Promise 다.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const series = parseSeries((await searchParams).series)
  const [rockets, counts] = await Promise.all([
    listRocketsBySeries(series),
    countRocketsBySeries(),
  ])

  return (
    <section className={styles.page} data-theme="dark">
      <div className="container">
        <header className={styles.head}>
          <p className="eyebrow" lang="en">Fleet</p>
          <h1 lang="en">Rockets</h1>
          <p className={styles.lede}>
            ICAROS가 직접 설계·제작하고 발사한 기체입니다. 카드를 선택하면 제원과 엔진 구성을 볼 수 있습니다.
          </p>
        </header>

        <SeriesTabs active={series} counts={counts} />

        {rockets.length === 0 ? (
          <p className={styles.empty}>
            {seriesLabel(series)}에 공개된 기체가 아직 없습니다.
          </p>
        ) : (
          <ul className={styles.grid}>
            {rockets.map((r) => (
              <RocketCard key={r.slug} rocket={r} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

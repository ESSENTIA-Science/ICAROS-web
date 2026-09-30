import InView from '@/components/rocket/InView'
import Prose from '@/components/rocket/Prose'
import RevealNoScript from '@/components/rocket/RevealNoScript'
import RocketCard from '@/components/rocket/RocketCard'
import TabNav from '@/components/rocket/TabNav'
import {
  seriesLabel,
  seriesOfType,
  typeLabel,
  vehicleTypeHref,
  vehiclesHref,
} from '@/components/rocket/series'
import { getSnapshot } from '@/lib/content/snapshot'
import styles from './page.module.css'

/** Shared markup for the default, type, and series static HTML paths. */
export default function VehiclesListing({ typeId, seriesId }: { typeId: string | null; seriesId: string | null }) {
  const { taxonomy, vehicles } = getSnapshot()
  const inType = seriesOfType(typeId, taxonomy.series)
  const selectedSeries = seriesId ?? inType[0]?.id ?? null
  const selected = vehicles.filter((vehicle) => vehicle.series === selectedSeries)
  const description = inType.find((series) => series.id === selectedSeries)?.descriptionMd?.trim()

  return <section className={styles.page} data-section-theme="ink" data-palette="mono">
    <RevealNoScript />
    <div className="container">
      <header className={styles.head}>
        <h1 lang="en">Vehicles</h1>
        <p className={styles.lede}>ICAROS가 직접 설계·제작하고 시험한 기체입니다.</p>
      </header>

      {typeId === null ? <p className={styles.empty}>등록된 분류가 없습니다.</p> : <>
        <TabNav level="primary" label="기체 분류" active={typeId}
          items={taxonomy.types.map((type) => ({
            id: type.id, label: type.label, href: vehicleTypeHref(type.id, taxonomy),
          }))} />

        {selectedSeries === null ? <p className={styles.empty}>
          {typeLabel(typeId, taxonomy.types)}에 등록된 시리즈가 아직 없습니다.
        </p> : <>
          <TabNav level="secondary" label={`${typeLabel(typeId, taxonomy.types)} 시리즈`}
            active={selectedSeries}
            items={inType.map((series) => ({
              id: series.id, label: series.label, href: vehiclesHref(typeId, series.id, taxonomy),
            }))} />
          {description ? <div className={styles.intro}><Prose markdown={description} /></div> : null}
          {selected.length === 0 ? <p className={styles.empty}>
            {seriesLabel(selectedSeries, inType)}에 공개된 기체가 아직 없습니다.
          </p> : <InView>
            <ul className={styles.grid}>{selected.map((vehicle) =>
              <RocketCard key={vehicle.slug} rocket={vehicle} />)}</ul>
          </InView>}
        </>}
      </>}
    </div>
  </section>
}

import { textLang } from '@/components/landing/text-lang'
import { getVehicleSpecs, type VehicleSpecSource } from '@/lib/vehicle-specs'
import styles from './SpecList.module.css'

/** Shared snapshot fallback keeps explicitly removed specs empty. */
export default function SpecList(vehicle: VehicleSpecSource) {
  const specs = getVehicleSpecs(vehicle)
  if (specs.length === 0) return null

  return (
    <dl className={styles.list} data-columns={specs.length > 3 ? 2 : 1}>
      {specs.map((s, index) => (
        <div key={index} className={styles.row}>
          <dt className="eyebrow" lang={textLang(s.label)}>{s.label}</dt>
          <dd className={styles.value}>
            {s.value == null ? (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">값 없음</span>
              </>
            ) : (
              <>
                <span className={`${styles.num} num`} lang={textLang(s.value)}>{s.value}</span>
                <span className={styles.unit}>{s.unit}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

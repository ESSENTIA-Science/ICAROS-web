import styles from './SpecList.module.css'

type Spec = { label: string; value: string | null; unit: string }

/**
 * 상세 페이지의 제원 블록. 기술 문서 조판을 따른다 —
 * 한 행 = 라벨(작은 기술 레지스터) + 값(tabular-nums) + 단위, 행마다 1px 규칙선.
 *
 * 값이 없을 때 행을 지우지 않고 `—` 로 남긴다 — 행이 사라지면 읽는 쪽에서
 * "측정 안 함"과 "0"을 구분할 수 없다. 스크린리더에는 문구로 읽힌다.
 */
export default function SpecList({
  maxAltitudeM,
  sizeM,
  payloadKg,
}: {
  maxAltitudeM: string | null
  sizeM: string | null
  payloadKg: string | null
}) {
  const specs: Spec[] = [
    { label: '최대 고도', value: maxAltitudeM, unit: 'm' },
    { label: '길이', value: sizeM, unit: 'm' },
    { label: '페이로드', value: payloadKg, unit: 'kg' },
  ]

  return (
    <dl className={styles.list}>
      {specs.map((s) => (
        <div key={s.label} className={styles.row}>
          <dt className="eyebrow">{s.label}</dt>
          <dd className={styles.value}>
            {s.value == null ? (
              <>
                <span aria-hidden="true">—</span>
                <span className="sr-only">값 없음</span>
              </>
            ) : (
              <>
                <span className={`${styles.num} num`}>{s.value}</span>
                <span className={styles.unit}>{s.unit}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

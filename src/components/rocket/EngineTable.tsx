import type { RocketEngineDto } from '@/app/(public)/rocket/_data'
import styles from './EngineTable.module.css'

/**
 * `mode` 는 현재 전 행이 비어 있다. 값이 하나도 없으면 열 자체를 빼서
 * `—` 로만 채워진 빈 열이 표를 넓히지 않게 한다.
 */
export default function EngineTable({ engines }: { engines: readonly RocketEngineDto[] }) {
  if (engines.length === 0) {
    return <p className={styles.empty}>등록된 엔진 정보가 없습니다.</p>
  }

  const hasMode = engines.some((e) => e.mode != null)

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className="sr-only">엔진 구성</caption>
        <thead>
          <tr>
            <th scope="col">형식</th>
            <th scope="col" className={styles.numCol}>추력</th>
            <th scope="col" className={styles.numCol}>연소 시간</th>
            <th scope="col" className={styles.numCol}>수량</th>
            {hasMode ? <th scope="col">모드</th> : null}
          </tr>
        </thead>
        <tbody>
          {engines.map((e) => (
            <tr key={e.id}>
              <th scope="row" className={styles.type} lang="en">{e.type}</th>
              <td className={styles.numCol}>
                {e.thrustN ? <><span className="num">{e.thrustN}</span> N</> : <Dash />}
              </td>
              <td className={styles.numCol}>
                {e.burnTimeS ? <><span className="num">{e.burnTimeS}</span> s</> : <Dash />}
              </td>
              <td className={styles.numCol}>
                <span className="num">{e.count}</span>
              </td>
              {hasMode ? <td>{e.mode ?? <Dash />}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Dash() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">값 없음</span>
    </>
  )
}

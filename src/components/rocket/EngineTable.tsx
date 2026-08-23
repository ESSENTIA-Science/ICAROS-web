import type { RocketEngineDto } from '@/app/(public)/rocket/_data'
import { textLang } from '@/components/landing/text-lang'
import styles from './EngineTable.module.css'

/** 스크롤 영역 이름을 표 캡션에서 빌려 온다 — 문구가 갈라지지 않게 id 하나로 묶는다. */
const CAPTION_ID = 'engine-table-caption'

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
    // 표가 min-width 48rem 이라 375px 에서 가로로 잘린다. tabindex 로 스크롤 컨테이너 자체를
    // 포커스 가능하게 만들지 않으면 키보드만 쓰는 사람이 잘린 열에 도달할 수 없다 (WCAG 2.1.1).
    // role=region + 이름이 있어야 그 포커스 정지점이 무엇인지 스크린리더가 말해 준다.
    <div className={styles.scroll} role="region" aria-labelledby={CAPTION_ID} tabIndex={0}>
      <table className={styles.table}>
        <caption id={CAPTION_ID} className="sr-only">
          엔진 구성
        </caption>
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
              {/* 엔진 형식은 CMS 자유 텍스트다 — 언어를 값에서 판별한다 */}
              <th scope="row" className={styles.type} lang={textLang(e.type)}>{e.type}</th>
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

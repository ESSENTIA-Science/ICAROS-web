import type { RocketEngineDto } from '@/app/(public)/rocket/_data'
import { textLang } from '@/components/landing/text-lang'
import styles from './EngineTable.module.css'

/**
 * `mode` 는 현재 전 행이 비어 있다. 값이 하나도 없으면 열 자체를 빼서
 * `—` 로만 채워진 빈 열이 표를 넓히지 않게 한다.
 *
 * `scopeId` 는 캡션 id 를 문서 안에서 유일하게 만들기 위한 값이다. 모듈 상수로 박아 두면
 * 한 페이지에 표가 둘 이상일 때 id 가 중복되고, `aria-labelledby` 가 **먼저 나온 다른 표의
 * 캡션**을 가리킨다 — 이름이 없는 것보다 나쁘다. 서버 컴포넌트라 `useId()` 를 쓸 수 없어
 * 호출부가 유일한 값(로켓 slug)을 넘긴다.
 */
export default function EngineTable({
  engines,
  scopeId,
}: {
  engines: readonly RocketEngineDto[]
  scopeId: string
}) {
  if (engines.length === 0) {
    return <p className={styles.empty}>등록된 엔진 정보가 없습니다.</p>
  }

  const hasMode = engines.some((e) => e.mode != null)
  /** 스크롤 영역 이름을 표 캡션에서 빌려 온다 — 문구가 갈라지지 않게 id 하나로 묶는다. */
  const captionId = `engine-table-${scopeId}-caption`

  return (
    // 표가 좁은 화면에서 가로로 잘린다. tabindex 로 스크롤 컨테이너 자체를 포커스 가능하게
    // 만들지 않으면 키보드만 쓰는 사람이 잘린 열에 도달할 수 없다 (WCAG 2.1.1).
    // role=region + 이름이 있어야 그 포커스 정지점이 무엇인지 스크린리더가 말해 준다.
    <div className={styles.scroll} role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className={styles.table}>
        <caption id={captionId} className="sr-only">
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
              <Measure value={e.thrustN} unit="Ns" />
              <Measure value={e.burnTimeS} unit="s" />
              <Measure value={String(e.count)} unit={null} />
              {hasMode ? <td>{e.mode ?? <Dash />}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 숫자 폭을 문자수로 고정한 셀. 값을 오른쪽 정렬만 하면 '146 Ns' 와 '6.8 Ns' 의 단위는 붙지만
 * 자릿수가 어긋나 소수점이 흩어진다. 숫자만 고정폭 상자에 넣고 단위를 그 밖에 두면 둘 다 선다.
 */
function Measure({ value, unit }: { value: string | null; unit: string | null }) {
  return (
    <td className={styles.numCol}>
      {value == null ? (
        <Dash />
      ) : (
        <span className={styles.measure}>
          <span className={`${styles.num} num`}>{value}</span>
          {unit ? <span className={styles.unit}>{unit}</span> : null}
        </span>
      )}
    </td>
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

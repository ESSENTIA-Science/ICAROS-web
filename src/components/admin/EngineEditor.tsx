'use client'

import { useId, useState } from 'react'
import { TextField } from './Fields'
import ui from './ui.module.css'

export type EngineInit = {
  type: string
  thrustN: string
  burnTimeS: string
  count: number
  mode: string
}

type Draft = EngineInit & { key: string }

const MAX_ENGINES = 12

const BLANK: EngineInit = { type: '', thrustN: '', burnTimeS: '', count: 1, mode: '' }

/**
 * 엔진 목록 동적 편집 (F7).
 *
 * 입력은 **비제어**로 둔다 — 행 추가·삭제만 상태로 관리하고 값은 DOM 이 갖는다.
 * 그래야 서버 액션이 검증 오류로 되돌아와도 사용자가 친 값이 그대로 남는다.
 * 행 식별은 배열 인덱스가 아니라 생성 시각의 고유 키로 한다: 인덱스를 key 로 쓰면
 * 가운데 행을 지웠을 때 React 가 아래 행의 DOM 을 재사용해 값이 한 칸씩 밀린다.
 *
 * 이름은 전부 같다(`engine.type` 등). 서버는 평행 배열로 받아 순서대로 짝짓는다.
 */
export default function EngineEditor({
  initial,
  fieldErrors,
}: {
  initial: readonly EngineInit[]
  fieldErrors: Readonly<Record<string, string>>
}) {
  const idBase = useId()
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.map((e, i) => ({ ...e, key: `${idBase}-init-${i}` }))
  )
  const [seq, setSeq] = useState(0)

  function add(): void {
    if (drafts.length >= MAX_ENGINES) return
    setDrafts((prev) => [...prev, { ...BLANK, key: `${idBase}-new-${seq}` }])
    setSeq((n) => n + 1)
  }

  function remove(key: string): void {
    setDrafts((prev) => prev.filter((d) => d.key !== key))
  }

  return (
    <fieldset className={ui.fieldset}>
      <legend className={ui.legend} lang="en">
        Engines
      </legend>

      <p className={ui.hint}>
        추력·연소시간·연소방식은 비워 둘 수 있습니다. 비운 값은 공개 페이지에서 표시되지 않습니다.
      </p>

      {drafts.length === 0 ? (
        <p className={ui.empty}>등록된 엔진이 없습니다.</p>
      ) : (
        drafts.map((d, i) => {
          const rowId = `${idBase}-${d.key}`
          return (
            <div className={ui.engineRow} key={d.key}>
              <div className={ui.engineHead}>
                <span className={ui.engineIndex} lang="en">
                  Engine {String(i + 1).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => remove(d.key)}
                >
                  이 엔진 삭제
                </button>
              </div>

              <div className={ui.engineGrid}>
                <TextField
                  id={`${rowId}-type`}
                  name="engine.type"
                  label="종류"
                  defaultValue={d.type}
                  maxLength={80}
                  required
                  error={fieldErrors[`engine.${i}.type`]}
                />
                <TextField
                  id={`${rowId}-count`}
                  name="engine.count"
                  label="개수"
                  defaultValue={String(d.count)}
                  inputMode="numeric"
                  maxLength={4}
                  error={fieldErrors[`engine.${i}.count`]}
                />
                <TextField
                  id={`${rowId}-thrust`}
                  name="engine.thrustN"
                  label="추력 (N)"
                  defaultValue={d.thrustN}
                  inputMode="decimal"
                  maxLength={13}
                  error={fieldErrors[`engine.${i}.thrustN`]}
                />
                <TextField
                  id={`${rowId}-burn`}
                  name="engine.burnTimeS"
                  label="연소시간 (s)"
                  defaultValue={d.burnTimeS}
                  inputMode="decimal"
                  maxLength={13}
                  error={fieldErrors[`engine.${i}.burnTimeS`]}
                />
                <TextField
                  id={`${rowId}-mode`}
                  name="engine.mode"
                  label="연소 방식"
                  defaultValue={d.mode}
                  maxLength={80}
                  error={fieldErrors[`engine.${i}.mode`]}
                />
              </div>
            </div>
          )
        })
      )}

      <p className={ui.hint} aria-live="polite">
        {drafts.length} / {MAX_ENGINES}개
      </p>

      <button
        type="button"
        className={ui.btn}
        onClick={add}
        disabled={drafts.length >= MAX_ENGINES}
      >
        엔진 추가
      </button>

      <noscript>
        <p className={ui.hint}>
          JavaScript 가 꺼져 있어 엔진 행을 추가하거나 삭제할 수 없습니다. 기존 행의 값 수정과
          저장은 그대로 동작합니다.
        </p>
      </noscript>
    </fieldset>
  )
}

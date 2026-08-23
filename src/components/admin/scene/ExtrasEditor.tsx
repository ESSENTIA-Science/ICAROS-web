'use client'

import { useId, useState } from 'react'
import { SelectField, TextField } from '../Fields'
import ui from '../ui.module.css'
import {
  EXTRA_VALUE_MAX,
  EXTRA_VALUE_TYPES,
  EXTRA_VALUE_TYPE_LABELS,
  MAX_EXTRAS,
  type ExtraValueType,
} from './constants'
import css from './scene.module.css'

export type ExtraInit = { key: string; type: ExtraValueType; value: string }

type Draft = ExtraInit & { rowKey: string }

const BLANK: ExtraInit = { key: '', type: 'string', value: '' }

const TYPE_OPTIONS = EXTRA_VALUE_TYPES.map((t) => ({ value: t, label: EXTRA_VALUE_TYPE_LABELS[t] }))

/**
 * 확장 값 편집 (G13).
 *
 * 임의 JSON 텍스트 칸을 두지 않는 것이 요점이다 — 중첩과 임의 키를 허용하는 순간
 * "검증된 스키마만 저장한다"가 이름만 남는다. 여기서 만들 수 있는 것은
 * **키 → 스칼라 값** 한 겹뿐이고, 서버의 `extrasSchema` 가 같은 형태를 다시 못 박는다.
 */
export default function ExtrasEditor({
  initial,
  fieldErrors,
}: {
  initial: readonly ExtraInit[]
  fieldErrors: Readonly<Record<string, string>>
}) {
  const idBase = useId()
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.map((e, i) => ({ ...e, rowKey: `${idBase}-init-${i}` }))
  )
  const [seq, setSeq] = useState(0)

  function add(): void {
    if (drafts.length >= MAX_EXTRAS) return
    setDrafts((prev) => [...prev, { ...BLANK, rowKey: `${idBase}-new-${seq}` }])
    setSeq((n) => n + 1)
  }

  function remove(rowKey: string): void {
    setDrafts((prev) => prev.filter((d) => d.rowKey !== rowKey))
  }

  return (
    <fieldset className={ui.fieldset}>
      <legend className={ui.legend} lang="en">
        Extras
      </legend>

      <p className={ui.hint}>
        전용 항목이 없는 값을 임시로 붙여 두는 자리입니다. 한 겹 객체만 저장되고, 자주 쓰이게 되면 전용
        칸으로 승격하는 것이 맞습니다. 참/거짓은 <span className={ui.mono}>true</span> 또는{' '}
        <span className={ui.mono}>false</span> 로 입력합니다.
      </p>

      {drafts.length === 0 ? <p className={ui.empty}>등록된 확장 값이 없습니다.</p> : null}

      {drafts.map((draft, i) => {
        const rowId = `${idBase}-${draft.rowKey}`
        return (
          <div className={css.row} key={draft.rowKey}>
            <div className={css.rowHead}>
              <span className={css.rowIndex} lang="en">
                Extra {String(i + 1).padStart(2, '0')}
              </span>
              <div className={css.rowTools}>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => remove(draft.rowKey)}
                >
                  삭제
                </button>
              </div>
            </div>

            <div className={css.rowGrid}>
              <TextField
                id={`${rowId}-key`}
                name="extra.key"
                label="키"
                defaultValue={draft.key}
                maxLength={40}
                mono
                error={fieldErrors[`extra.${i}.key`]}
              />
              <SelectField
                id={`${rowId}-type`}
                name="extra.type"
                label="형식"
                defaultValue={draft.type}
                options={TYPE_OPTIONS}
                error={fieldErrors[`extra.${i}.type`]}
              />
              <TextField
                id={`${rowId}-value`}
                name="extra.value"
                label="값"
                defaultValue={draft.value}
                maxLength={EXTRA_VALUE_MAX}
                error={fieldErrors[`extra.${i}.value`]}
              />
            </div>
          </div>
        )
      })}

      <p className={css.counter} aria-live="polite">
        {drafts.length} / {MAX_EXTRAS}개
      </p>

      <button type="button" className={ui.btn} onClick={add} disabled={drafts.length >= MAX_EXTRAS}>
        확장 값 추가
      </button>

      <noscript>
        <p className={ui.hint}>
          JavaScript 가 꺼져 있어 확장 값 행을 추가하거나 삭제할 수 없습니다. 기존 행의 값 수정과 저장은
          그대로 동작합니다.
        </p>
      </noscript>
    </fieldset>
  )
}

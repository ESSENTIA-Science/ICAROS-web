'use client'

import { useId, useState } from 'react'
import { TextAreaField, TextField } from '../Fields'
import ui from '../ui.module.css'
import {
  HIGHLIGHT_NODE_MAX,
  HOTSPOT_BODY_MAX,
  HOTSPOT_TITLE_MAX,
  MAX_HOTSPOTS,
  NUMBER_INPUT_MAX,
} from './constants'
import css from './scene.module.css'

export type HotspotInit = {
  title: string
  bodyMd: string
  x: string
  y: string
  z: string
  highlightNode: string
}

type Draft = HotspotInit & { key: string }

const BLANK: HotspotInit = { title: '', bodyMd: '', x: '0', y: '0', z: '0', highlightNode: '' }

/**
 * 핫스팟 동적 추가·삭제·정렬 (G10·G11).
 *
 * 입력은 **비제어**다 — 행의 추가·삭제·이동만 상태로 관리하고 값은 DOM 이 갖는다.
 * 그래서 서버가 검증 오류로 되돌려줘도 사용자가 친 값이 남고, 순서를 바꿔도
 * (React 가 key 로 DOM 노드를 통째로 옮기므로) 값이 행을 따라간다.
 * 인덱스를 key 로 쓰면 그 순간 값이 한 칸씩 밀린다.
 *
 * 저장 순서는 DOM 순서 그대로이고, 서버가 그 순서를 `sort_order` 로 굳힌다.
 */
export default function HotspotEditor({
  initial,
  fieldErrors,
}: {
  initial: readonly HotspotInit[]
  fieldErrors: Readonly<Record<string, string>>
}) {
  const idBase = useId()
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.map((h, i) => ({ ...h, key: `${idBase}-init-${i}` }))
  )
  const [seq, setSeq] = useState(0)

  function add(): void {
    if (drafts.length >= MAX_HOTSPOTS) return
    setDrafts((prev) => [...prev, { ...BLANK, key: `${idBase}-new-${seq}` }])
    setSeq((n) => n + 1)
  }

  function remove(key: string): void {
    setDrafts((prev) => prev.filter((d) => d.key !== key))
  }

  function move(index: number, delta: -1 | 1): void {
    setDrafts((prev) => {
      const target = index + delta
      const a = prev[index]
      const b = prev[target]
      if (!a || !b) return prev
      const next = [...prev]
      next[index] = b
      next[target] = a
      return next
    })
  }

  return (
    <fieldset className={ui.fieldset}>
      <legend className={ui.legend} lang="en">
        Hotspots
      </legend>

      <p className={ui.hint}>
        모델 위 한 지점에 붙는 설명입니다. 좌표는 모델 로컬 좌표계 기준이고, 강조 노드를 채우면 뷰어가
        해당 GLB 노드를 함께 강조합니다. 비우면 라벨만 표시됩니다.
      </p>

      {drafts.length === 0 ? <p className={ui.empty}>등록된 핫스팟이 없습니다.</p> : null}

      {drafts.map((draft, i) => {
        const rowId = `${idBase}-${draft.key}`
        return (
          <div className={css.row} key={draft.key}>
            <div className={css.rowHead}>
              <span className={css.rowIndex} lang="en">
                Hotspot {String(i + 1).padStart(2, '0')}
              </span>
              <div className={css.rowTools}>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                >
                  위로
                </button>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => move(i, 1)}
                  disabled={i === drafts.length - 1}
                >
                  아래로
                </button>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => remove(draft.key)}
                >
                  삭제
                </button>
              </div>
            </div>

            <div className={css.rowGrid}>
              <TextField
                id={`${rowId}-title`}
                name="hotspot.title"
                label="제목"
                defaultValue={draft.title}
                maxLength={HOTSPOT_TITLE_MAX}
                required
                error={fieldErrors[`hotspot.${i}.title`]}
              />
              <TextField
                id={`${rowId}-node`}
                name="hotspot.highlightNode"
                label="강조 노드 이름 (선택)"
                defaultValue={draft.highlightNode}
                maxLength={HIGHLIGHT_NODE_MAX}
                mono
                error={fieldErrors[`hotspot.${i}.highlightNode`]}
              />
            </div>

            <div className={css.vecBlock}>
              <p className={css.vecLegend} lang="en">
                Position
              </p>
              <div className={css.vecGrid}>
                <TextField
                  id={`${rowId}-x`}
                  name="hotspot.x"
                  label="x"
                  defaultValue={draft.x}
                  inputMode="decimal"
                  maxLength={NUMBER_INPUT_MAX}
                  mono
                  error={fieldErrors[`hotspot.${i}.x`]}
                />
                <TextField
                  id={`${rowId}-y`}
                  name="hotspot.y"
                  label="y"
                  defaultValue={draft.y}
                  inputMode="decimal"
                  maxLength={NUMBER_INPUT_MAX}
                  mono
                  error={fieldErrors[`hotspot.${i}.y`]}
                />
                <TextField
                  id={`${rowId}-z`}
                  name="hotspot.z"
                  label="z"
                  defaultValue={draft.z}
                  inputMode="decimal"
                  maxLength={NUMBER_INPUT_MAX}
                  mono
                  error={fieldErrors[`hotspot.${i}.z`]}
                />
              </div>
            </div>

            <TextAreaField
              id={`${rowId}-body`}
              name="hotspot.bodyMd"
              label="본문 (Markdown, 선택)"
              defaultValue={draft.bodyMd}
              rows={3}
              maxLength={HOTSPOT_BODY_MAX}
              error={fieldErrors[`hotspot.${i}.bodyMd`]}
            />
          </div>
        )
      })}

      <p className={css.counter} aria-live="polite">
        {drafts.length} / {MAX_HOTSPOTS}개
      </p>

      <button type="button" className={ui.btn} onClick={add} disabled={drafts.length >= MAX_HOTSPOTS}>
        핫스팟 추가
      </button>

      <noscript>
        <p className={ui.hint}>
          JavaScript 가 꺼져 있어 핫스팟 행을 추가·삭제·이동할 수 없습니다. 기존 행의 값 수정과 저장은
          그대로 동작합니다.
        </p>
      </noscript>
    </fieldset>
  )
}

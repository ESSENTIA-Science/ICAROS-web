'use client'

import { useId, useState } from 'react'
import ui from '../ui.module.css'
import NumberInput from './NumberInput'
import {
  COORD_ABS_LIMIT,
  FOV_MAX_EXCLUSIVE,
  FOV_MIN_EXCLUSIVE,
  MAX_CAMERA_PRESETS,
  NUMBER_INPUT_MAX,
} from './constants'
import css from './scene.module.css'

export type PresetInit = {
  at: string
  cx: string
  cy: string
  cz: string
  tx: string
  ty: string
  tz: string
  fov: string
}

type Draft = PresetInit & { key: string }

const BLANK: PresetInit = { at: '0', cx: '0', cy: '0', cz: '5', tx: '0', ty: '0', tz: '0', fov: '' }

const NUMBER_SHAPE = /^-?\d+(\.\d+)?$/

function toNumber(raw: string): number | null {
  const v = raw.trim()
  return NUMBER_SHAPE.test(v) ? Number(v) : null
}

/** 행 하나의 경고 문장들. 서버 검증과 같은 경계를 보되, 저장 전에 화면에서 먼저 말해 준다. */
function rowWarnings(draft: Draft, index: number, drafts: readonly Draft[]): string[] {
  const out: string[] = []
  const at = toNumber(draft.at)

  if (at === null) out.push('at 이 숫자가 아닙니다.')
  else if (at < 0 || at > 1) out.push(`at 은 0~1 사이여야 합니다. (현재 ${at})`)
  else {
    const duplicate = drafts.findIndex((d, i) => i < index && toNumber(d.at) === at)
    if (duplicate >= 0) out.push(`at 값이 ${duplicate + 1}번 프리셋과 중복됩니다.`)
  }

  for (const [label, raw] of [
    ['camera.x', draft.cx],
    ['camera.y', draft.cy],
    ['camera.z', draft.cz],
    ['target.x', draft.tx],
    ['target.y', draft.ty],
    ['target.z', draft.tz],
  ] as const) {
    const value = toNumber(raw)
    if (value === null) out.push(`${label} 이 숫자가 아닙니다.`)
    else if (Math.abs(value) > COORD_ABS_LIMIT) out.push(`${label} 이 허용 범위를 벗어났습니다.`)
  }

  if (draft.fov.trim() !== '') {
    const fov = toNumber(draft.fov)
    if (fov === null) out.push('fov 가 숫자가 아닙니다.')
    else if (fov <= FOV_MIN_EXCLUSIVE || fov >= FOV_MAX_EXCLUSIVE) {
      out.push(`fov 는 ${FOV_MIN_EXCLUSIVE} 초과 ${FOV_MAX_EXCLUSIVE} 미만이어야 합니다.`)
    }
  }

  return out
}

function formatVec(x: string, y: string, z: string): string {
  return `(${x || '?'}, ${y || '?'}, ${z || '?'})`
}

/**
 * 스크롤 구간별 카메라 프리셋 편집 (G6).
 *
 * **관리 화면에 3D 뷰어를 넣지 않는다** (F13) — three 는 설치돼 있지도 않고, 편집 화면이
 * WebGL 에 의존하면 GPU 없는 노트북에서 CMS 자체를 못 쓴다. 대신 숫자를 읽을 수 있게 만든다:
 * 위쪽 타임라인이 입력 순서와 무관하게 `at` 오름차순으로 다시 세워 보여 주고,
 * 범위를 벗어난 값은 저장을 누르기 전에 그 자리에서 경고한다.
 *
 * 입력을 제어 컴포넌트로 둔 것은 그 실시간 경고 때문이다. 값이 React 상태에 있어
 * 서버 검증 오류로 되돌아와도(폼이 리마운트되지 않으므로) 사용자가 친 값이 그대로 남는다.
 */
export default function PresetEditor({
  initial,
  fieldErrors,
}: {
  initial: readonly PresetInit[]
  fieldErrors: Readonly<Record<string, string>>
}) {
  const idBase = useId()
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.map((p, i) => ({ ...p, key: `${idBase}-init-${i}` }))
  )
  const [seq, setSeq] = useState(0)

  function add(): void {
    if (drafts.length >= MAX_CAMERA_PRESETS) return
    setDrafts((prev) => [...prev, { ...BLANK, key: `${idBase}-new-${seq}` }])
    setSeq((n) => n + 1)
  }

  function remove(key: string): void {
    setDrafts((prev) => prev.filter((d) => d.key !== key))
  }

  function patch(key: string, field: keyof PresetInit, value: string): void {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, [field]: value } : d)))
  }

  const ordered = drafts
    .map((d, index) => ({ draft: d, index, at: toNumber(d.at) }))
    .sort((a, b) => (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY))

  return (
    <fieldset className={ui.fieldset}>
      <legend className={ui.legend} lang="en">
        Camera presets
      </legend>

      <p className={ui.hint}>
        스크롤 진행도 <span className={ui.mono}>at</span> (0 = 섹션 시작, 1 = 섹션 끝) 지점의 카메라
        위치입니다. 사이 구간은 뷰어가 보간합니다. <span className={ui.mono}>fov</span> 를 비우면 모델
        기본 화각을 그대로 씁니다.
      </p>

      {ordered.length > 0 ? (
        <div className={css.timeline}>
          <p className={css.timelineTitle} lang="en">
            Timeline (at 오름차순)
          </p>
          <div className={css.timelineList}>
            {ordered.map(({ draft, index, at }) => {
              const warnings = rowWarnings(draft, index, drafts)
              return (
                <div className={css.timelineItem} key={draft.key}>
                  <span className={css.timelineAt}>
                    {at === null ? '—' : `${(at * 100).toFixed(1)}%`}
                  </span>
                  <span className={warnings.length > 0 ? css.timelineWarn : css.timelineVals}>
                    #{index + 1} cam {formatVec(draft.cx, draft.cy, draft.cz)} → target{' '}
                    {formatVec(draft.tx, draft.ty, draft.tz)}
                    {draft.fov.trim() === '' ? '' : ` · fov ${draft.fov}`}
                    {warnings.length > 0 ? ` · ${warnings.join(' ')}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className={ui.empty}>등록된 카메라 프리셋이 없습니다.</p>
      )}

      {drafts.map((draft, i) => {
        const rowId = `${idBase}-${draft.key}`
        return (
          <div className={css.row} key={draft.key}>
            <div className={css.rowHead}>
              <span className={css.rowIndex} lang="en">
                Preset {String(i + 1).padStart(2, '0')}
              </span>
              <div className={css.rowTools}>
                <button
                  type="button"
                  className={`${ui.btn} ${ui.btnSmall}`}
                  onClick={() => remove(draft.key)}
                >
                  이 프리셋 삭제
                </button>
              </div>
            </div>

            <div className={css.rowGrid}>
              <NumberInput
                id={`${rowId}-at`}
                name="preset.at"
                label="at (0~1)"
                value={draft.at}
                onValueChange={(v) => patch(draft.key, 'at', v)}
                maxLength={NUMBER_INPUT_MAX}
                error={fieldErrors[`preset.${i}.at`]}
              />
              <NumberInput
                id={`${rowId}-fov`}
                name="preset.fov"
                label="fov (선택)"
                value={draft.fov}
                onValueChange={(v) => patch(draft.key, 'fov', v)}
                maxLength={NUMBER_INPUT_MAX}
                error={fieldErrors[`preset.${i}.fov`]}
              />
            </div>

            <div className={css.vecBlock}>
              <p className={css.vecLegend} lang="en">
                Camera position
              </p>
              <div className={css.vecGrid}>
                <NumberInput
                  id={`${rowId}-cx`}
                  name="preset.cx"
                  label="x"
                  value={draft.cx}
                  onValueChange={(v) => patch(draft.key, 'cx', v)}
                    maxLength={NUMBER_INPUT_MAX}
                    error={fieldErrors[`preset.${i}.cx`]}
                />
                <NumberInput
                  id={`${rowId}-cy`}
                  name="preset.cy"
                  label="y"
                  value={draft.cy}
                  onValueChange={(v) => patch(draft.key, 'cy', v)}
                    maxLength={NUMBER_INPUT_MAX}
                    error={fieldErrors[`preset.${i}.cy`]}
                />
                <NumberInput
                  id={`${rowId}-cz`}
                  name="preset.cz"
                  label="z"
                  value={draft.cz}
                  onValueChange={(v) => patch(draft.key, 'cz', v)}
                    maxLength={NUMBER_INPUT_MAX}
                    error={fieldErrors[`preset.${i}.cz`]}
                />
              </div>
            </div>

            <div className={css.vecBlock}>
              <p className={css.vecLegend} lang="en">
                Look-at target
              </p>
              <div className={css.vecGrid}>
                <NumberInput
                  id={`${rowId}-tx`}
                  name="preset.tx"
                  label="x"
                  value={draft.tx}
                  onValueChange={(v) => patch(draft.key, 'tx', v)}
                    maxLength={NUMBER_INPUT_MAX}
                    error={fieldErrors[`preset.${i}.tx`]}
                />
                <NumberInput
                  id={`${rowId}-ty`}
                  name="preset.ty"
                  label="y"
                  value={draft.ty}
                  onValueChange={(v) => patch(draft.key, 'ty', v)}
                    maxLength={NUMBER_INPUT_MAX}
                    error={fieldErrors[`preset.${i}.ty`]}
                />
                <NumberInput
                  id={`${rowId}-tz`}
                  name="preset.tz"
                  label="z"
                  value={draft.tz}
                  onValueChange={(v) => patch(draft.key, 'tz', v)}
                    maxLength={NUMBER_INPUT_MAX}
                    error={fieldErrors[`preset.${i}.tz`]}
                />
              </div>
            </div>
          </div>
        )
      })}

      <p className={css.counter} aria-live="polite">
        {drafts.length} / {MAX_CAMERA_PRESETS}개
      </p>

      <button
        type="button"
        className={ui.btn}
        onClick={add}
        disabled={drafts.length >= MAX_CAMERA_PRESETS}
      >
        프리셋 추가
      </button>

      <noscript>
        <p className={ui.hint}>
          JavaScript 가 꺼져 있어 프리셋 행을 추가하거나 삭제할 수 없습니다. 기존 행의 값 수정과 저장은
          그대로 동작합니다.
        </p>
      </noscript>
    </fieldset>
  )
}

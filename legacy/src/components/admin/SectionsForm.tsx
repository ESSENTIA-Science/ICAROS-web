'use client'

import { useActionState, useId } from 'react'
import { saveSectionsAction } from '@/app/admin/_actions/landing'
import type { FormState } from '@/app/admin/_actions/result'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

export type SectionRowValues = {
  id: string
  label: string
  enabled: boolean
  sortOrder: number
}

const NO_ERRORS: Readonly<Record<string, string>> = {}

/**
 * 랜딩 섹션 활성화·순서 (B11).
 *
 * 드래그 정렬 대신 숫자 입력을 쓴다: 7개짜리 목록에서 드래그는 JS 없이는 동작하지 않고,
 * 키보드·스크린리더 대응 비용이 얻는 것보다 크다. 값이 겹쳐도 공개 페이지가 id 로 tie-break 한다.
 */
export default function SectionsForm({
  sections,
  version,
}: {
  sections: readonly SectionRowValues[]
  /** 섹션이 하나도 없으면 저장할 대상이 없다는 뜻이라 폼을 잠근다. */
  version: string | null
}) {
  const idBase = useId()
  const [state, formAction] = useActionState<FormState, FormData>(saveSectionsAction, null)
  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? NO_ERRORS) : NO_ERRORS

  if (sections.length === 0 || version === null) {
    return <p className={ui.empty}>등록된 섹션이 없습니다.</p>
  }

  return (
    <form action={formAction} noValidate>
      <ActionNotice state={state} />

      <input type="hidden" name="version" value={version} />

      <div className={ui.list}>
        {sections.map((s) => {
          const orderId = `${idBase}-${s.id}-order`
          const enabledId = `${idBase}-${s.id}-enabled`
          const error = fieldErrors[`order.${s.id}`]
          return (
            <div className={ui.row} key={s.id}>
              <input type="hidden" name="section.id" value={s.id} />

              <div className={ui.rowMain}>
                <div className={ui.checkRow}>
                  <input type="hidden" name={`enabled.${s.id}`} value="0" />
                  <input
                    type="checkbox"
                    id={enabledId}
                    name={`enabled.${s.id}`}
                    value="1"
                    defaultChecked={s.enabled}
                  />
                  <label htmlFor={enabledId}>{s.label}</label>
                </div>
                <p className={ui.rowMeta}>
                  <span className={ui.mono}>{s.id}</span>
                </p>
              </div>

              <div className={ui.rowActions}>
                <label className={ui.hint} htmlFor={orderId}>
                  순서
                </label>
                <input
                  className={`${ui.input} ${ui.orderInput}${error ? ` ${ui.inputError}` : ''}`}
                  id={orderId}
                  name={`order.${s.id}`}
                  defaultValue={String(s.sortOrder)}
                  inputMode="numeric"
                  maxLength={3}
                  aria-invalid={error ? true : undefined}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className={ui.actions}>
        <SubmitButton>섹션 설정 저장</SubmitButton>
      </div>
    </form>
  )
}

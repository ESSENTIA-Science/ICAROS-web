'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import type { ActionResult, FormState } from '@/app/admin/_actions/result'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

/**
 * 삭제 확인 (F11 개선).
 *
 * `window.confirm` 을 쓰지 않는다: 브라우저 자동화에서 blocking dialog 가 되고,
 * 스크린리더에서는 맥락 없는 문장 하나만 읽힌다. 대신 URL(`?delete=<id>`)로 열리는
 * 인라인 확인 영역을 둔다 — JS 없이도 동작하고, 취소는 그냥 링크다.
 *
 * `role="group"` + `aria-labelledby` 로 묶어 이 영역 전체가 하나의 확인 단위로 읽히게 하고,
 * 최초 포커스는 파괴적이지 않은 쪽(취소)에 둔다.
 */
export default function DeleteConfirm({
  action,
  id,
  title,
  description,
  cancelHref,
  confirmLabel = '삭제',
}: {
  action: (prev: FormState, form: FormData) => Promise<ActionResult>
  id: string
  title: string
  description?: string
  cancelHref: string
  confirmLabel?: string
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, null)
  const headingId = `confirm-${id}`

  return (
    <div className={ui.confirm} role="group" aria-labelledby={headingId}>
      <ActionNotice state={state} />

      <p className={ui.confirmText} id={headingId}>
        <strong>{title}</strong> 을(를) 삭제합니다. 되돌릴 수 없습니다.
        {description ? ` ${description}` : ''}
      </p>

      <div className={ui.confirmActions}>
        {/* 파괴적이지 않은 쪽에 먼저 포커스가 가도록 취소를 앞에 둔다 */}
        <Link className={ui.btn} href={cancelHref} autoFocus>
          취소
        </Link>
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="danger" pendingLabel="삭제 중…">
            {confirmLabel}
          </SubmitButton>
        </form>
      </div>
    </div>
  )
}

'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { deletePanel, movePanel, togglePanelPublished } from '@/app/admin/_actions/panels'
import type { FormState } from '@/app/admin/_actions/result'
import { ActionNotice } from './Notice'
import ui from './ui.module.css'

/**
 * 목록 한 행의 조작 — 공개 토글 · 순서 · 편집 · 삭제.
 *
 * 각 버튼이 자기 form 을 갖는다. 하나의 form 에 여러 submit 을 두면 어느 버튼이 눌렸는지
 * 서버가 알기 위해 이름 붙은 submit 값에 기대야 하고, 그 값은 키보드 제출에서 빠질 수 있다.
 *
 * 삭제는 URL 로 확인을 받는다(`?delete=<id>`). 확인 상태가 URL 에 있으면 새로고침해도
 * 그 자리에 머물고, 이 컴포넌트가 확인 여부를 자기 상태로 들 필요가 없다 — 다른 탭과 같은 규칙이다.
 */
export default function PanelRowActions({
  id,
  version,
  published,
  first,
  last,
  confirmDelete,
}: {
  id: string
  version: string
  published: boolean
  first: boolean
  last: boolean
  confirmDelete: boolean
}) {
  const [toggleState, toggleAction] = useActionState<FormState, FormData>(togglePanelPublished, null)
  const [moveState, moveAction] = useActionState<FormState, FormData>(movePanel, null)
  const [deleteState, deleteAction] = useActionState<FormState, FormData>(deletePanel, null)

  return (
    <div className={ui.panelActions}>
      <ActionNotice state={toggleState ?? moveState ?? deleteState} />

      <form action={toggleAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="published" value={published ? 'off' : 'on'} />
        <button type="submit" className={published ? ui.btnSmall : ui.btnPrimary}>
          {published ? '내리기' : '공개'}
        </button>
      </form>

      <form action={moveAction} className={ui.panelMove}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="version" value={version} />
        <button type="submit" name="direction" value="up" className={ui.btnSmall} disabled={first}>
          ↑
        </button>
        <button type="submit" name="direction" value="down" className={ui.btnSmall} disabled={last}>
          ↓
        </button>
      </form>

      <Link className={ui.btnSmall} href={`/admin?tab=panels&edit=${id}`}>
        편집
      </Link>

      {confirmDelete ? (
        <form action={deleteAction} className={ui.confirm}>
          <p className={ui.confirmText} lang="ko">
            이 패널을 삭제할까요? 사진은 지우지 않습니다.
          </p>
          <div className={ui.confirmActions}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className={ui.btnDanger}>
              삭제
            </button>
            <Link className={ui.btnSmall} href="/admin?tab=panels">
              취소
            </Link>
          </div>
        </form>
      ) : (
        <Link className={ui.btnSmall} href={`/admin?tab=panels&delete=${id}`}>
          삭제
        </Link>
      )}
    </div>
  )
}

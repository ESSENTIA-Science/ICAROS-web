'use client'

import { useFormStatus } from 'react-dom'
import ui from './ui.module.css'

/**
 * 제출 버튼. `useFormStatus` 는 **폼 내부의 자식**에서만 값을 읽으므로 별도 컴포넌트로 둔다.
 * JS 가 없으면 pending 표시가 없을 뿐, 버튼 자체는 그대로 동작한다.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
  disabled,
}: {
  children: React.ReactNode
  pendingLabel?: string
  variant?: 'primary' | 'danger' | 'plain'
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  const variantClass =
    variant === 'primary' ? ui.btnPrimary : variant === 'danger' ? ui.btnDanger : ''

  return (
    <button
      type="submit"
      className={`${ui.btn} ${variantClass ?? ''}`}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? (pendingLabel ?? '저장 중…') : children}
    </button>
  )
}

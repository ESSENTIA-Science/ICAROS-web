'use client'

import { useActionState } from 'react'
import { loginAction } from '@/app/admin/_actions/auth'
import type { FormState } from '@/app/admin/_actions/result'
import { TextField } from './Fields'
import { ActionNotice } from './Notice'
import SubmitButton from './SubmitButton'
import ui from './ui.module.css'

/**
 * 관리자 로그인 (F2·H2).
 * 가입 경로가 없다 — 계정은 `npm run bootstrap:admin` 으로만 만들어진다 (H19).
 */
export default function LoginForm() {
  const [state, formAction] = useActionState<FormState, FormData>(loginAction, null)

  return (
    <form action={formAction}>
      <ActionNotice state={state} />

      <TextField
        name="email"
        label="이메일"
        type="email"
        autoComplete="username"
        required
        autoFocus
        maxLength={254}
      />
      <TextField
        name="password"
        label="비밀번호"
        type="password"
        autoComplete="current-password"
        required
        maxLength={512}
      />

      <div className={ui.actions}>
        <SubmitButton pendingLabel="확인 중…">로그인</SubmitButton>
      </div>
    </form>
  )
}

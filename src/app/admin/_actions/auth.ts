'use server'

/** 런타임 지정 위치에 대한 설명은 `_actions/rockets.ts` 상단 주석 참조. */

import { redirect } from 'next/navigation'

import { login, logout } from '@/lib/auth/account'
import { MALFORMED, fail, type ActionResult, type FormState } from './result'

/**
 * 로그인 (F2).
 *
 * 여기만 `requireAdmin()` 으로 시작하지 않는다 — 세션을 만드는 경로라 세션을 요구할 수 없다.
 * 대신 `login()` 이 내부에서 `assertTrustedOrigin()` 과 rate limit 을 먼저 통과시키고,
 * 실패 사유를 구분하지 않는 단일 문구만 돌려준다 (계정 열거 방지).
 */
export async function loginAction(_prev: FormState, form: FormData): Promise<ActionResult> {
  const email = form.get('email')
  const password = form.get('password')
  if (typeof email !== 'string' || typeof password !== 'string') return MALFORMED

  const result = await login({ email, password })
  if (!result.ok) return fail(result.message)

  // 성공하면 레이아웃의 인증 게이트가 다시 평가되도록 같은 경로로 되돌린다.
  redirect('/admin')
}

/**
 * 로그아웃 (H10). 상태를 화면에 보여 줄 것이 없으므로 `useActionState` 를 쓰지 않는다 —
 * 결과는 어차피 로그인 화면으로의 전환 하나뿐이다.
 */
export async function logoutAction(): Promise<void> {
  try {
    await logout()
  } catch {
    // 서버 폐기가 실패해도 화면은 게이트로 되돌린다. 세션이 살아 있으면 게이트가 다시 통과시킬 뿐,
    // 로그아웃한 척하는 화면을 보여 주지는 않는다.
    console.error('[admin] 로그아웃 처리 실패')
  }

  // redirect 는 NEXT_REDIRECT 를 throw 한다 — 위 try 안에 두면 삼켜진다.
  redirect('/admin')
}

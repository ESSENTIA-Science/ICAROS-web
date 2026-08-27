/**
 * Server Action 의 반환 계약.
 *
 * 액션은 **throw 하지 않는다.** 인증 실패·검증 실패·충돌·DB 오류가 전부 이 판별 가능한
 * 결과로 내려와야 `useActionState` 가 화면에 그릴 수 있고, 스택 트레이스가 화면에 새지 않는다.
 *
 * 순수 타입·상수만 둔다 — 클라이언트 컴포넌트가 이 파일을 import 해도
 * 서버 코드가 번들에 딸려 오지 않아야 한다.
 */

export type ActionResult =
  | { readonly ok: true; readonly message?: string }
  | {
      readonly ok: false
      readonly error: string
      /** 필드명 → 메시지. 폼이 입력 옆에 붙여 준다. */
      readonly fieldErrors?: Readonly<Record<string, string>>
    }

/** `useActionState` 초기값. 아직 아무것도 제출하지 않은 상태. */
export type FormState = ActionResult | null

/**
 * 인증 실패 문구는 하나로 고정한다. "세션 만료"와 "권한 없음"을 구분해 알려 줄 이유가 없고,
 * 구분하면 그게 곧 탐지 신호가 된다.
 */
export const DENIED: ActionResult = {
  ok: false,
  error: '세션이 만료되었거나 권한이 없습니다. 다시 로그인해 주세요.',
}

/** 낙관적 잠금 충돌 (F12). */
export const CONFLICT: ActionResult = {
  ok: false,
  error: '다른 곳에서 먼저 수정된 내용이 있습니다. 새로고침해 최신 값을 확인한 뒤 다시 저장해 주세요.',
}

/** 폼이 서버가 기대하는 형태가 아니다 — 대개 잘린 요청이거나 직접 조립한 요청이다. */
export const MALFORMED: ActionResult = {
  ok: false,
  error: '요청 형식이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.',
}

export function fail(error: string, fieldErrors?: Readonly<Record<string, string>>): ActionResult {
  return fieldErrors && Object.keys(fieldErrors).length > 0
    ? { ok: false, error, fieldErrors }
    : { ok: false, error }
}

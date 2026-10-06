import 'server-only'

/**
 * 이메일 정규화 (06 §3, H3).
 *
 * **이 프로젝트에서 이메일을 정규화하는 함수는 여기 하나뿐이다.**
 * 저장 경로와 조회 경로가 다른 규칙을 쓰면 "가입은 됐는데 로그인이 안 되는" 계정이 생긴다.
 *
 * gmail 의 `.` 제거·`+태그` 제거는 하지 않는다 — 공급자별로 규칙이 갈리고,
 * 관리자가 소수라 잘못 정규화하면 계정을 통째로 잃는다.
 *
 * 뒤에서 한 번 더 trim 하는 이유: NFKC 는 호환 문자를 공백을 포함한 문자열로 펼칠 수 있다
 * (예: U+FDFA). `icaros.admin_users` 에 `email = lower(btrim(email))` CHECK 가 걸려 있어
 * 공백이 남으면 INSERT 자체가 실패한다.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().normalize('NFKC').toLowerCase().trim()
}

/** DB 컬럼은 text 라 상한이 없다. 로그·rate limit 키가 무한정 길어지지 않게 애플리케이션에서 자른다. */
export const EMAIL_MAX_LENGTH = 254

/**
 * 최소한의 형태 검사. 이메일 유효성의 권위 있는 판정이 아니라
 * "명백한 쓰레기"와 제어문자를 거르는 용도다. 실제 검증은 로그인 성공 여부가 한다.
 */
export function looksLikeEmail(normalized: string): boolean {
  if (normalized.length === 0 || normalized.length > EMAIL_MAX_LENGTH) return false
  return /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/.test(normalized)
}

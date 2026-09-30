/**
 * CMS 자유 텍스트의 표시 언어를 값에서 판별한다.
 *
 * 섹션 라벨·슬로건·태그라인·인용구는 전부 운영자가 고치는 값이다. `lang="en"` 을 박아 두면
 * 한국어로 바뀌는 순간 두 가지가 동시에 깨진다.
 *  - 스크린리더가 영어 음성 합성으로 한국어를 읽는다
 *  - globals.css 의 `:lang(ko) { letter-spacing: 0; text-transform: none }` 가드가 안 걸려
 *    자간 0.02em 초과 + uppercase 가 한글에 그대로 적용된다 (tokens.css 자간 주석)
 *
 * 한글이 한 글자라도 섞이면 한글 조판 규칙이 이겨야 하므로 ko 로 본다.
 * 자모(U+3131~)·한자는 보지 않는다 — 실제 입력은 완성형 음절이고, 판정이 넓어질수록
 * 라틴 문구가 잘못 ko 로 넘어갈 위험만 커진다.
 *
 * 이 파일이 landing 아래 있는 것은 소유 경로 제약 때문이다. 성격상 src/lib 로 옮겨야 한다.
 */
const HANGUL_SYLLABLE = /[가-힣]/

export type TextLang = 'ko' | 'en'

export function textLang(value: string): TextLang {
  return HANGUL_SYLLABLE.test(value) ? 'ko' : 'en'
}

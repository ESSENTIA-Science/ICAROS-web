import { Archivo, IBM_Plex_Mono } from 'next/font/google'

/**
 * 본문(Pretendard)은 여기 없다 — `src/app/fonts.css` 에 손으로 쓴 @font-face 로 있다.
 *
 * `next/font/local` 이 **`unicode-range` 를 노출하지 않기 때문**이다.
 * 한글 폰트는 웨이트당 ~750KB 인데 실사용 음절은 775 자뿐이라, 범위를 못 나누면
 * 안 쓰는 글자 1만 개를 매번 같이 받는다. 3 웨이트 합 2.22MB → 305KB.
 */

/**
 * 기술 레지스터 — 아이브로/제원 라벨. next/font/google 이 빌드 타임에 셀프호스팅한다.
 * 단일 웨이트만 쓴다.
 */
export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-mono',
  display: 'swap',
})

/**
 * 디스플레이 — DECISIONS D18. `WidescreenUEx_Trial_*` 를 대체한다.
 *
 * **왜 Archivo 인가.** 대체 대상은 *울트라 익스팬디드* 그로테스크다. 후보 중
 * Anton(400 단일)·Bebas Neue(400 단일)·Oswald(wght 축만)는 전부 **콘덴스트** 계열이라
 * 폭이 반대 방향이다 — 넓힐 축이 아예 없다. `next/font/google` 메타데이터 실측 기준
 * Archivo 만 `wdth` 62–125 가변 축을 갖는다(OFL, Omnibus-Type). 125 가 Expanded 다.
 *
 * `axes: ['wdth']` 를 주려면 weight 를 비워 variable 로 받아야 한다(로더 제약).
 * 그래서 파일 자체는 wght 100–900 을 담지만, **쓰는 인스턴스는 하나뿐이다** —
 * tokens.css 가 `--fw-display: 500` · `--display-wdth: 125%` 로 고정한다.
 * Vast 가 디스플레이를 Medium 500 한 벌로만 쓰는 것과 같은 규율이고, bold 를 추가하지 않는다.
 *
 * `variable` 이 `--font-display` 여야 한다. 예전에 이 변수가 정의되지 않아
 * tokens.css 의 `--ff-display: var(--font-display), …` 선언 전체가
 * invalid at computed-value time 이 되어 폴백 체인째로 죽은 적이 있다.
 * 히어로 조판이 이 서체이므로 preload 한다.
 */
export const display = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-display',
  display: 'swap',
  preload: true,
})

import localFont from 'next/font/local'
import { IBM_Plex_Mono } from 'next/font/google'

/**
 * 본문 — Pretendard. woff2 만 로드한다 (레거시 ttf 17MB 는 이전 대상이 아니다).
 * 웨이트는 토큰이 실제로 쓰는 400/500/600 만.
 */
export const body = localFont({
  src: [
    { path: '../assets/fonts/woff2/Pretendard-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/woff2/Pretendard-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/woff2/Pretendard-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
  preload: true,
})

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
 * 디스플레이 — DECISIONS D10 미해소.
 * `WidescreenUEx_Trial_*` 는 파일명이 Trial 이고 웹 라이선스가 확인되지 않았다.
 * 확인 전까지 Pretendard 를 디스플레이 역할로 **별도 변수에 담아** 대체한다.
 *
 * `export const display = body` 로 두면 variable 이 `--font-body` 라서 `--font-display` 가
 * 영영 정의되지 않고, tokens.css 의 `--ff-display: var(--font-display), ...` 선언이
 * invalid at computed-value time 이 되어 폴백 체인째로 죽는다.
 * 라이선스가 풀리면 아래 src 배열만 실제 디스플레이 서체로 바꾸면 된다.
 */
export const display = localFont({
  src: [{ path: '../assets/fonts/woff2/Pretendard-Medium.woff2', weight: '500', style: 'normal' }],
  variable: '--font-display',
  display: 'swap',
  preload: false,
})

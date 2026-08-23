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
 * 확인 전까지 본문 폰트를 디스플레이 역할로 대체한다. 라이선스가 해소되면 여기만 교체한다.
 */
export const display = body

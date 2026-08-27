import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 레거시 Vite 트리(src/*.jsx)는 Gate 6까지 남겨 두되 타입체크·빌드에서 제외한다.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // 06 §5 3중 방어의 2층. 1층은 SameSite=Lax, 3층은 requireAdmin() 의 명시적 Origin 검증.
    // 16.3.2 에서도 이 키는 여전히 experimental 아래에 문서화돼 있다 — 업그레이드 시 위치 재확인.
    serverActions: {
      allowedOrigins: (process.env.ADMIN_ALLOWED_ORIGINS ?? 'icaros.kr,www.icaros.kr')
        .split(',')
        .map((o) => o.trim().replace(/^https?:\/\//, ''))
        .filter(Boolean),
    },
  },
  images: {
    // 이미지는 전부 same-origin /api/media/[id] 프록시를 거친다 (DECISIONS D3).
    // 외부 remotePatterns 를 열지 않는다 — 열면 presigned URL 이 src 로 새는 경로가 생긴다.
    remotePatterns: [],
    formats: ['image/webp'],
    /**
     * 기본값 8개(640·750·828·1080·1200·1920·2048·3840)에서 **5개로 줄였다** (D26).
     *
     * 랜딩 패널은 `sizes="100vw"` 다 — 사진이 실제로 화면 전체를 덮으므로 그 값은 정직하고
     * 좁힐 수 없다. 대신 그 결과로 **사진 한 장이 이 목록 개수만큼 변형**이 된다.
     * 실측: 랜딩 1회에 고유 사진 5장 → `_next/image` 변형 **40개**.
     *
     * 변형 하나하나가 최적화기 캐시 미스 때 `/api/media/<id>` 를 **따로** 부르고, 그건 곧
     * 함수 호출이자 DB 조회다. 최적화기 캐시는 **배포마다 비므로** 그 팬아웃이 배포마다 돌아온다.
     * 2026-08-27 커넥션 포화의 증폭기가 이것이었다.
     *
     * 뺀 값은 전부 **이웃과 15% 이내**라 브라우저 다운스케일로 눈에 띄지 않는다:
     *   750 ↔ 828 (10%) · 1080 ↔ 1200 (11%) · 1920 ↔ 2048 (6%)
     * 상단 3840 은 남긴다 — 1920 화면 DPR 2 가 실제로 그걸 쓰고, 전면 사진에서 그 손실은 보인다.
     * **화질을 팔아서 호출을 줄인 것이 아니라 중복을 지운 것이다.**
     */
    deviceSizes: [640, 828, 1200, 1920, 3840],
    /**
     * 고정 px `sizes` 용(384 이하). 쓰는 곳이 `/admin` 썸네일(120·200·320px)뿐이라
     * 그 셋을 덮는 최소 집합만 남긴다. 기본값은 16부터 8개였다.
     */
    imageSizes: [128, 256, 384],
  },
  async headers() {
    return [
      {
        // GLB·포스터는 파일명이 고정이라 기본값(`max-age=0`)이면 2MB 를 매 방문 재검증한다.
        // 내용이 바뀌면 파일명을 바꾸는 규약으로 두고 길게 캐시한다.
        source: '/assets/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // 06 §0 위협표의 "네트워크 도청 → Secure + HSTS" 중 나머지 절반.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
}

export default nextConfig

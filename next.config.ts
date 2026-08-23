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

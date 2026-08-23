import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 레거시 Vite 트리(src/*.jsx)는 Gate 6까지 남겨 두되 타입체크·빌드에서 제외한다.
  typescript: { ignoreBuildErrors: false },
  images: {
    // 이미지는 전부 same-origin /api/media/[id] 프록시를 거친다 (DECISIONS D3).
    // 외부 remotePatterns 를 열지 않는다 — 열면 presigned URL 이 src 로 새는 경로가 생긴다.
    remotePatterns: [],
    formats: ['image/webp'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig

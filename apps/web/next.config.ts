import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  trailingSlash: true,
  ...(process.env.ICAROS_BUILD_ID ? { generateBuildId: async () => process.env.ICAROS_BUILD_ID! } : {}),
  images: { unoptimized: true },
}

export default nextConfig

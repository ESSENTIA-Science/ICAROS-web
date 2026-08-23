import 'server-only'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

/**
 * Fluid Compute 에서는 Vercel·Neon 모두 HTTP 드라이버보다 TCP(`pg`)를 권장한다.
 * 런타임은 pooled 엔드포인트를, 마이그레이션은 unpooled 를 쓴다 (05 §5).
 */
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

declare global {
   
  var __icarosPool: Pool | undefined
}

// 개발 중 HMR 이 풀을 계속 새로 만들지 않도록 전역에 붙인다.
const pool =
  globalThis.__icarosPool ??
  new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    // 우리 객체는 전부 icaros 스키마에 있다. public 을 search_path 에서 뺀다.
    options: '-c search_path=icaros',
  })

if (process.env.NODE_ENV !== 'production') globalThis.__icarosPool = pool

export const db = drizzle(pool, { schema })
export { schema }

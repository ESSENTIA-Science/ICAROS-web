import 'server-only'

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { buildPoolConfig } from './connection'

/**
 * Fluid Compute 에서는 TCP(`pg`)를 쓴다.
 * 접속 방식은 `connection.ts` 가 정한다 — 로컬은 비밀번호, 배포는 IAM 토큰(D20).
 */

declare global {
   
  var __icarosPool: Pool | undefined
}

// 개발 중 HMR 이 풀을 계속 새로 만들지 않도록 전역에 붙인다.
const pool = globalThis.__icarosPool ?? new Pool(buildPoolConfig())

if (process.env.NODE_ENV !== 'production') globalThis.__icarosPool = pool

export const db = drizzle(pool, { schema })
export { schema }

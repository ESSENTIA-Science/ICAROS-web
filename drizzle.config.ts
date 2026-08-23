import type { Config } from 'drizzle-kit'

/**
 * ICAROS 는 `icaros` 스키마만 소유한다 (DECISIONS D2).
 * `public` 은 ESSENTIA Flyway 단독 소유이며, ESSENTIA 는 ddl-auto: validate 로 기동하므로
 * `public` 에 낯선 객체가 생기면 상대 API 가 기동에 실패할 수 있다.
 *
 * `drizzle-kit push` 는 금지한다 — 라이브 DB 를 introspect 하기 때문이다.
 * generate + migrate 만 쓴다. generate 는 DB 에 접속하지 않고 out/ 스냅샷과만 비교하므로
 * ESSENTIA 테이블이 구조적으로 보이지 않는다.
 */
export default {
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['icaros'],
  migrations: { schema: 'icaros', table: '__drizzle_migrations' },
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
} satisfies Config

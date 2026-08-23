import { pgSchema } from 'drizzle-orm/pg-core'

/**
 * ICAROS 가 소유하는 유일한 스키마.
 * `public` 은 ESSENTIA Flyway 단독 소유다 — 여기에 아무것도 만들지 않는다 (DECISIONS D2).
 */
export const icaros = pgSchema('icaros')

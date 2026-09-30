import 'server-only'

import { randomBytes } from 'node:crypto'
import type { Algorithm, Options, Version } from '@node-rs/argon2'
import { hash, hashSync, verify } from '@node-rs/argon2'

/**
 * OWASP 기준선 (06 §2). 라이브러리 기본값과 같은 값이지만 **명시적으로 전달**한다 —
 * 의존성이 기본값을 바꿔도 우리 해시 비용이 조용히 내려가지 않게 한다.
 *
 * `Algorithm`·`Version` 은 ambient const enum 이라 `isolatedModules` 아래서 값으로 접근할 수 없다(TS2748).
 * 타입만 import 하고 리터럴을 단언한다: Argon2id = 2, V0x13 = 1 (= Argon2 v19).
 */
export const ARGON2 = {
  algorithm: 2 as Algorithm,
  version: 1 as Version,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} satisfies Options

/** NIST 800-63B: 길이만 강제하고 문자 구성 규칙은 두지 않는다. */
export const MIN_PASSWORD_LENGTH = 12

/** salt 는 라이브러리가 CSPRNG 로 만들어 PHC 문자열에 담는다. 직접 만들지 않는다. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2)
}

/**
 * 검증 파라미터는 PHC 문자열에 박혀 있으므로, 나중에 비용을 올려도 옛 해시가 그대로 검증된다.
 * 예외를 boolean 으로 흡수한다 — 손상된 PHC 는 "검증 실패"지 500 이 아니다.
 */
export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await verify(phc, password, ARGON2)
  } catch {
    return false
  }
}

const PHC_ARGON2ID = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/

/**
 * 저장된 해시가 현재 기준보다 약한가 (06 §2). 로그인 성공 직후에만 호출한다 —
 * 그 순간이 평문을 합법적으로 손에 쥐고 있는 유일한 시점이다.
 * 파싱 실패도 `true` 다: 우리가 이해하지 못하는 형식은 신뢰하지 않는다.
 */
export function needsRehash(phc: string): boolean {
  const m = PHC_ARGON2ID.exec(phc)
  if (!m) return true

  const version = Number(m[1])
  const memoryCost = Number(m[2])
  const timeCost = Number(m[3])
  const parallelism = Number(m[4])
  if (!Number.isFinite(version + memoryCost + timeCost + parallelism)) return true

  return (
    version < 19 ||
    memoryCost < ARGON2.memoryCost ||
    timeCost < ARGON2.timeCost ||
    parallelism < ARGON2.parallelism
  )
}

/**
 * 계정 열거 방지용 상수 해시 (06 §6, H3).
 *
 * 사용자가 없을 때 Argon2 검증을 건너뛰면 20~50ms 의 응답 시간 차이가
 * "이 이메일은 존재하지 않는다"를 알려준다. 모듈 로드 시 1회 만들어 두고,
 * 미존재 계정 경로에서도 **실제 verify() 를 수행**한다.
 *
 * 입력은 CSPRNG 라 이 해시에 맞는 평문은 아무도 모른다.
 */
const DUMMY_HASH = hashSync(randomBytes(32).toString('base64'), ARGON2)

/** 결과를 버린다. 목적은 판정이 아니라 소요 시간이다. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, password)
}

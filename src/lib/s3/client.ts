import 'server-only'

import { S3Client } from '@aws-sdk/client-s3'
import { getS3Config } from './config'

declare global {
  var __icarosS3: S3Client | undefined
}

/**
 * 자격증명을 **명시하지 않는다.** 기본 provider chain 이 알아서 찾는다.
 * 런타임(Vercel)은 OIDC 역할 수임을 전제하고(D5), 로컬은 `essentia` 프로필 같은 환경 설정을 쓴다.
 * 장기 access key 를 코드나 env 예시에 넣지 않는다 — ESSENTIA 에도 런타임 장기 키는 한 군데도 없다.
 *
 * 지연 생성: `getS3Config()` 가 미구성 상태에서 던지므로 모듈 로드 시점에 만들면 안 된다.
 */
export function getS3Client(): S3Client {
  const cached = globalThis.__icarosS3
  if (cached) return cached

  const { region, endpoint } = getS3Config()

  /**
   * `endpoint` 는 로컬 MinIO 에서만 채워진다. 그때는 **경로 스타일**이어야 한다 —
   * MinIO 는 가상 호스트 스타일(`bucket.host`)을 기본으로 받지 않아 SDK 기본값으로는
   * DNS 조회부터 실패한다.
   */
  const client = new S3Client(
    endpoint ? { region, endpoint, forcePathStyle: true } : { region }
  )

  // 개발 중 HMR 이 클라이언트를 계속 새로 만들지 않도록. 서버리스 warm 인스턴스에서도 재사용된다.
  globalThis.__icarosS3 = client
  return client
}

import 'server-only'

import { S3Client } from '@aws-sdk/client-s3'
import { awsCredentialsProvider } from '@vercel/functions/oidc'
import { getS3Config } from './config'

declare global {
  var __icarosS3: S3Client | undefined
}

/**
 * 장기 access key 를 코드나 env 예시에 넣지 않는다 — ESSENTIA 에도 런타임 장기 키는 한 군데도 없다.
 *
 * **Vercel 에서는 기본 provider chain 이 동작하지 않는다.**
 * AWS SDK 기본 체인의 web identity 경로는 `AWS_WEB_IDENTITY_TOKEN_FILE`(디스크의 **파일**)을
 * 찾는데 Vercel 은 토큰을 파일로 주지 않는다. 그래서 `CredentialsProviderError: Could not load
 * credentials from any providers` 로 끝난다 — 실제로 프로덕션에서 `/api/media/[id]` 가 전부
 * 502 였고 원인이 이것이었다.
 *
 * `src/lib/db/connection.ts` 는 같은 문제를 `awsCredentialsProvider` 로 이미 풀어 뒀는데
 * S3 쪽은 배선되지 않은 채 남아 있었다. **같은 판정(`AWS_ROLE_ARN` 유무)으로 맞춘다.**
 * 로컬은 `AWS_PROFILE` 이 있어 기본 체인이 그대로 동작한다.
 *
 * 지연 생성: `getS3Config()` 가 미구성 상태에서 던지므로 모듈 로드 시점에 만들면 안 된다.
 */
export function getS3Client(): S3Client {
  const cached = globalThis.__icarosS3
  if (cached) return cached

  const { region, endpoint } = getS3Config()
  const roleArn = process.env.AWS_ROLE_ARN

  /**
   * `endpoint` 는 로컬 MinIO 에서만 채워진다. 그때는 **경로 스타일**이어야 한다 —
   * MinIO 는 가상 호스트 스타일(`bucket.host`)을 기본으로 받지 않아 SDK 기본값으로는
   * DNS 조회부터 실패한다.
   */
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(roleArn ? { credentials: awsCredentialsProvider({ roleArn }) } : {}),
  })

  // 개발 중 HMR 이 클라이언트를 계속 새로 만들지 않도록. 서버리스 warm 인스턴스에서도 재사용된다.
  globalThis.__icarosS3 = client
  return client
}

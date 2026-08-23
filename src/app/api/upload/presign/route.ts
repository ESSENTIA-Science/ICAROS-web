// requireAdmin 은 인증 트랙(`lib/auth/guard.ts`)이 만든다. 여기서는 쓰기만 한다.
import { requireAdmin } from '@/lib/auth/guard'
import { PRESIGN_TTL_SECONDS } from '@/lib/image/policy'
import type { PresignResponse } from '@/lib/image/contract'
import { createUpload } from '@/lib/s3/media'
import { consumePresignQuota } from '@/lib/s3/ratelimit'
import { json, readJsonBody, toErrorResponse } from '@/lib/s3/http'
import { parsePresignRequest } from '@/lib/s3/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * presigned **PUT** 발급 (D12).
 *
 * Server Action 이 아니라 Route Handler 인 이유: Next 는 Server Action 을 클라이언트당 직렬로
 * 처리해서 이미지 5장을 올리면 서명 5건이 줄을 선다 (04 §Decision).
 * 대신 Server Actions 의 내장 CSRF 방어가 적용되지 않으므로 `requireAdmin()` 이 Origin 까지 본다.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const session = await requireAdmin()
    // 호출 1건이 곧 `media` 행 1개다. 인증만으로는 상한이 없어 관리자별 쿼터를 먼저 깎는다.
    await consumePresignQuota(session.userId)

    const input = parsePresignRequest(await readJsonBody(req))

    const result = await createUpload({
      kind: input.kind,
      contentType: input.contentType,
      declaredSize: input.size,
      originalFilename: input.originalFilename,
      width: input.width,
      height: input.height,
      entityType: input.entityType,
      entityId: input.entityId,
    })

    const body: PresignResponse = {
      mediaId: result.mediaId,
      key: result.key,
      uploadUrl: result.uploadUrl,
      method: 'PUT',
      // 서명에 content-type 이 포함돼 있다. 이 헤더 외에는 하나도 붙이면 안 된다.
      headers: { 'Content-Type': result.contentType },
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    }

    return json(body, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return toErrorResponse(err)
  }
}

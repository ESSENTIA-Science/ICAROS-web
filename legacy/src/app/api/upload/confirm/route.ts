// requireAdmin 은 인증 트랙(`lib/auth/guard.ts`)이 만든다. 여기서는 쓰기만 한다.
import { requireAdmin } from '@/lib/auth/guard'
import { mediaUrl, type ConfirmResponse } from '@/lib/image/contract'
import { confirmUpload } from '@/lib/s3/media'
import { json, readJsonBody, toErrorResponse } from '@/lib/s3/http'
import { parseConfirmRequest } from '@/lib/s3/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 업로드 확정 (요구사항 I8).
 *
 * presigned PUT 은 크기를 서명에 박을 수 없다(D12). 그래서 실제 상한은 여기서 담보된다 —
 * `HeadObject` 로 실측하고, 초과하거나 타입이 다르면 그 자리에서 객체를 지운다.
 * 이 호출이 오지 않은 `pending` 행은 `sweepStalePendingUploads()` 가 회수한다.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    await requireAdmin()

    const input = parseConfirmRequest(await readJsonBody(req))
    const result = await confirmUpload(input.mediaId, { width: input.width, height: input.height })

    const body: ConfirmResponse = {
      id: result.id,
      url: mediaUrl(result.id),
      size: result.size,
      mime: result.mime,
      width: result.width,
      height: result.height,
    }

    return json(body, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return toErrorResponse(err)
  }
}

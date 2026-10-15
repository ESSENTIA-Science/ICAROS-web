import { getSnapshot } from '@/lib/content/snapshot'

export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json({ version: getSnapshot().version }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

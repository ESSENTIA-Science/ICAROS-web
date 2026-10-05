import { timingSafeEqual } from 'node:crypto'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

function authorized(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request.headers.get('x-fastpath-secret'), process.env.ICAROS_FASTPATH_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const input: unknown = await request.json().catch(() => null)
  const paths = input && typeof input === 'object' && !Array.isArray(input) && 'paths' in input ? input.paths : null
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 16 ||
    paths.some(path => typeof path !== 'string' || !/^\/[a-zA-Z0-9/_.-]*$/.test(path))) {
    return Response.json({ error: 'Invalid paths' }, { status: 400 })
  }
  for (const path of paths as string[]) {
    if (path === '/') revalidatePath('/', 'layout')
    else revalidatePath(path)
  }
  return Response.json({ accepted: paths })
}

import type { ContentKind, ContentMap, Editable, Post, PostAttachment, PublishJob, Session } from './types'
import type { PublishKind } from './publish'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiError' }
}

const root = '/api/admin'

const errorMessages: Record<string, string> = {
  UNAVAILABLE: '관리자 API를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  DENIED: '요청 권한이 없거나 세션이 만료되었습니다.',
  CONFLICT: '다른 변경 사항과 충돌했습니다. 새로고침 후 다시 시도해 주세요.',
  VERSION_CONFLICT: '다른 변경 사항과 충돌했습니다. 새로고침 후 다시 시도해 주세요.',
  IDEMPOTENCY_CONFLICT: '게시 요청이 기존 요청과 충돌했습니다. 새로고침 후 다시 시도해 주세요.',
  RETRY_CONFLICT: '게시 작업을 다시 시도할 수 없습니다. 새로고침 후 확인해 주세요.',
  MALFORMED: '입력 내용이 API 형식에 맞지 않습니다.',
  INVALID_INPUT: '입력 내용이 API 형식에 맞지 않습니다.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  NOT_FOUND: '요청한 항목을 찾을 수 없습니다.',
  METHOD_NOT_ALLOWED: '지원하지 않는 요청입니다.',
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${root}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      cache: 'no-store',
    })
  } catch {
    throw new ApiError('API 서버에 연결할 수 없습니다.', 0)
  }
  let payload: unknown
  try { payload = await response.json() } catch { throw new ApiError('API 응답 형식이 올바르지 않습니다.', response.status) }
  if (!response.ok || (typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === false)) {
    const detail = typeof payload === 'object' && payload !== null ? payload : {}
    const code = 'error' in detail && typeof detail.error === 'string' ? detail.error
      : 'message' in detail && typeof detail.message === 'string' ? detail.message : ''
    const message = errorMessages[code] ?? (response.status === 503 ? '관리자 API를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.'
      : /^[A-Z_]+$/.test(code) ? `요청에 실패했습니다. (${response.status})`
      : code || `요청에 실패했습니다. (${response.status})`)
    throw new ApiError(message, response.status)
  }
  if (!payload || typeof payload !== 'object' || !('ok' in payload) || payload.ok !== true) throw new ApiError('API 응답 형식이 올바르지 않습니다.', response.status)
  return ('data' in payload ? payload.data : payload) as T
}

function assertRecord(value: unknown): asserts value is { id: string; version: string; publishState: string; updatedAt: string } {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
    !('version' in value) || typeof value.version !== 'string' ||
    !('updatedAt' in value) || typeof value.updatedAt !== 'string' ||
    !('publishState' in value) || !['draft_saved', 'publishing', 'published', 'failed'].includes(String(value.publishState))) {
    throw new ApiError('콘텐츠 응답에 필수 필드가 없습니다.', 200)
  }
}

function assertContent<K extends ContentKind>(kind: K, value: unknown): asserts value is ContentMap[K] {
  assertRecord(value)
  const fields = kind === 'rockets' ? ['name', 'series', 'descriptionMd', 'maxAltitudeM', 'sizeM', 'payloadKg']
    : kind === 'site' ? ['value'] : ['title', 'bodyMd', 'authorLabel', 'displayDate']
  if (kind === 'posts' && (!('attachments' in value) || !Array.isArray(value.attachments) || value.attachments.some((item: unknown) => !validAttachment(item)))) throw new ApiError('첨부 응답 형식이 올바르지 않습니다.', 200)
  if (fields.some(field => !(field in value) || typeof value[field as keyof typeof value] !== 'string')) {
    throw new ApiError('콘텐츠 응답 형식이 올바르지 않습니다.', 200)
  }
}

function validAttachment(value: unknown): value is PostAttachment {
  return !!value && typeof value === 'object' && 'mediaId' in value && typeof value.mediaId === 'string' &&
    'kind' in value && (value.kind === 'image' || value.kind === 'pdf' || value.kind === 'video') && 'title' in value && typeof value.title === 'string'
}

function encode(id: string) { return encodeURIComponent(id) }

function assertPublishJob(value: unknown): asserts value is PublishJob {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' ||
    !('state' in value) || !['draft_saved', 'publishing', 'published', 'failed'].includes(String(value.state))) {
    throw new ApiError('게시 응답 형식이 올바르지 않습니다.', 200)
  }
}

export const api = {
  session: async () => {
    const value = await request<unknown>('/session')
    if (!value || typeof value !== 'object' || !('userId' in value) || typeof value.userId !== 'string' || !('email' in value) || typeof value.email !== 'string') throw new ApiError('세션 응답 형식이 올바르지 않습니다.', 200)
    return { userId: value.userId, email: value.email, displayName: 'displayName' in value && typeof value.displayName === 'string' ? value.displayName : null }
  },
  login: async (email: string, password: string) => {
    const value = await request<unknown>('/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    if (!value || typeof value !== 'object' || !('userId' in value) || typeof value.userId !== 'string' || !('email' in value) || typeof value.email !== 'string') throw new ApiError('로그인 응답 형식이 올바르지 않습니다.', 200)
    return value as Session
  },
  logout: () => request<unknown>('/logout', { method: 'POST' }),
  list: async <K extends ContentKind>(kind: K): Promise<ContentMap[K][]> => {
    const value = await request<unknown>(`/content/${kind}`)
    if (!Array.isArray(value)) throw new ApiError('목록 응답 형식이 올바르지 않습니다.', 200)
    value.forEach(item => assertContent(kind, item))
    return value as ContentMap[K][]
  },
  createPost: async (title: string, bodyMd: string, displayDate: string, attachments: PostAttachment[], idempotencyKey: string): Promise<Post> => {
    if (import.meta.env.VITE_ICAROS_DEMO === '1') throw new ApiError('데모에서는 변경할 수 없습니다.', 503)
    const value = await request<unknown>('/content/posts', { method: 'POST', body: JSON.stringify({ title, bodyMd, displayDate, attachments, idempotencyKey }) })
    assertContent('posts', value)
    return value
  },
  save: async <K extends ContentKind>(kind: K, id: string, version: string, draft: Editable<K>): Promise<ContentMap[K]> => {
    const value = await request<unknown>(`/content/${kind}/${encode(id)}`, { method: 'PUT', headers: { 'If-Match': version }, body: JSON.stringify(draft) })
    assertContent(kind, value)
    if (value.id !== id || value.version === version) throw new ApiError('저장 확인 응답의 버전이 갱신되지 않았습니다.', 200)
    return value
  },
  publish: async (kind: PublishKind, id: string, version: string, idempotencyKey: string): Promise<PublishJob> => {
    const value = await request<unknown>('/publish', { method: 'POST', body: JSON.stringify({ kind, id, version, idempotencyKey }) })
    assertPublishJob(value)
    return value
  },
  publishStatus: async (jobId: string): Promise<PublishJob> => {
    const value = await request<unknown>(`/publish/${encode(jobId)}`)
    assertPublishJob(value)
    if (value.id !== jobId) throw new ApiError('게시 응답 형식이 올바르지 않습니다.', 200)
    return value
  },
}

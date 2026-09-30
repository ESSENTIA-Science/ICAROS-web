import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishDraft, forgetPublicationKey } from './publish'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('publication request key', () => {
  it('reuses the same key after an ambiguous response, including after calling again', async () => {
    vi.stubGlobal('sessionStorage', storage())
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).idempotencyKey as string)
      if (sent.length === 1) throw new TypeError('response lost')
      return new Response(JSON.stringify({ ok: true, data: { id: 'job-1', state: 'publishing' } }), { status: 200 })
    }))

    await expect(publishDraft('rockets', 'icx-1a', 'v1')).rejects.toThrow('연결')
    await expect(publishDraft('rockets', 'icx-1a', 'v1')).resolves.toMatchObject({ id: 'job-1' })
    expect(sent).toHaveLength(2)
    expect(sent[0]).toBeTruthy()
    expect(sent[1]).toBe(sent[0])
  })

  it('uses a new key after a saved version changes', async () => {
    vi.stubGlobal('sessionStorage', storage())
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).idempotencyKey as string)
      return new Response(JSON.stringify({ ok: true, data: { id: `job-${sent.length}`, state: 'publishing' } }), { status: 200 })
    }))

    await publishDraft('rockets', 'icx-1a', 'v1')
    forgetPublicationKey('rockets', 'icx-1a', 'v1')
    await publishDraft('rockets', 'icx-1a', 'v2')
    expect(sent[1]).not.toBe(sent[0])
  })
})

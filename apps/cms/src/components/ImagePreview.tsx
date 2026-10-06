import { useEffect, useState } from 'react'

export default function ImagePreview({ mediaId, alt }: { mediaId: string | null | undefined; alt: string }) {
  const localPreview = import.meta.env.VITE_ICAROS_DEMO === '1' ||
    (typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname) && window.location.port === '5175')
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [localExtension, setLocalExtension] = useState(0)
  useEffect(() => {
    if (!mediaId) return
    const controller = new AbortController()
    fetch(`/api/admin/media/${encodeURIComponent(mediaId)}/preview`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('미리보기를 불러오지 못했습니다.')
        const payload: unknown = await response.json()
        if (!payload || typeof payload !== 'object' || !('data' in payload) || !payload.data || typeof payload.data !== 'object' ||
            !('mime' in payload.data) || !('base64' in payload.data) ||
            !['image/webp', 'image/jpeg', 'image/png'].includes(String(payload.data.mime)) || typeof payload.data.base64 !== 'string') throw new Error('미리보기 응답이 올바르지 않습니다.')
        return `data:${payload.data.mime};base64,${payload.data.base64}`
      })
      .then(source => { if (!controller.signal.aborted) { setUrl(source); setFailed(false) } })
      .catch(() => { if (!controller.signal.aborted) { if (localPreview) setFallback(true); else setFailed(true) } })
    return () => controller.abort()
  }, [mediaId, localPreview])
  if (!mediaId) return null
  const localExtensions = ['webp', 'jpg', 'png', 'avif', 'gif']
  const source = fallback ? localExtension < localExtensions.length
    ? `http://127.0.0.1:5174/assets/local-media/${encodeURIComponent(mediaId)}.${localExtensions[localExtension]}` : '' : failed ? '' : url
  return <div className="imagePreview">
    {source ? <img src={source} alt={alt} onError={() => { if (fallback) setLocalExtension(index => index + 1); else setFailed(true) }} />
      : <p role="status">{failed || (fallback && localExtension >= localExtensions.length) ? '이미지 미리보기를 표시할 수 없습니다.' : '이미지 미리보기 불러오는 중…'}</p>}
  </div>
}

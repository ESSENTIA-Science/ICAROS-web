import { Children, isValidElement, useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import BodyMedia, { bodyMediaKind, publicBodyMediaUrl, type BodyMediaKind } from '../../../web/src/components/posts/BodyMedia'
import { bodyMediaPreview, bodyMediaPreviewError, fetchBodyMediaUrl, isPrivateBodyMedia } from './bodyMedia'

export function bodyMediaLabel(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child)
    : isValidElement<{ children?: ReactNode }>(child) ? bodyMediaLabel(child.props.children) : '').join('') || '본문 첨부'
}

function PrivateBodyMediaPreview({ path, kind, children }: { path: string; kind: BodyMediaKind; children: ReactNode }) {
  const [state, setState] = useState(() => ({ src: bodyMediaPreview(path, kind), error: '', busy: false }))
  const request = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState({ src: null, error: '', busy: true })
    try {
      const src = await fetchBodyMediaUrl(path, kind, controller.signal)
      if (!controller.signal.aborted) setState({ src, error: '', busy: false })
    } catch {
      if (!controller.signal.aborted) setState({ src: null, error: bodyMediaPreviewError, busy: false })
    }
  }, [path, kind])
  useEffect(() => {
    let cancelled = false
    if (!bodyMediaPreview(path, kind)) queueMicrotask(() => { if (!cancelled) void refresh() })
    return () => { cancelled = true; request.current?.abort() }
  }, [path, kind, refresh])
  return <span>
    {state.src ? <BodyMedia key={state.src} src={state.src} kind={kind} label={bodyMediaLabel(children)}>{children}</BodyMedia>
      : <span role={state.error ? 'alert' : 'status'}>{state.error || '파일 미리보기 불러오는 중…'}</span>}
    <button type="button" disabled={state.busy} onClick={() => void refresh()}>{state.busy ? '불러오는 중…' : '미리보기 새로고침'}</button>
  </span>
}

export default function MarkdownBodyMedia({ href, title, children }: ComponentProps<'a'>) {
  const kind = bodyMediaKind(title)
  if (kind && href && isPrivateBodyMedia(href)) return <PrivateBodyMediaPreview key={`${kind}:${href}`} path={href} kind={kind}>{children}</PrivateBodyMediaPreview>
  const src = kind ? publicBodyMediaUrl(href) : null
  if (kind && src) return <BodyMedia src={src} kind={kind} label={bodyMediaLabel(children)}>{children}</BodyMedia>
  return <a href={href} title={title}>{children}</a>
}

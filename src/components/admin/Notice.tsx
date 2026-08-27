import type { ActionResult } from '@/app/admin/_actions/result'
import ui from './ui.module.css'

export type NoticeTone = 'ok' | 'error' | 'warn' | 'info'

const TONE_CLASS: Readonly<Record<NoticeTone, string>> = {
  ok: ui.noticeOk ?? '',
  error: ui.noticeErr ?? '',
  warn: ui.noticeWarn ?? '',
  info: ui.noticeInfo ?? '',
}

/**
 * 상태 배너.
 *
 * `role` 을 톤에 따라 나눈다: 오류는 `alert`(즉시 읽힘), 나머지는 `status`(정중히 읽힘).
 * 저장 성공 안내를 alert 로 만들면 스크린리더 사용자의 흐름을 매번 끊는다.
 */
export default function Notice({
  tone,
  title,
  children,
}: {
  tone: NoticeTone
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className={`${ui.notice} ${TONE_CLASS[tone]}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <p className={ui.noticeTitle}>{title}</p> : null}
      <div>{children}</div>
    </div>
  )
}

/**
 * 액션 결과 배너. 성공하면 `ok:true` 로 상태가 통째로 교체되므로 이전 오류 문구가 남지 않는다
 * (레거시 결함 #7 — 저장에 성공해도 에러 문자열이 화면에 계속 붙어 있던 문제).
 */
export function ActionNotice({ state }: { state: ActionResult | null }) {
  if (state === null) return null
  if (state.ok) {
    return state.message ? <Notice tone="ok">{state.message}</Notice> : null
  }
  return <Notice tone="error">{state.error}</Notice>
}

import { useLayoutEffect, useMemo, useState } from 'react'
import { noteCmsChange, removeAutosaveTask, updateAutosaveTask } from './cmsChanges'

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
type Options = { key: string; dirty: boolean; enabled?: boolean; save: () => Promise<void>; delay?: number; fingerprint?: string }
type Configuration = { dirty: boolean; enabled: boolean; save: () => Promise<void>; delay: number; fingerprint: string }

/** One serialized queue per record. flush also drains edits made during an outstanding save. */
export class AutosaveController {
  private config: Configuration = { dirty: false, enabled: true, save: async () => {}, delay: 700, fingerprint: '' }
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private failure = ''
  private attached = false
  constructor(private key: string, private report: (status: AutosaveStatus, error: string) => void) {}
  private emit(status: AutosaveStatus) {
    updateAutosaveTask(this.key, { dirty: this.config.dirty, saving: this.running !== null,
      error: this.failure, flush: () => this.flush() })
    if (this.attached) this.report(status, this.failure)
  }
  configure(next: Configuration) {
    this.attached = true
    const changed = next.fingerprint !== this.config.fingerprint
    this.config = next
    if (changed) this.failure = ''
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.emit(this.failure ? 'error' : this.running ? 'saving' : next.dirty ? 'pending' : 'idle')
    if (next.dirty && next.enabled && !this.running && !this.failure) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => {}) }, next.delay)
    }
  }
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.running) await this.running
    if (!this.config.dirty) return
    if (!this.config.enabled) throw new Error('필수 입력값을 확인하거나 작성 중인 새 항목을 취소해 주세요.')
    const run = async () => {
      try {
        for (let attempt = 0; this.config.dirty; attempt++) {
          if (attempt >= 12) throw new Error('자동 저장이 아직 진행 중입니다. 잠시 후 다시 시도해 주세요.')
          if (!this.config.enabled) throw new Error('필수 입력값을 확인해 주세요.')
          this.failure = ''
          this.emit('saving')
          const sent = this.config.fingerprint
          await this.config.save()
          noteCmsChange()
          await new Promise(resolve => setTimeout(resolve, 0))
          if (this.config.fingerprint === sent) this.config.dirty = false
        }
      } catch (cause) {
        this.failure = cause instanceof Error ? cause.message : '자동 저장에 실패했습니다.'
        throw cause
      } finally {
        this.running = null
        if (!this.attached && !this.config.dirty && !this.failure) removeAutosaveTask(this.key)
        else this.emit(this.failure ? 'error' : 'saved')
      }
    }
    this.running = Promise.resolve().then(run)
    this.emit('saving')
    await this.running
  }
  detach() {
    this.attached = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.config.dirty && this.config.enabled) void this.flush().catch(() => {})
    else if (!this.running) removeAutosaveTask(this.key)
  }
}

export function useAutosave({ key, dirty, enabled = true, save, delay = 700, fingerprint = String(dirty) }: Options) {
  const [state, setState] = useState<{ status: AutosaveStatus; error: string }>({ status: 'idle', error: '' })
  const controller = useMemo(() => new AutosaveController(key, (status, error) => {
    setState(previous => previous.status === status && previous.error === error ? previous : { status, error })
  }), [key])
  useLayoutEffect(() => {
    controller.configure({ dirty, enabled, save, delay, fingerprint })
  }, [controller, dirty, enabled, save, delay, fingerprint])
  useLayoutEffect(() => () => controller.detach(), [controller])
  return { ...state, flush: () => controller.flush() }
}
